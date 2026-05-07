const Customer = require("../db/models/customer");
const Tenant = require("../db/models/tenant");

/**
 * Forward an agent reply back to the customer (tenant-scoped).
 * Web customers get a webhook POST; Telegram customers get a DM.
 *
 * When multiple bots serve the same tenant, only the bot matching
 * customer.lastBotToken should relay. Other bots skip silently.
 *
 * @param {import('grammy').Bot} bot
 * @param {string} tenantId
 * @param {number} threadId
 * @param {object} msg - Telegram message object
 * @param {{ botToken?: string }} [options]
 */
async function relayToCustomer(bot, tenantId, threadId, msg, { botToken } = {}) {
  const customer = await Customer.findOne({ tenantId, threadId });
  if (!customer) return;

  // If this customer has a preferred bot and this isn't it, skip.
  // This prevents duplicate replies when multiple bots are in the same group.
  if (botToken && customer.lastBotToken && customer.lastBotToken !== botToken) {
    return;
  }

  // Web customers — POST to the CPCS webhook
  if (customer.source === "web") {
    await relayToWebCustomer(customer, tenantId, msg);
    return;
  }

  // Telegram customers — existing DM behavior
  await relayToTelegramCustomer(bot, customer, tenantId, msg);
}

async function relayToWebCustomer(customer, tenantId, msg) {
  console.log(`[relay] Web customer detected: alias=${customer.alias}, externalUserId=${customer.externalUserId}`);
  const webhookUrl = process.env.CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error(`[relay] CHAT_WEBHOOK_URL env var not set — cannot relay to web customer`);
    return;
  }
  console.log(`[relay] Webhook URL: ${webhookUrl}`);

  let text = null;
  let telegramFileId = null;
  let contentType = "text";

  if (msg.text) {
    text = msg.text;
  } else if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    telegramFileId = photo.file_id;
    contentType = "image";
    text = msg.caption || null;
  } else if (msg.document) {
    telegramFileId = msg.document.file_id;
    contentType = "image";
    text = msg.caption || null;
  } else if (msg.voice) {
    telegramFileId = msg.voice.file_id;
    contentType = "text";
    text = "[voice message]";
  } else if (msg.video) {
    telegramFileId = msg.video.file_id;
    contentType = "image";
    text = msg.caption || null;
  } else if (msg.sticker) {
    text = "[sticker]";
  } else {
    text = "[unsupported message type]";
  }

  const payload = {
    tenantId: tenantId.toString(),
    customerAlias: customer.alias,
    text,
    telegramFileId,
    contentType,
    messageId: msg.message_id,
  };

  try {
    console.log(`[relay] Sending webhook POST: alias=${customer.alias}, contentType=${contentType}, hasText=${!!text}, hasFileId=${!!telegramFileId}`);
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": process.env.CHAT_WEBHOOK_SECRET || "",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[relay] Webhook POST failed: ${res.status} ${res.statusText}`);
    } else {
      console.log(`[relay] Webhook POST success: ${res.status}`);
    }
  } catch (err) {
    console.error(`[relay] Webhook POST error:`, err.message);
  }
}

async function relayToTelegramCustomer(bot, customer, tenantId, msg) {
  const chatId = customer.telegramUserId;

  try {
    if (msg.text) {
      await bot.api.sendMessage(chatId, msg.text);
    } else if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1];
      await bot.api.sendPhoto(chatId, photo.file_id, {
        caption: msg.caption || "",
      });
    } else if (msg.document) {
      await bot.api.sendDocument(chatId, msg.document.file_id, {
        caption: msg.caption || "",
      });
    } else if (msg.voice) {
      await bot.api.sendVoice(chatId, msg.voice.file_id);
    } else if (msg.video) {
      await bot.api.sendVideo(chatId, msg.video.file_id, {
        caption: msg.caption || "",
      });
    } else if (msg.sticker) {
      await bot.api.sendSticker(chatId, msg.sticker.file_id);
    }
  } catch (err) {
    // If the user blocked the bot, notify agents in the topic
    if (err.message.includes("403") || err.message.includes("bot was blocked")) {
      const replyOpts = customer.threadId ? { message_thread_id: customer.threadId } : {};
      const tenant = await Tenant.findById(tenantId);
      const agentGroupId = tenant?.agentGroupId;
      if (agentGroupId) {
        await bot.api.sendMessage(
          agentGroupId,
          `⚠️ Message not delivered — ${customer.alias} has blocked the bot.`,
          replyOpts
        );
      }
    } else {
      throw err;
    }
  }
}

module.exports = { relayToCustomer };

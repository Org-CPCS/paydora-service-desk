const { Customer, Tenant, getNextAlias } = require("./db");
const { scrub } = require("./pii");

// Get or create a customer record + topic (tenant-scoped)
async function getOrCreateCustomer(bot, tenantId, telegramUserId, fromUser, agentGroupId, { source, externalUserId } = {}) {
  let customer = await Customer.findOne({ tenantId, telegramUserId });
  if (customer && customer.threadId) {
    // Don't reopen blocked conversations
    if (customer.status === "blocked") return customer;

    // Reopen if the conversation was closed
    if (customer.status === "closed") {
      customer.status = "open";
      await customer.save();
      try {
        await bot.api.reopenForumTopic(agentGroupId, customer.threadId);
        await bot.api.editForumTopic(agentGroupId, customer.threadId, {
          name: customer.alias,
        });
      } catch (e) {
        console.error("Failed to reopen/rename topic:", e.message);
      }
      await bot.api.sendMessage(
        agentGroupId,
        `🔄 ${customer.alias} has sent a new message — conversation reopened.`,
        { message_thread_id: customer.threadId }
      );
    }
    return customer;
  }

  // New customer — create alias and topic
  if (!customer) {
    const initial = fromUser?.first_name;
    const alias = await getNextAlias(tenantId, initial);
    const customerData = {
      tenantId,
      telegramUserId,
      alias,
      firstName: fromUser?.first_name || null,
      lastName: fromUser?.last_name || null,
      username: fromUser?.username || null,
    };
    if (source) customerData.source = source;
    if (externalUserId) customerData.externalUserId = externalUserId;
    customer = await Customer.create(customerData);
  } else {
    // Update profile fields in case the user changed their name/username
    let dirty = false;
    if (fromUser?.first_name && customer.firstName !== fromUser.first_name) { customer.firstName = fromUser.first_name; dirty = true; }
    if (fromUser?.last_name !== undefined && customer.lastName !== (fromUser.last_name || null)) { customer.lastName = fromUser.last_name || null; dirty = true; }
    if (fromUser?.username !== undefined && customer.username !== (fromUser.username || null)) { customer.username = fromUser.username || null; dirty = true; }
    if (dirty) await customer.save();
  }

  // Create a topic in the agent group
  const topic = await bot.api.createForumTopic(agentGroupId, customer.alias);
  customer.threadId = topic.message_thread_id;
  customer.status = "open";
  await customer.save();

  // Post a welcome message in the topic
  await bot.api.sendMessage(
    agentGroupId,
    `New conversation started with ${customer.alias}`,
    { message_thread_id: topic.message_thread_id }
  );

  return customer;
}

// Forward a customer message to the agent group (as the bot, never forwardMessage)
async function relayToAgents(bot, customer, msg, agentGroupId) {
  const opts = { message_thread_id: customer.threadId };
  const prefix = `${customer.alias}:\n`;
  const userInfo = msg.from;

  if (msg.text) {
    await bot.api.sendMessage(agentGroupId, prefix + scrub(msg.text, userInfo), opts);
  } else if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1]; // highest resolution
    await bot.api.sendPhoto(agentGroupId, photo.file_id, {
      ...opts,
      caption: prefix + scrub(msg.caption || "", userInfo),
    });
  } else if (msg.document) {
    await bot.api.sendDocument(agentGroupId, msg.document.file_id, {
      ...opts,
      caption: prefix + scrub(msg.caption || "", userInfo),
    });
  } else if (msg.voice) {
    await bot.api.sendVoice(agentGroupId, msg.voice.file_id, {
      ...opts,
      caption: prefix,
    });
  } else if (msg.video) {
    await bot.api.sendVideo(agentGroupId, msg.video.file_id, {
      ...opts,
      caption: prefix + scrub(msg.caption || "", userInfo),
    });
  } else if (msg.sticker) {
    await bot.api.sendMessage(agentGroupId, prefix + "[sticker]", opts);
  } else if (msg.contact) {
    await bot.api.sendMessage(
      agentGroupId,
      prefix + `[contact: ${msg.contact.first_name} ${msg.contact.phone_number}]`,
      opts
    );
  } else if (msg.location) {
    await bot.api.sendMessage(
      agentGroupId,
      prefix + `[location: ${msg.location.latitude}, ${msg.location.longitude}]`,
      opts
    );
  } else {
    await bot.api.sendMessage(
      agentGroupId,
      prefix + "[unsupported message type]",
      opts
    );
  }
}

// Forward an agent reply back to the customer (tenant-scoped)
async function relayToCustomer(bot, tenantId, threadId, msg) {
  const customer = await Customer.findOne({ tenantId, threadId });
  if (!customer) return;

  // Web customers — POST to the CPCS webhook
  if (customer.source === "web") {
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
    return;
  }

  // Telegram customers — existing DM behavior
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

module.exports = { getOrCreateCustomer, relayToAgents, relayToCustomer };

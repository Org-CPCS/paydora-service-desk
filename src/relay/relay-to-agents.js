const { scrub } = require("../pii");
const { messageQueue } = require("./message-queue");

/**
 * Forward a customer message to the agent group (as the bot, never forwardMessage).
 * Messages are queued per-chat to respect Telegram rate limits.
 *
 * @param {import('grammy').Bot} bot
 * @param {object} customer - customer document with alias and threadId
 * @param {object} msg - Telegram message object
 * @param {number} agentGroupId
 */
async function relayToAgents(bot, customer, msg, agentGroupId) {
  const opts = { message_thread_id: customer.threadId };
  const prefix = `${customer.alias}:\n`;
  const userInfo = msg.from;

  const msgType = msg.text ? "text" : msg.photo ? "photo" : msg.document ? "document" : msg.voice ? "voice" : msg.video ? "video" : msg.sticker ? "sticker" : "other";
  console.log(`[relay-to-agents] Queuing: alias=${customer.alias}, threadId=${customer.threadId}, type=${msgType}, groupId=${agentGroupId}`);

  // Queue the send to the agent group (rate-limited per group chat)
  await messageQueue.enqueue(agentGroupId, async () => {
    try {
      await sendToThread(bot, agentGroupId, opts, prefix, msg, userInfo);
      console.log(`[relay-to-agents] Sent: alias=${customer.alias}, threadId=${customer.threadId}, type=${msgType}`);
    } catch (err) {
      // Thread was deleted — recreate it and retry once
      if (err.message && err.message.includes("message thread not found")) {
        console.log(`[relay-to-agents] Thread ${customer.threadId} not found for ${customer.alias}, recreating topic...`);
        const Customer = require("../db/models/customer");
        const topic = await bot.api.createForumTopic(agentGroupId, customer.alias);
        const newThreadId = topic.message_thread_id;
        await Customer.findByIdAndUpdate(customer._id, { threadId: newThreadId });
        customer.threadId = newThreadId;
        console.log(`[relay-to-agents] Topic recreated: alias=${customer.alias}, newThreadId=${newThreadId}`);

        const newOpts = { message_thread_id: newThreadId };
        await sendToThread(bot, agentGroupId, newOpts, prefix, msg, userInfo);
        console.log(`[relay-to-agents] Retry sent: alias=${customer.alias}, newThreadId=${newThreadId}, type=${msgType}`);
        return;
      }
      throw err;
    }
  }).catch((err) => {
    console.error(`[relay-to-agents] Failed: alias=${customer.alias}, threadId=${customer.threadId}, type=${msgType}, error=${err.message}`);
  });
}

/**
 * Sends the appropriate message type to the agent group thread.
 */
async function sendToThread(bot, agentGroupId, opts, prefix, msg, userInfo) {
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

module.exports = { relayToAgents };

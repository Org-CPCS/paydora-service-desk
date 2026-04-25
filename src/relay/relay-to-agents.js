const { scrub } = require("../pii");

/**
 * Forward a customer message to the agent group (as the bot, never forwardMessage).
 * @param {import('grammy').Bot} bot
 * @param {object} customer - customer document with alias and threadId
 * @param {object} msg - Telegram message object
 * @param {number} agentGroupId
 */
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

module.exports = { relayToAgents };

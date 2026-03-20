const { Customer, getNextAlias } = require("./db");
const { scrub } = require("./pii");

const AGENT_GROUP_ID = Number(process.env.AGENT_GROUP_ID);

// Get or create a customer record + topic
async function getOrCreateCustomer(bot, telegramUserId) {
  let customer = await Customer.findOne({ telegramUserId });
  if (customer && customer.threadId) return customer;

  // New customer — create alias and topic
  if (!customer) {
    const alias = await getNextAlias();
    customer = await Customer.create({ telegramUserId, alias });
  }

  // Create a topic in the agent group
  const topic = await bot.api.createForumTopic(AGENT_GROUP_ID, customer.alias);
  customer.threadId = topic.message_thread_id;
  customer.status = "open";
  await customer.save();

  // Post a welcome message in the topic
  await bot.api.sendMessage(
    AGENT_GROUP_ID,
    `New conversation started with ${customer.alias}`,
    { message_thread_id: topic.message_thread_id }
  );

  return customer;
}

// Forward a customer message to the agent group (as the bot, never forwardMessage)
async function relayToAgents(bot, customer, msg) {
  const opts = { message_thread_id: customer.threadId };
  const prefix = `${customer.alias}:\n`;
  const userInfo = msg.from;

  if (msg.text) {
    await bot.api.sendMessage(AGENT_GROUP_ID, prefix + scrub(msg.text, userInfo), opts);
  } else if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1]; // highest resolution
    await bot.api.sendPhoto(AGENT_GROUP_ID, photo.file_id, {
      ...opts,
      caption: prefix + scrub(msg.caption || "", userInfo),
    });
  } else if (msg.document) {
    await bot.api.sendDocument(AGENT_GROUP_ID, msg.document.file_id, {
      ...opts,
      caption: prefix + scrub(msg.caption || "", userInfo),
    });
  } else if (msg.voice) {
    await bot.api.sendVoice(AGENT_GROUP_ID, msg.voice.file_id, {
      ...opts,
      caption: prefix,
    });
  } else if (msg.video) {
    await bot.api.sendVideo(AGENT_GROUP_ID, msg.video.file_id, {
      ...opts,
      caption: prefix + scrub(msg.caption || "", userInfo),
    });
  } else if (msg.sticker) {
    await bot.api.sendMessage(AGENT_GROUP_ID, prefix + "[sticker]", opts);
  } else if (msg.location) {
    await bot.api.sendMessage(
      AGENT_GROUP_ID,
      prefix + `[location: ${msg.location.latitude}, ${msg.location.longitude}]`,
      opts
    );
  } else {
    await bot.api.sendMessage(
      AGENT_GROUP_ID,
      prefix + "[unsupported message type]",
      opts
    );
  }
}

// Forward an agent reply back to the customer
async function relayToCustomer(bot, threadId, msg) {
  const customer = await Customer.findOne({ threadId });
  if (!customer) return;

  const chatId = customer.telegramUserId;

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
}

module.exports = { getOrCreateCustomer, relayToAgents, relayToCustomer, AGENT_GROUP_ID };

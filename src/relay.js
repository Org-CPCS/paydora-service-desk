const { Customer, getNextAlias } = require("./db");
const { scrub } = require("./pii");

// Get or create a customer record + topic (tenant-scoped)
async function getOrCreateCustomer(bot, tenantId, telegramUserId, fromUser, agentGroupId) {
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
    customer = await Customer.create({ tenantId, telegramUserId, alias });
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

module.exports = { getOrCreateCustomer, relayToAgents, relayToCustomer };

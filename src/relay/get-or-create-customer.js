const Customer = require("../db/models/customer");
const { getNextAlias } = require("../db/get-next-alias");

/**
 * Get or create a customer record + topic (tenant-scoped).
 * @param {import('grammy').Bot} bot
 * @param {string} tenantId
 * @param {number} telegramUserId
 * @param {object} fromUser - Telegram user object (first_name, last_name, username)
 * @param {number} agentGroupId
 * @param {{ source?: string, externalUserId?: string }} [options]
 * @returns {Promise<object>} customer document
 */
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

module.exports = { getOrCreateCustomer };

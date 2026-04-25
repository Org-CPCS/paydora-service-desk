const Customer = require("../../db/models/customer");

/**
 * /blockuser — block the customer in this topic.
 */
async function handleBlock(ctx, { tenantId, agentGroupId, threadId, bot }) {
  const customer = await Customer.findOne({ tenantId, threadId });
  if (!customer) {
    return ctx.reply("❓ No customer found for this topic.", { message_thread_id: threadId });
  }
  if (customer.status === "blocked") {
    return ctx.reply("ℹ️ This user is already blocked.", { message_thread_id: threadId });
  }
  customer.status = "blocked";
  await customer.save();
  await ctx.reply(`🚫 ${customer.alias} has been blocked. They will no longer be able to send messages.`, { message_thread_id: threadId });
  try {
    await bot.api.closeForumTopic(agentGroupId, threadId);
  } catch (e) {
    console.error("Failed to close topic after block:", e.message);
  }
}

module.exports = { handleBlock };

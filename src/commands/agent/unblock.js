const Customer = require("../../db/models/customer");

/**
 * /unblockuser — unblock the customer in this topic.
 */
async function handleUnblock(ctx, { tenantId, agentGroupId, threadId, bot }) {
  const customer = await Customer.findOne({ tenantId, threadId });
  if (!customer) {
    return ctx.reply("❓ No customer found for this topic.", { message_thread_id: threadId });
  }
  if (customer.status !== "blocked") {
    return ctx.reply("ℹ️ This user is not blocked.", { message_thread_id: threadId });
  }
  customer.status = "open";
  await customer.save();
  await ctx.reply(`✅ ${customer.alias} has been unblocked.`, { message_thread_id: threadId });
  try {
    await bot.api.reopenForumTopic(agentGroupId, threadId);
  } catch (e) {
    console.error("Failed to reopen topic after unblock:", e.message);
  }
}

module.exports = { handleUnblock };

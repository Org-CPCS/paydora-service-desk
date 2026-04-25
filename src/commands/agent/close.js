const Customer = require("../../db/models/customer");

/**
 * /close — mark conversation closed, rename topic.
 */
async function handleClose(ctx, { tenantId, agentGroupId, threadId }) {
  const customer = await Customer.findOne({ tenantId, threadId });
  if (customer) {
    customer.status = "closed";
    await customer.save();
    await ctx.reply("✅ Conversation closed.", { message_thread_id: threadId });
    try {
      await ctx.api.editForumTopic(agentGroupId, threadId, {
        name: `[done] ${customer.alias}`,
      });
      await ctx.api.closeForumTopic(agentGroupId, threadId);
    } catch (e) {
      console.error("Failed to close/rename topic:", e.message);
    }
  }
}

module.exports = { handleClose };

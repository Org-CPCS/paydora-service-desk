/**
 * /rename New Name — rename the current topic.
 */
async function handleRename(ctx, { agentGroupId, threadId }) {
  const newName = ctx.message.text.slice(8).trim();
  if (!newName) {
    return ctx.reply("Usage: /rename New Topic Name", { message_thread_id: threadId });
  }
  try {
    await ctx.api.editForumTopic(agentGroupId, threadId, { name: newName.slice(0, 128) });
    await ctx.reply(`✅ Topic renamed to "${newName.slice(0, 128)}".`, { message_thread_id: threadId });
  } catch (e) {
    console.error("[SubBot] /rename error:", e.message);
    await ctx.reply(`⚠️ Failed to rename: ${e.message}`, { message_thread_id: threadId });
  }
}

module.exports = { handleRename };

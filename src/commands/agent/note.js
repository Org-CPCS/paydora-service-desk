/**
 * /note — internal note, not relayed to customer.
 */
async function handleNote(ctx, { threadId }) {
  await ctx.reply(`📝 Note: ${ctx.message.text.slice(6)}`, {
    message_thread_id: threadId,
  });
}

module.exports = { handleNote };

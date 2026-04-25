/**
 * /help — show available commands for agents in the group.
 */
async function handleAgentHelp(ctx, { threadId }) {
  const replyOpts = threadId ? { message_thread_id: threadId } : {};
  return ctx.reply(
`📋 Available commands:

Inside a customer topic:
/close — Close the conversation
/blockuser — Block the customer
/unblockuser — Unblock the customer
/whois — See customer info (admins only)
/note <text> — Add an internal note (not sent to customer)
/rename <name> — Rename the topic
/assignbot — Switch which bot handles this customer

General:
/broadcastallusers <text> — Send a message to all customers
/tag @user Title — Set a custom title for a group member
/welcomeUser @username — Send the welcome message to a user`,
    replyOpts
  );
}

module.exports = { handleAgentHelp };

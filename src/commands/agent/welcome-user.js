const GroupMember = require("../../db/models/group-member");
const { getOrCreateCustomer } = require("../../relay/get-or-create-customer");

/**
 * /welcomeUser — proactively send the welcome message to a user by username.
 */
async function handleWelcomeUser(ctx, { tenantId, agentGroupId, threadId, bot }) {
  const replyOpts = threadId ? { message_thread_id: threadId } : {};
  const input = ctx.message.text.slice("/welcomeUser".length).trim();
  if (!input) {
    return ctx.reply(
      "Usage: /welcomeUser @username\n\nThis sends the welcome message directly to a user so they can start chatting with support.",
      replyOpts
    );
  }

  // Strip leading @ if present
  const username = input.replace(/^@/, "").trim();
  if (!username) {
    return ctx.reply("⚠️ Please provide a valid username.", replyOpts);
  }

  // Resolve username → userId
  let targetUserId = null;
  let firstName = null;

  // Check text_mention entities (rich mentions from Telegram autocomplete)
  const entities = ctx.message.entities || [];
  for (const entity of entities) {
    if (entity.type === "text_mention" && entity.user) {
      targetUserId = entity.user.id;
      firstName = entity.user.first_name;
      break;
    }
  }

  // Try GroupMember cache
  if (!targetUserId) {
    const cached = await GroupMember.findOne({
      groupId: agentGroupId,
      username: username.toLowerCase(),
    });
    if (cached) targetUserId = cached.userId;
  }

  // Try numeric user ID
  if (!targetUserId && /^\d+$/.test(username)) {
    targetUserId = Number(username);
  }

  if (!targetUserId) {
    const botUsername = ctx.me.username ? `@${ctx.me.username}` : "the bot";
    return ctx.reply(
      `⚠️ Couldn't resolve user "${username}".\n\n` +
      `The user needs to have interacted with ${botUsername} before, or be a member of this group.\n\n` +
      `Alternatively, send them this link to start a chat:\nhttps://t.me/${ctx.me.username || "bot"}?start=welcome`,
      replyOpts
    );
  }

  const welcomeMsg =
    "Hey there 👋 Thank you for messaging us!\n\n" +
    "Just type your question or describe your issue and one of our team members will be with you shortly. We're happy to help!";

  try {
    // Send the welcome message to the user's DM
    await bot.api.sendMessage(targetUserId, welcomeMsg);

    // Create a customer record + topic so agents are ready when the user replies
    const customer = await getOrCreateCustomer(
      bot,
      tenantId,
      targetUserId,
      { first_name: firstName || username },
      agentGroupId
    );

    await ctx.reply(
      `✅ Welcome message sent to ${username}!\n\nTheir conversation topic (${customer.alias}) is ready for when they reply.`,
      replyOpts
    );
    console.log(`[SubBot] /welcomeUser: sent welcome to ${username} (userId: ${targetUserId}), alias: ${customer.alias}`);
  } catch (e) {
    console.error(`[SubBot] /welcomeUser error:`, e.message);

    if (e.message.includes("403") || e.message.includes("bot was blocked") || e.message.includes("chat not found")) {
      const botUsername = ctx.me.username ? `@${ctx.me.username}` : "the bot";
      await ctx.reply(
        `⚠️ Can't message this user — they haven't started a chat with ${botUsername} yet.\n\n` +
        `Send them this link so they can initiate the conversation:\nhttps://t.me/${ctx.me.username || "bot"}?start=welcome`,
        replyOpts
      );
    } else {
      await ctx.reply(`⚠️ Failed to send welcome message: ${e.message}`, replyOpts);
    }
  }
}

module.exports = { handleWelcomeUser };

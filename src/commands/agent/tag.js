const GroupMember = require("../../db/models/group-member");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * /tag — set a custom title for a group member.
 * Supports reply-based, @mention-based, and user-ID-based targeting.
 */
async function handleTag(ctx, { agentGroupId, threadId, bot }) {
  const replyOpts = threadId ? { message_thread_id: threadId } : {};
  const tagText = ctx.message.text.slice(4).trim();

  // --- Reply-based: reply to a message with /tag Title ---
  const repliedMsg = ctx.message.reply_to_message;
  const isRealReply = repliedMsg && repliedMsg.from && !repliedMsg.forum_topic_created;

  if (isRealReply) {
    if (!tagText) {
      return ctx.reply("Usage: reply to a message with /tag Title", replyOpts);
    }
    const title = tagText.slice(0, 16);
    const targetUserId = repliedMsg.from.id;
    if (repliedMsg.from.is_bot) {
      return ctx.reply("⚠️ Can't tag bots.", replyOpts);
    }

    try {
      await promoteAndSetTitle(bot, agentGroupId, targetUserId, title);
      await ctx.reply(`✅ Set title "${title}" for ${repliedMsg.from.first_name}.`, replyOpts);
    } catch (e) {
      console.error("[SubBot] /tag (reply) error:", e.message);
      await ctx.reply(`⚠️ Failed to set tag: ${e.message}`, replyOpts);
    }
    return;
  }

  // --- Mention, username, or user ID: /tag <target> Title ---
  const parts = tagText.split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply("Usage: /tag @username Title\nOr: /tag <user_id> Title\nOr reply to a message with: /tag Title", replyOpts);
  }

  const identifier = parts[0].replace(/^@/, "");
  const title = parts.slice(1).join(" ").slice(0, 16);

  let targetUserId = await resolveUserId(ctx, agentGroupId, identifier, bot);

  if (!targetUserId) {
    return ctx.reply(
      "⚠️ Couldn't resolve that user. This can happen if they aren't an admin yet.\n\nTry replying to one of their messages with:\n/tag Title",
      replyOpts
    );
  }

  try {
    await promoteAndSetTitle(bot, agentGroupId, targetUserId, title);
    await ctx.reply(`✅ Set title "${title}" for user.`, replyOpts);
  } catch (e) {
    console.error("[SubBot] /tag error:", e.message);
    await ctx.reply(`⚠️ Failed to set tag: ${e.message}`, replyOpts);
  }
}

async function resolveUserId(ctx, agentGroupId, identifier, bot) {
  let targetUserId = null;

  // 1. Check text_mention entities (rich mentions from Telegram autocomplete)
  const entities = ctx.message.entities || [];
  for (const entity of entities) {
    if (entity.type === "text_mention" && entity.user) {
      targetUserId = entity.user.id;
      break;
    }
    if (entity.type === "mention") {
      const username = ctx.message.text.substring(entity.offset + 1, entity.offset + entity.length).toLowerCase();
      try {
        const cached = await GroupMember.findOne({ groupId: agentGroupId, username });
        if (cached) {
          targetUserId = cached.userId;
        } else {
          const admins = await bot.api.getChatAdministrators(agentGroupId);
          const match = admins.find(
            (m) => m.user.username && m.user.username.toLowerCase() === username
          );
          if (match) targetUserId = match.user.id;
        }
      } catch (_) {}
      break;
    }
  }

  // 2. Try parsing as numeric user ID
  if (!targetUserId && /^\d+$/.test(identifier)) {
    targetUserId = Number(identifier);
  }

  // 3. Try as a plain username (without @)
  if (!targetUserId && /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(identifier)) {
    const username = identifier.toLowerCase();
    try {
      const cached = await GroupMember.findOne({ groupId: agentGroupId, username });
      if (cached) {
        targetUserId = cached.userId;
      } else {
        const admins = await bot.api.getChatAdministrators(agentGroupId);
        const match = admins.find(
          (m) => m.user.username && m.user.username.toLowerCase() === username
        );
        if (match) targetUserId = match.user.id;
      }
    } catch (_) {}
  }

  return targetUserId;
}

async function promoteAndSetTitle(bot, agentGroupId, targetUserId, title) {
  console.log(`[SubBot] /tag: promoting user ${targetUserId} in group ${agentGroupId}...`);
  await bot.api.promoteChatMember(agentGroupId, targetUserId, {
    can_manage_chat: true,
    can_delete_messages: false,
    can_manage_video_chats: false,
    can_restrict_members: false,
    can_promote_members: false,
    can_change_info: false,
    can_invite_users: false,
    can_post_stories: false,
    can_edit_stories: false,
    can_delete_stories: false,
    can_pin_messages: false,
    can_manage_topics: false,
  });
  console.log(`[SubBot] /tag: promote succeeded, waiting before setting title...`);

  await sleep(1500);

  const member = await bot.api.getChatMember(agentGroupId, targetUserId);
  console.log(`[SubBot] /tag: user status after promote: ${member.status}`);

  await bot.api.setChatAdministratorCustomTitle(agentGroupId, targetUserId, title);
  console.log(`[SubBot] /tag: title set successfully`);
}

module.exports = { handleTag };

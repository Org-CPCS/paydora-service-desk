const { Bot } = require("grammy");
const { Customer, Tenant, GroupMember } = require("./db");
const { getOrCreateCustomer, relayToAgents, relayToCustomer } = require("./relay");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Creates a configured grammY Bot instance for a tenant.
 * @param {string} token - Telegram bot token
 * @param {{ tenantId: string, agentGroupId: number }} tenant
 * @param {{ notifyActivation: (tenantId: string) => void }} [callbacks]
 * @returns {Bot} configured bot instance (not yet started)
 */
function createSubBot(token, tenant, callbacks) {
  const { tenantId, agentGroupId } = tenant;
  const bot = new Bot(token);

  // --- Detect when bot is added to the agent group ---
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    if (update.chat.id !== agentGroupId) return;

    const newStatus = update.new_chat_member.status;

    // Bot was added as a regular member — ask Master Bot to promote it
    if (newStatus === "member") {
      console.log(`[SubBot] Tenant ${tenantId} — bot added to group as member, requesting promotion...`);
      if (callbacks && callbacks.promoteBot) {
        const botId = update.new_chat_member.user.id;
        callbacks.promoteBot(tenantId.toString(), agentGroupId, botId);
      }
    }

    // Bot was promoted to admin — activate the tenant
    if (newStatus === "administrator") {
      const t = await Tenant.findById(tenantId);
      if (t && t.status === "pending") {
        t.status = "active";
        await t.save();
        console.log(`[SubBot] Tenant ${tenantId} activated — bot is now admin in group.`);
        if (callbacks && callbacks.notifyActivation) {
          callbacks.notifyActivation(tenantId.toString());
        }
      }
    }
  });

  // --- Detect when Master Bot is kicked from the agent group ---
  bot.on("chat_member", async (ctx) => {
    const update = ctx.chatMember;
    if (update.chat.id !== agentGroupId) return;
    if (!callbacks || !callbacks.masterBotId) return;

    const member = update.new_chat_member;
    if (member.user.id !== callbacks.masterBotId) return;

    const wasIn = ["member", "administrator", "creator"].includes(update.old_chat_member.status);
    const isOut = ["left", "kicked"].includes(member.status);

    if (wasIn && isOut) {
      console.log(`[SubBot] Tenant ${tenantId} — Master Bot was removed from agent group ${agentGroupId}`);

      // Try to re-invite the Master Bot
      try {
        await bot.api.unbanChatMember(agentGroupId, callbacks.masterBotId, { only_if_banned: true });
        const inviteLink = await bot.api.createChatInviteLink(agentGroupId, {
          name: "Re-invite Master Bot",
          member_limit: 1,
        });
        console.log(`[SubBot] Generated re-invite link for Master Bot: ${inviteLink.invite_link}`);
      } catch (e) {
        console.error(`[SubBot] Failed to create re-invite link for Master Bot:`, e.message);
      }

      if (callbacks.masterBotKicked) {
        callbacks.masterBotKicked(tenantId.toString(), agentGroupId);
      }
    }
  });

  // --- Customer DM handler ---
  bot.on("message", async (ctx, next) => {
    if (ctx.chat.type !== "private") return next();

    // /start command — welcome message
    if (ctx.message.text === "/start") {
      return ctx.reply(
        "Hey there 👋 Thank you for messaging us!\n\nJust type your question or describe your issue and one of our team members will be with you shortly. We're happy to help!"
      );
    }

    const customer = await getOrCreateCustomer(
      bot,
      tenantId,
      ctx.from.id,
      ctx.from,
      agentGroupId
    );

    // Only block messages from explicitly blocked customers
    if (customer.status === "blocked") return;

    await relayToAgents(bot, customer, ctx.message, agentGroupId);
  });

  // --- Agent group handler ---
  bot.on("message", async (ctx) => {
    if (ctx.chat.id !== agentGroupId) return;

    // Skip messages sent by this bot itself (but allow other bots/channels)
    if (ctx.from.id === ctx.me.id) return;

    // Cache the sender's username → userId for @mention resolution
    if (ctx.from.username) {
      GroupMember.findOneAndUpdate(
        { groupId: agentGroupId, username: ctx.from.username.toLowerCase() },
        { userId: ctx.from.id, updatedAt: new Date() },
        { upsert: true }
      ).catch(() => {});
    }

    const threadId = ctx.message.message_thread_id;
    const replyOpts = threadId ? { message_thread_id: threadId } : {};

    // /tag — set a custom title for a group member
    // Priority: reply-based first, then @mention-based
    if (ctx.message.text && /^\/tag(\s|$)/.test(ctx.message.text)) {
      const tagText = ctx.message.text.slice(4).trim();

      // --- Reply-based: reply to a message with /tag Title ---
      // In forum groups, reply_to_message may point to the topic creation message,
      // so we also check that the replied message has a real sender
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

      const identifier = parts[0].replace(/^@/, ""); // strip leading @ if typed manually
      const title = parts.slice(1).join(" ").slice(0, 16);

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

      if (!targetUserId) {
        return ctx.reply(
          "⚠️ Couldn't resolve that user. This can happen if they aren't an admin yet.\n\nTry replying to one of their messages with:\n/tag Title",
          replyOpts
        );
      }

      try {
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
        await ctx.reply(`✅ Set title "${title}" for user.`, replyOpts);
      } catch (e) {
        console.error("[SubBot] /tag error:", e.message);
        await ctx.reply(`⚠️ Failed to set tag: ${e.message}`, replyOpts);
      }
      return;
    }

    if (!threadId) return;

    // /whois — DM the requesting admin with the customer's real Telegram info
    if (ctx.message.text === "/whois") {
      try {
        const member = await bot.api.getChatMember(agentGroupId, ctx.from.id);
        if (!["administrator", "creator"].includes(member.status)) {
          return ctx.reply("⛔ Only admins can use /whois.", { message_thread_id: threadId });
        }
        const customer = await Customer.findOne({ tenantId, threadId });
        if (!customer) {
          return ctx.reply("❓ No customer found for this topic.", { message_thread_id: threadId });
        }
        const chat = await bot.api.getChat(customer.telegramUserId);
        const username = chat.username ? `@${chat.username}` : "no username";
        const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "unknown";
        await bot.api.sendMessage(
          ctx.from.id,
          `🔍 Customer info for ${customer.alias}:\n\nName: ${name}\nUsername: ${username}\nUser ID: ${customer.telegramUserId}`
        );
        await ctx.reply("✅ Customer info sent to your DM.", { message_thread_id: threadId });
      } catch (e) {
        console.error("[SubBot] /whois error:", e.message);
        const botUsername = ctx.me.username ? `@${ctx.me.username}` : "this bot";
        await ctx.reply(`⚠️ Couldn't send DM — make sure you've started a private chat with ${botUsername} first.`, { message_thread_id: threadId });
      }
      return;
    }

    // /blockuser — block the customer in this topic
    if (ctx.message.text === "/blockuser") {
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
      return;
    }

    // /unblockuser — unblock the customer in this topic
    if (ctx.message.text === "/unblockuser") {
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
      } await bot.api.reopenForumTopic(agentGroupId, threadId);
      } catch (e) {
        console.error("Failed to reopen/rename topic after unblock:", e.message);
      }
      return;
    }

    // /close — mark conversation closed, rename topic
    if (ctx.message.text === "/close") {
      const customer = await Customer.findOne({ tenantId, threadId });
      if (customer) {
        customer.status = "closed";
        await customer.save();
        await ctx.reply("✅ Conversation closed.", { message_thread_id: threadId });
        try {
          await bot.api.editForumTopic(agentGroupId, threadId, {
            name: `[done] ${customer.alias}`,
          });
          await bot.api.closeForumTopic(agentGroupId, threadId);
        } catch (e) {
          console.error("Failed to close/rename topic:", e.message);
        }
      }
      return;
    }

    // /note — internal note, not relayed to customer
    if (ctx.message.text && ctx.message.text.startsWith("/note ")) {
      await ctx.reply(`📝 Note: ${ctx.message.text.slice(6)}`, {
        message_thread_id: threadId,
      });
      return;
    }

    // /rename New Name — rename the current topic
    if (ctx.message.text && ctx.message.text.startsWith("/rename ")) {
      const newName = ctx.message.text.slice(8).trim();
      if (!newName) {
        return ctx.reply("Usage: /rename New Topic Name", { message_thread_id: threadId });
      }
      try {
        await bot.api.editForumTopic(agentGroupId, threadId, { name: newName.slice(0, 128) });
        await ctx.reply(`✅ Topic renamed to "${newName.slice(0, 128)}".`, { message_thread_id: threadId });
      } catch (e) {
        console.error("[SubBot] /rename error:", e.message);
        await ctx.reply(`⚠️ Failed to rename: ${e.message}`, { message_thread_id: threadId });
      }
      return;
    }

    // Regular agent reply — relay to customer
    await relayToCustomer(bot, tenantId, threadId, ctx.message);
  });

  return bot;
}

module.exports = { createSubBot };

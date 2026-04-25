const { Bot } = require("grammy");
const Customer = require("../db/models/customer");
const GroupMember = require("../db/models/group-member");
const Tenant = require("../db/models/tenant");
const TenantBot = require("../db/models/tenant-bot");
const { getOrCreateCustomer } = require("../relay/get-or-create-customer");
const { relayToAgents } = require("../relay/relay-to-agents");
const { relayToCustomer } = require("../relay/relay-to-customer");

// Customer DM commands
const { handleStart } = require("../commands/customer/start");
const { handleSetUsername } = require("../commands/customer/set-username");

// Agent group commands
const { handleClose } = require("../commands/agent/close");
const { handleWhois } = require("../commands/agent/whois");
const { handleBlock } = require("../commands/agent/block");
const { handleUnblock } = require("../commands/agent/unblock");
const { handleNote } = require("../commands/agent/note");
const { handleRename } = require("../commands/agent/rename");
const { handleTag } = require("../commands/agent/tag");
const { handleWelcomeUser } = require("../commands/agent/welcome-user");
const { handleBroadcast, handleBroadcastConfirm, handleBroadcastCancel } = require("../commands/agent/broadcast");
const { handleAssignBot, handleAssignBotCallback } = require("../commands/agent/assign-bot");
const { handleAgentHelp } = require("../commands/agent/help");

/**
 * Creates a configured grammY Bot instance for a tenant.
 * @param {string} token - Telegram bot token
 * @param {{ tenantId: string, agentGroupId: number }} tenant
 * @param {{ notifyActivation: (tenantId: string) => void, promoteBot: Function, masterBotKicked: Function, masterBotId: number }} [callbacks]
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

    // Bot was promoted to admin — activate the tenant bot
    if (newStatus === "administrator") {
      // Activate the TenantBot record
      const tb = await TenantBot.findOne({ tenantId, botToken: token });
      if (tb && tb.status === "pending") {
        tb.status = "active";
        await tb.save();
        console.log(`[SubBot] TenantBot ${tb._id} activated — bot is now admin in group.`);
      }

      // Also activate the tenant itself if it's still pending
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

  // --- Broadcast confirmation callbacks ---
  bot.on("callback_query:data", async (ctx, next) => {
    console.log(`[SubBot] callback_query received: data="${ctx.callbackQuery.data}", from=${ctx.from.id}, tenant=${tenantId}`);
    return next();
  });

  bot.callbackQuery(/^broadcast_confirm:(\d+)$/, async (ctx) => {
    await handleBroadcastConfirm(ctx, { tenantId, bot });
  });

  bot.callbackQuery(/^broadcast_cancel:(\d+)$/, async (ctx) => {
    await handleBroadcastCancel(ctx, { tenantId });
  });

  // --- Assign bot callback ---
  bot.callbackQuery(/^assignbot:(.+)$/, async (ctx) => {
    await handleAssignBotCallback(ctx, { tenantId });
  });

  // --- Customer DM handler ---
  bot.on("message", async (ctx, next) => {
    if (ctx.chat.type !== "private") return next();

    // /start command
    if (ctx.message.text === "/start") {
      return handleStart(ctx);
    }

    // /setusername command
    if (ctx.message.text && /^\/setusername(\s|$)/i.test(ctx.message.text)) {
      return handleSetUsername(ctx, { tenantId });
    }

    const customer = await getOrCreateCustomer(
      bot,
      tenantId,
      ctx.from.id,
      ctx.from,
      agentGroupId,
      { botToken: token }
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

    // Also skip messages sent by other bots in the same tenant group
    // (prevents bot A from processing bot B's relayed messages)
    if (ctx.from.is_bot && ctx.from.id !== ctx.me.id) {
      // Check if this is another tenant bot for the same group
      const otherBot = await TenantBot.findOne({
        tenantId,
        botToken: { $ne: token },
        status: { $in: ["active", "pending"] },
      });
      if (otherBot) {
        // Could be the other sub-bot — skip to avoid echo loops
        return;
      }
    }

    // Cache the sender's username → userId for @mention resolution
    if (ctx.from.username) {
      GroupMember.findOneAndUpdate(
        { groupId: agentGroupId, username: ctx.from.username.toLowerCase() },
        { userId: ctx.from.id, updatedAt: new Date() },
        { upsert: true }
      ).catch(() => {});
    }

    const threadId = ctx.message.message_thread_id;
    const cmdCtx = { tenantId, agentGroupId, threadId, bot };

    // /help — show agent commands
    if (ctx.message.text && /^\/help(\s|$)/i.test(ctx.message.text)) {
      return handleAgentHelp(ctx, cmdCtx);
    }

    // /broadcastallusers — broadcast a message to all customers
    if (
      (ctx.message.text && /^\/broadcastallusers(\s|$)/i.test(ctx.message.text)) ||
      (ctx.message.caption && /^\/broadcastallusers(\s|$)/i.test(ctx.message.caption))
    ) {
      return handleBroadcast(ctx, cmdCtx);
    }

    // /tag — set a custom title for a group member
    if (ctx.message.text && /^\/tag(\s|$)/.test(ctx.message.text)) {
      return handleTag(ctx, cmdCtx);
    }

    // /welcomeUser — proactively send the welcome message to a user
    if (ctx.message.text && /^\/welcomeUser(\s|$)/i.test(ctx.message.text)) {
      return handleWelcomeUser(ctx, cmdCtx);
    }

    // /assignbot — show inline keyboard to switch the customer's assigned bot
    if (ctx.message.text && /^\/assignbot(\s|$)/i.test(ctx.message.text)) {
      return handleAssignBot(ctx, cmdCtx);
    }

    if (!threadId) return;

    // /whois
    if (ctx.message.text === "/whois") {
      return handleWhois(ctx, cmdCtx);
    }

    // /blockuser
    if (ctx.message.text === "/blockuser") {
      return handleBlock(ctx, cmdCtx);
    }

    // /unblockuser
    if (ctx.message.text === "/unblockuser") {
      return handleUnblock(ctx, cmdCtx);
    }

    // /close
    if (ctx.message.text === "/close") {
      return handleClose(ctx, cmdCtx);
    }

    // /note
    if (ctx.message.text && ctx.message.text.startsWith("/note ")) {
      return handleNote(ctx, cmdCtx);
    }

    // /rename
    if (ctx.message.text && ctx.message.text.startsWith("/rename ")) {
      return handleRename(ctx, cmdCtx);
    }

    // Regular agent reply — relay to customer (with botToken for dedup)
    await relayToCustomer(bot, tenantId, threadId, ctx.message, { botToken: token });
  });

  return bot;
}

module.exports = { createSubBot };

const { Bot } = require("grammy");
const { Customer, Tenant } = require("./db");
const { getOrCreateCustomer, relayToAgents, relayToCustomer } = require("./relay");

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
        "Hey there 👋 Welcome to Paydora Support!\n\nJust type your question or describe your issue and one of our team members will be with you shortly. We're happy to help!"
      );
    }

    const customer = await getOrCreateCustomer(
      bot,
      tenantId,
      ctx.from.id,
      ctx.from,
      agentGroupId
    );
    await relayToAgents(bot, customer, ctx.message, agentGroupId);
  });

  // --- Agent group handler ---
  bot.on("message", async (ctx) => {
    if (ctx.chat.id !== agentGroupId) return;
    if (ctx.from.is_bot) return;

    const threadId = ctx.message.message_thread_id;
    if (!threadId) return;

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

    // Regular agent reply — relay to customer
    await relayToCustomer(bot, tenantId, threadId, ctx.message);
  });

  return bot;
}

module.exports = { createSubBot };

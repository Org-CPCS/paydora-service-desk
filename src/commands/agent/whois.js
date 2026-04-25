const Customer = require("../../db/models/customer");

/**
 * /whois — DM the requesting admin with the customer's real Telegram info.
 */
async function handleWhois(ctx, { tenantId, agentGroupId, threadId, bot }) {
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
}

module.exports = { handleWhois };

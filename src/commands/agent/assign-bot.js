const { InlineKeyboard } = require("grammy");
const Customer = require("../../db/models/customer");
const TenantBot = require("../../db/models/tenant-bot");

/**
 * /assignbot — show inline keyboard with available bots for this tenant.
 * Must be used inside a customer topic.
 */
async function handleAssignBot(ctx, { tenantId, threadId }) {
  const replyOpts = threadId ? { message_thread_id: threadId } : {};

  if (!threadId) {
    return ctx.reply("⚠️ Use /assignbot inside a customer topic.", replyOpts);
  }

  const customer = await Customer.findOne({ tenantId, threadId });
  if (!customer) {
    return ctx.reply("❓ No customer found for this topic.", replyOpts);
  }

  const bots = await TenantBot.find({ tenantId, status: { $in: ["active", "pending"] } });
  if (bots.length === 0) {
    return ctx.reply("⚠️ No bots configured for this tenant.", replyOpts);
  }

  const keyboard = new InlineKeyboard();
  for (const b of bots) {
    const label = b.botToken === customer.lastBotToken
      ? `✅ @${b.botUsername || "unknown"}`
      : `@${b.botUsername || "unknown"}`;
    keyboard.text(label, `assignbot:${b.botToken}`).row();
  }

  const currentBot = customer.lastBotToken
    ? bots.find((b) => b.botToken === customer.lastBotToken)
    : null;
  const currentLabel = currentBot
    ? `@${currentBot.botUsername || "unknown"}`
    : "none";

  return ctx.reply(
    `🤖 Assign a bot for ${customer.alias}\n\nCurrently assigned: ${currentLabel}\n\nSelect a bot:`,
    { ...replyOpts, reply_markup: keyboard }
  );
}

/**
 * Handle assignbot:<botToken> callback query.
 */
async function handleAssignBotCallback(ctx, { tenantId }) {
  const selectedToken = ctx.match[1];

  // Find the customer from the original message's thread
  // The callback comes from the inline keyboard posted in a topic
  const msg = ctx.callbackQuery.message;
  const threadId = msg?.message_thread_id;

  if (!threadId) {
    return ctx.answerCallbackQuery({ text: "Could not determine the topic.", show_alert: true });
  }

  const customer = await Customer.findOne({ tenantId, threadId });
  if (!customer) {
    return ctx.answerCallbackQuery({ text: "Customer not found.", show_alert: true });
  }

  // Verify the selected bot exists for this tenant
  const selectedBot = await TenantBot.findOne({ tenantId, botToken: selectedToken, status: { $in: ["active", "pending"] } });
  if (!selectedBot) {
    return ctx.answerCallbackQuery({ text: "Bot not found or inactive.", show_alert: true });
  }

  customer.lastBotToken = selectedToken;
  await customer.save();

  // Update the inline keyboard to show the new selection
  const bots = await TenantBot.find({ tenantId, status: { $in: ["active", "pending"] } });
  const keyboard = new InlineKeyboard();
  for (const b of bots) {
    const label = b.botToken === selectedToken
      ? `✅ @${b.botUsername || "unknown"}`
      : `@${b.botUsername || "unknown"}`;
    keyboard.text(label, `assignbot:${b.botToken}`).row();
  }

  await ctx.editMessageText(
    `🤖 Assign a bot for ${customer.alias}\n\nCurrently assigned: @${selectedBot.botUsername || "unknown"}\n\nSelect a bot:`,
    { reply_markup: keyboard }
  );
  return ctx.answerCallbackQuery({ text: `Assigned to @${selectedBot.botUsername || "unknown"}` });
}

module.exports = { handleAssignBot, handleAssignBotCallback };

const Tenant = require("../../db/models/tenant");
const Customer = require("../../db/models/customer");

/**
 * /messageallusers <tenant_id> <text> — broadcast a message to all customers of a tenant.
 */
async function handleMessageAllUsers(ctx, { botManager }) {
  const input = (ctx.match || "").trim();
  const spaceIdx = input.indexOf(" ");
  if (!input || spaceIdx === -1) {
    return ctx.reply("Usage: /messageAllUsers <tenant_id> <text>");
  }

  const tenantId = input.slice(0, spaceIdx);
  const text = input.slice(spaceIdx + 1).trim();
  if (!text) return ctx.reply("Please provide a message to send.");

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

  const entry = botManager.getBotForTenant(tenantId);
  if (!entry) {
    return ctx.reply(`Sub-bot for tenant ${tenantId} is not running. Try /start ${tenantId} first.`);
  }

  const customers = await Customer.find({ tenantId: tenant._id, status: { $ne: "blocked" } });
  if (customers.length === 0) {
    return ctx.reply(`No customers found for tenant ${tenantId}.`);
  }

  await ctx.reply(`📤 Sending message to ${customers.length} customer${customers.length === 1 ? "" : "s"}...`);

  let sent = 0;
  let failed = 0;
  for (const c of customers) {
    try {
      await entry.bot.api.sendMessage(c.telegramUserId, text);
      sent++;
    } catch (err) {
      failed++;
      console.error(`[MasterBot] /messageAllUsers failed for user ${c.telegramUserId}:`, err.message);
    }
  }

  return ctx.reply(`✅ Broadcast complete: ${sent} sent, ${failed} failed.`);
}

/**
 * /message <tenant_id> <telegram_user_id> <text> — send a message to a customer via the sub-bot.
 */
async function handleMessage(ctx, { botManager }) {
  const input = (ctx.match || "").trim();
  const parts = input.split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply("Usage: /message <tenant_id> <telegram_user_id> <text>");
  }

  const tenantId = parts[0];
  const userId = Number(parts[1]);
  const text = input.slice(input.indexOf(parts[2]));

  if (!Number.isFinite(userId)) {
    return ctx.reply("Invalid telegram_user_id — must be a number.");
  }

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

  const entry = botManager.getBotForTenant(tenantId);
  if (!entry) {
    return ctx.reply(`Sub-bot for tenant ${tenantId} is not running. Try /start ${tenantId} first.`);
  }

  try {
    await entry.bot.api.sendMessage(userId, text);
    return ctx.reply(`✅ Message sent to user ${userId} via @${tenant.botUsername}.`);
  } catch (err) {
    return ctx.reply(`⚠️ Failed to send message: ${err.message}`);
  }
}

module.exports = { handleMessageAllUsers, handleMessage };

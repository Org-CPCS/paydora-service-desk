const { Bot } = require("grammy");
const Tenant = require("../../db/models/tenant");
const TenantBot = require("../../db/models/tenant-bot");

/**
 * /addbot <tenant_id> <bot_token> — add an additional bot to an existing tenant.
 */
async function handleAddBot(ctx, { bot, botManager }) {
  const match = (ctx.match || "").trim();
  const spaceIdx = match.indexOf(" ");
  if (!match || spaceIdx === -1) {
    return ctx.reply("Usage: /addbot <tenant_id> <bot_token>");
  }

  const tenantId = match.slice(0, spaceIdx);
  const botToken = match.slice(spaceIdx + 1).trim();

  if (!botToken) {
    return ctx.reply("Please provide a bot token.");
  }

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) {
    return ctx.reply(`Tenant ${tenantId} not found.`);
  }

  // Check for duplicate bot token
  const existingTenantBot = await TenantBot.findOne({ botToken });
  if (existingTenantBot) {
    return ctx.reply(`This bot token is already registered (tenant bot: ${existingTenantBot._id}).`);
  }

  // Validate token by calling getMe
  let meResult;
  try {
    const testBot = new Bot(botToken);
    meResult = await testBot.api.getMe();
  } catch (err) {
    return ctx.reply(`Invalid bot token: ${err.message}`);
  }

  // Create TenantBot record in pending status
  const tenantBot = await TenantBot.create({
    tenantId: tenant._id,
    botToken,
    botUsername: meResult.username,
    status: "pending",
  });

  // Also ensure the primary bot has a TenantBot record (migration for existing tenants)
  const existingPrimary = await TenantBot.findOne({ tenantId: tenant._id, botToken: tenant.botToken });
  if (!existingPrimary) {
    await TenantBot.create({
      tenantId: tenant._id,
      botToken: tenant.botToken,
      botUsername: tenant.botUsername,
      status: tenant.status === "removed" ? "removed" : "active",
    });
  }

  await ctx.reply(
    `✅ Bot @${meResult.username} added to tenant ${tenantId} (pending setup).\n\n` +
    `Bot ID: ${tenantBot._id}\n\n` +
    `👉 Next step: Add @${meResult.username} to the agent group and promote it to admin.\n` +
    `It will activate automatically once promoted.`
  );

  // Start the bot so it can listen for my_chat_member updates
  try {
    await botManager.startBot(tenant, botToken);
  } catch (err) {
    console.error(`[MasterBot] Failed to start additional bot for tenant ${tenantId}:`, err.message);
    await ctx.reply(`⚠️ Bot failed to start: ${err.message}\nTry restarting the tenant with /start ${tenantId}.`);
  }
}

module.exports = { handleAddBot };

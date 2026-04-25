const Tenant = require("../../db/models/tenant");
const TenantBot = require("../../db/models/tenant-bot");

/**
 * /stop <tenant_id> — pause a tenant.
 */
async function handleStop(ctx, { botManager }) {
  const tenantId = (ctx.match || "").trim();
  if (!tenantId) return ctx.reply("Usage: /stop <tenant_id>");

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

  tenant.status = "inactive";
  await tenant.save();
  await botManager.stopBot(tenantId);
  return ctx.reply(`⏹ Tenant ${tenantId} stopped. Status set to inactive.`);
}

/**
 * /start <tenant_id> — resume a tenant.
 */
async function handleStart(ctx, { botManager }) {
  const tenantId = (ctx.match || "").trim();
  if (!tenantId) return ctx.reply("Usage: /start <tenant_id>");

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

  tenant.status = "active";
  await tenant.save();
  await botManager.startBot(tenant);
  return ctx.reply(`▶️ Tenant ${tenantId} started. Status set to active.`);
}

/**
 * /remove <tenant_id> — remove a tenant.
 */
async function handleRemove(ctx, { botManager }) {
  const tenantId = (ctx.match || "").trim();
  if (!tenantId) return ctx.reply("Usage: /remove <tenant_id>");

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

  await botManager.stopBot(tenantId);
  tenant.status = "removed";
  await tenant.save();
  return ctx.reply(`🗑 Tenant ${tenantId} removed.`);
}

/**
 * /list — list all registered tenants.
 */
async function handleList(ctx) {
  const tenants = await Tenant.find();
  if (tenants.length === 0) return ctx.reply("No tenants registered.");

  const lines = await Promise.all(
    tenants.map(async (t) => {
      const botCount = await TenantBot.countDocuments({ tenantId: t._id, status: { $ne: "removed" } });
      const botLabel = botCount > 1 ? ` (${botCount} bots)` : "";
      return `• ${t._id} — @${t.botUsername || "unknown"} — ${t.status}${botLabel}`;
    })
  );
  return ctx.reply(`Registered tenants:\n${lines.join("\n")}\n\nUse /listbots <tenant_id> for details.`);
}

/**
 * /status <tenant_id> — check a tenant's status.
 */
async function handleStatus(ctx, { botManager }) {
  const tenantId = (ctx.match || "").trim();
  if (!tenantId) return ctx.reply("Usage: /status <tenant_id>");

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

  const botStatus = botManager.getStatus(tenantId);
  let uptimeStr = "N/A";
  if (botStatus && botStatus.startedAt) {
    const ms = Date.now() - botStatus.startedAt.getTime();
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    uptimeStr = `${hrs}h ${mins % 60}m ${secs % 60}s`;
  }

  return ctx.reply(
    `Tenant: ${tenantId}\nStatus: ${tenant.status}\nBot: @${tenant.botUsername || "unknown"}\nUptime: ${uptimeStr}`
  );
}

module.exports = { handleStop, handleStart, handleRemove, handleList, handleStatus };

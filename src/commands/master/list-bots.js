const Tenant = require("../../db/models/tenant");
const TenantBot = require("../../db/models/tenant-bot");

/**
 * /listbots <tenant_id> — show all bots assigned to a tenant.
 */
async function handleListBots(ctx, { botManager }) {
  const tenantId = (ctx.match || "").trim();
  if (!tenantId) return ctx.reply("Usage: /listbots <tenant_id>");

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

  const tenantBots = await TenantBot.find({ tenantId: tenant._id, status: { $ne: "removed" } });

  if (tenantBots.length === 0) {
    // Legacy tenant with no TenantBot records — show the primary bot
    const status = botManager.getStatus(tenantId);
    const running = status ? "🟢 running" : "🔴 stopped";
    return ctx.reply(
      `🤖 Bots for tenant ${tenantId}:\n\n` +
      `• @${tenant.botUsername || "unknown"} — ${tenant.status} — ${running} (primary)`
    );
  }

  const lines = tenantBots.map((tb) => {
    // Check if this specific bot is running
    const key = `${tenantId}:${tb.botToken}`;
    const entry = botManager.bots.get(key);
    const running = entry ? "🟢 running" : "🔴 stopped";
    return `• @${tb.botUsername || "unknown"} — ${tb.status} — ${running}`;
  });

  return ctx.reply(
    `🤖 ${tenantBots.length} bot${tenantBots.length === 1 ? "" : "s"} for tenant ${tenantId} (@${tenant.botUsername || "unknown"}):\n\n` +
    lines.join("\n")
  );
}

module.exports = { handleListBots };

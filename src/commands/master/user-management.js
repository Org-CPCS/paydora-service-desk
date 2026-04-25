const Tenant = require("../../db/models/tenant");
const Customer = require("../../db/models/customer");

/**
 * /listusers <tenant_id> — list all customers who messaged a tenant's bot.
 */
async function handleListUsers(ctx) {
  const tenantId = (ctx.match || "").trim();
  if (!tenantId) return ctx.reply("Usage: /listusers <tenant_id>");

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

  const customers = await Customer.find({ tenantId: tenant._id });
  if (customers.length === 0) {
    return ctx.reply(`No customers found for tenant ${tenantId}.`);
  }

  const lines = customers.map((c) => {
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "N/A";
    const username = c.username ? `@${c.username}` : "no username";
    return `• ${c.alias} — ${name} (${username}) — ID: ${c.telegramUserId} — ${c.status}`;
  });

  const header = `👥 ${customers.length} customer${customers.length === 1 ? "" : "s"} for tenant ${tenantId}:\n\n`;

  // Telegram message limit is 4096 chars — chunk to stay under it
  const MAX_LEN = 4000;
  const chunks = [];
  let current = header;

  for (const line of lines) {
    if ((current + line + "\n").length > MAX_LEN) {
      chunks.push(current);
      current = "";
    }
    current += line + "\n";
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

/**
 * /usercount <tenant_id> — show number of customers who messaged a tenant's bot.
 */
async function handleUserCount(ctx) {
  const tenantId = (ctx.match || "").trim();
  if (!tenantId) return ctx.reply("Usage: /usercount <tenant_id>");

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

  const count = await Customer.countDocuments({ tenantId: tenant._id });
  return ctx.reply(`👥 Tenant ${tenantId} (@${tenant.botUsername || "unknown"}) has ${count} customer${count === 1 ? "" : "s"}.`);
}

module.exports = { handleListUsers, handleUserCount };

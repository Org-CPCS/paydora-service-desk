const { Bot } = require("grammy");
const { Tenant } = require("./db");

/**
 * Creates the Master Bot for tenant management.
 * Only the Super Admin (identified by superAdminId) can interact with this bot.
 * @param {string} token - Master bot Telegram token
 * @param {string|number} superAdminId - Telegram user ID of the Super Admin
 * @param {import('./bot-manager').BotManager} botManager
 * @returns {Bot}
 */
function createMasterBot(token, superAdminId, botManager) {
  const bot = new Bot(token);
  const adminId = Number(superAdminId);

  // Auth middleware — silently ignore non-Super-Admin senders
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.id !== adminId) return;
    return next();
  });

  // /help — step-by-step guide for registering a new tenant
  bot.command("help", async (ctx) => {
    return ctx.reply(
`📖 How to register a new support bot

Step 1️⃣  Create a new bot
Open Telegram, search for @BotFather, send /newbot, and follow the prompts. You'll get a bot token (looks like 7123456789:AAH...). Save it.

Step 2️⃣  Create an agent group
Create a new Telegram group for your support team. Go to group settings → enable Topics (you may need to convert it to a supergroup first).

Step 3️⃣  Add the bot to the group as admin
Open the group → Add Members → search for your new bot → then promote it to admin. Make sure it has permission to manage topics.

Step 4️⃣  Get the group ID
Add @raw_data_bot to your group, send any message, and it will reply with the chat ID (a negative number like -1001234567890). Copy that number, then remove @raw_data_bot.

Step 5️⃣  Register!
Send me this command with your details:
/register <bot_token> <group_id>

Example:
/register 7123456789:AAHxyz -1001234567890

That's it! The support bot will start immediately. 🎉

Other commands:
/list — See all registered bots
/status <tenant_id> — Check a bot's status
/stop <tenant_id> — Pause a bot
/start <tenant_id> — Resume a bot
/remove <tenant_id> — Remove a bot`
    );
  });

  // /register <bot_token> <agent_group_id>
  bot.command("register", async (ctx) => {
    const args = (ctx.match || "").trim().split(/\s+/);
    if (args.length < 2 || !args[0]) {
      return ctx.reply("Usage: /register <bot_token> <agent_group_id>");
    }

    const [botToken, agentGroupIdStr] = args;
    const agentGroupId = Number(agentGroupIdStr);

    if (!Number.isFinite(agentGroupId)) {
      return ctx.reply("Invalid argument: agent_group_id must be a number.");
    }

    // Check for duplicate bot token
    const existing = await Tenant.findOne({ botToken });
    if (existing) {
      return ctx.reply(
        `A tenant with this bot token is already registered (tenant: ${existing._id}).`
      );
    }

    // Validate token by calling getMe
    let meResult;
    try {
      const testBot = new Bot(botToken);
      meResult = await testBot.api.getMe();
    } catch (err) {
      return ctx.reply(`Invalid bot token: ${err.message}`);
    }

    // Verify bot is admin in the agent group
    try {
      const admins = await new Bot(botToken).api.getChatAdministrators(agentGroupId);
      const isAdmin = admins.some((a) => a.user.id === meResult.id);
      if (!isAdmin) {
        return ctx.reply(
          `Bot is not an admin in group ${agentGroupId}. Add the bot as admin with topic management permissions.`
        );
      }
    } catch (err) {
      return ctx.reply(
        `Bot is not an admin in group ${agentGroupId}. Add the bot as admin with topic management permissions.`
      );
    }

    // Create tenant record
    const tenant = await Tenant.create({
      botToken,
      botUsername: meResult.username,
      agentGroupId,
      status: "active",
    });

    // Start the Sub-Bot immediately
    try {
      await botManager.startBot(tenant);
    } catch (err) {
      console.error(`[MasterBot] Failed to start Sub-Bot for tenant ${tenant._id}:`, err.message);
    }

    return ctx.reply(
      `✅ Tenant registered!\nBot: @${meResult.username}\nTenant ID: ${tenant._id}`
    );
  });

  // /stop <tenant_id>
  bot.command("stop", async (ctx) => {
    const tenantId = (ctx.match || "").trim();
    if (!tenantId) return ctx.reply("Usage: /stop <tenant_id>");

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

    tenant.status = "inactive";
    await tenant.save();
    await botManager.stopBot(tenantId);
    return ctx.reply(`⏹ Tenant ${tenantId} stopped. Status set to inactive.`);
  });

  // /start <tenant_id>
  bot.command("start", async (ctx) => {
    const tenantId = (ctx.match || "").trim();
    if (!tenantId) return ctx.reply("Usage: /start <tenant_id>");

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

    tenant.status = "active";
    await tenant.save();
    await botManager.startBot(tenant);
    return ctx.reply(`▶️ Tenant ${tenantId} started. Status set to active.`);
  });

  // /remove <tenant_id>
  bot.command("remove", async (ctx) => {
    const tenantId = (ctx.match || "").trim();
    if (!tenantId) return ctx.reply("Usage: /remove <tenant_id>");

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

    await botManager.stopBot(tenantId);
    tenant.status = "removed";
    await tenant.save();
    return ctx.reply(`🗑 Tenant ${tenantId} removed.`);
  });

  // /list
  bot.command("list", async (ctx) => {
    const tenants = await Tenant.find();
    if (tenants.length === 0) return ctx.reply("No tenants registered.");

    const lines = tenants.map(
      (t) => `• ${t._id} — @${t.botUsername || "unknown"} — ${t.status}`
    );
    return ctx.reply(`Registered tenants:\n${lines.join("\n")}`);
  });

  // /status <tenant_id>
  bot.command("status", async (ctx) => {
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
  });

  return bot;
}

module.exports = { createMasterBot };

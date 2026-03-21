const { Bot } = require("grammy");
const { Tenant, EmptyGroup } = require("./db");

/**
 * Creates the Master Bot for tenant management.
 * Multiple Super Admins (comma-separated IDs) can interact with this bot.
 * @param {string} token - Master bot Telegram token
 * @param {string} superAdminIds - Comma-separated Telegram user IDs
 * @param {import('./bot-manager').BotManager} botManager
 * @returns {Bot}
 */
function createMasterBot(token, superAdminIds, botManager) {
  const bot = new Bot(token);
  const adminIds = superAdminIds.split(",").map((id) => Number(id.trim()));

  // Auth middleware — silently ignore non-Super-Admin senders
  bot.use(async (ctx, next) => {
    if (!ctx.from || !adminIds.includes(ctx.from.id)) return;
    return next();
  });

  // /help — step-by-step guide
  bot.command("help", async (ctx) => {
    return ctx.reply(
`📖 How to register a new support bot

Step 1️⃣  Check available groups
Send /listgroups to see pre-configured groups ready to use. If none are available, ask the technical admin to add one.

Step 2️⃣  Create a bot
Open Telegram, search for @BotFather, send /newbot, and follow the prompts. You'll get a bot token (looks like 7123456789:AAH...). Save it.

Step 3️⃣  Register
Send this command:
/register <bot_token> <group_name>

Example:
/register 7123456789:AAHxyz Acme Support

Step 4️⃣  Add the bot to the group
After registering, I'll give you an invite link and the bot's username. Open the group using the invite link, then add the bot (@BotUsername) as a member and promote it to admin with topic management permissions.

Once the bot detects it's been added as admin, it will start automatically and I'll confirm here. ✅

━━━━━━━━━━━━━━━━━━━━━━
📋 All commands:

Group prep (technical admin):
/addgroup <group_id> — Add a pre-configured empty group
/removegroup <group_id> — Remove a group from the pool
/listgroups — See available groups

Tenant management:
/register <bot_token> <group_name> — Register a new tenant
/list — See all registered tenants
/status <tenant_id> — Check a tenant's status
/stop <tenant_id> — Pause a tenant
/start <tenant_id> — Resume a tenant
/remove <tenant_id> — Remove a tenant`
    );
  });

  // /addgroup <group_id> — pre-provision an empty group (technical admin)
  bot.command("addgroup", async (ctx) => {
    const groupIdStr = (ctx.match || "").trim();
    if (!groupIdStr) {
      return ctx.reply("Usage: /addgroup <group_id>");
    }

    const groupId = Number(groupIdStr);
    if (!Number.isFinite(groupId)) {
      return ctx.reply("Invalid argument: group_id must be a number.");
    }

    const existingGroup = await EmptyGroup.findOne({ groupId });
    if (existingGroup) {
      return ctx.reply(`Group ${groupId} is already in the pool.`);
    }

    const existingTenant = await Tenant.findOne({ agentGroupId: groupId });
    if (existingTenant) {
      return ctx.reply(`Group ${groupId} is already assigned to tenant ${existingTenant._id}.`);
    }

    await EmptyGroup.create({ groupId });
    return ctx.reply(`✅ Group ${groupId} added to the pool. It's now available for /register.`);
  });

  // /listgroups — show available pre-configured groups
  bot.command("listgroups", async (ctx) => {
    const groups = await EmptyGroup.find();
    if (groups.length === 0) {
      return ctx.reply("No available groups. Ask the technical admin to add one with /addgroup.");
    }

    const lines = await Promise.all(
      groups.map(async (g) => {
        let title = "Unknown";
        try {
          const chat = await bot.api.getChat(g.groupId);
          title = chat.title || "Untitled";
        } catch (_) {}
        return `• ${title} (${g.groupId}) — added ${g.createdAt.toLocaleDateString()}`;
      })
    );
    return ctx.reply(`📦 ${groups.length} group${groups.length === 1 ? "" : "s"} ready to assign:\n${lines.join("\n")}`);
  });

  // /removegroup <group_id> — remove a group from the pool
  bot.command("removegroup", async (ctx) => {
    const groupIdStr = (ctx.match || "").trim();
    if (!groupIdStr) {
      return ctx.reply("Usage: /removegroup <group_id>");
    }

    const groupId = Number(groupIdStr);
    if (!Number.isFinite(groupId)) {
      return ctx.reply("Invalid argument: group_id must be a number.");
    }

    const result = await EmptyGroup.deleteOne({ groupId });
    if (result.deletedCount === 0) {
      return ctx.reply(`Group ${groupId} is not in the pool.`);
    }

    return ctx.reply(`✅ Group ${groupId} removed from the pool.`);
  });

  // /register <bot_token> <group_name> — register a tenant, pending bot addition to group
  bot.command("register", async (ctx) => {
    const match = (ctx.match || "").trim();
    const spaceIdx = match.indexOf(" ");
    if (!match || spaceIdx === -1) {
      return ctx.reply("Usage: /register <bot_token> <group_name>");
    }

    const botToken = match.slice(0, spaceIdx);
    const groupName = match.slice(spaceIdx + 1).trim();

    if (!groupName) {
      return ctx.reply("Please provide a group name.");
    }

    // Check for duplicate bot token
    const existing = await Tenant.findOne({ botToken });
    if (existing) {
      return ctx.reply(`This bot token is already registered (tenant: ${existing._id}).`);
    }

    // Validate token by calling getMe
    let meResult;
    try {
      const testBot = new Bot(botToken);
      meResult = await testBot.api.getMe();
    } catch (err) {
      return ctx.reply(`Invalid bot token: ${err.message}`);
    }

    // Pick the next available empty group
    const emptyGroup = await EmptyGroup.findOne();
    if (!emptyGroup) {
      return ctx.reply("No available groups. Ask the technical admin to add one with /addgroup.");
    }

    const groupId = emptyGroup.groupId;

    // Rename the group using the Master Bot (which should already be admin since you created it)
    try {
      await bot.api.setChatTitle(groupId, groupName);
    } catch (err) {
      return ctx.reply(`Failed to rename group: ${err.message}\nMake sure the Master Bot is an admin in group ${groupId}.`);
    }

    // Generate invite link via the Master Bot
    let inviteLink;
    try {
      const result = await bot.api.createChatInviteLink(groupId, {
        name: `Invite for ${groupName}`,
      });
      inviteLink = result.invite_link;
    } catch (err) {
      console.error("[MasterBot] Failed to create invite link:", err.message);
      inviteLink = "(could not generate — add members manually)";
    }

    // Create tenant in "pending" status — will activate when sub-bot is added as admin
    const tenant = await Tenant.create({
      botToken,
      botUsername: meResult.username,
      agentGroupId: groupId,
      status: "pending",
    });

    // Remove from empty groups pool
    await EmptyGroup.deleteOne({ _id: emptyGroup._id });

    // Start the sub-bot so it can listen for my_chat_member updates
    try {
      await botManager.startBot(tenant);
    } catch (err) {
      console.error(`[MasterBot] Failed to start Sub-Bot for tenant ${tenant._id}:`, err.message);
    }

    return ctx.reply(
      `✅ Tenant created (pending bot setup)!\n\nBot: @${meResult.username}\nGroup: ${groupName}\nTenant ID: ${tenant._id}\n\n🔗 Group invite link:\n${inviteLink}\n\n👉 Next step: Open the group and add @${meResult.username} as a member, then promote it to admin with topic management permissions.\n\nOnce the bot is admin, it will activate automatically.`
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

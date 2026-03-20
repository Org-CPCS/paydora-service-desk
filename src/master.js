const { Bot } = require("grammy");
const { Tenant, EmptyGroup } = require("./db");

/**
 * Creates the Master Bot for tenant management.
 * Multiple Super Admins (comma-separated IDs) can interact with this bot.
 * @param {string} token - Master bot Telegram token
 * @param {string} superAdminIds - Comma-separated Telegram user IDs of Super Admins
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
Send /listgroups to see pre-configured groups ready to use.

Step 2️⃣  Register a new tenant
Send this command:
/register <admin_user_id> <group_name>

The admin_user_id is the Telegram user ID of the person who will manage the support group. They can get it by messaging @userinfobot.

The system will automatically:
• Pick an available group
• Rename it to your chosen name
• Start the support bot
• Generate an invite link for the admin

Example:
/register 987654321 Acme Support

That's it! Share the invite link with the admin. 🎉

━━━━━━━━━━━━━━━━━━━━━━
📋 All commands:

Group management:
/addgroup <group_id> <bot_token> — Add a pre-configured group
/listgroups — See available groups

Tenant management:
/register <admin_user_id> <group_name> — Register a new tenant
/list — See all registered tenants
/status <tenant_id> — Check a tenant's status
/stop <tenant_id> — Pause a tenant
/start <tenant_id> — Resume a tenant
/remove <tenant_id> — Remove a tenant`
    );
  });

  // /addgroup <group_id> <bot_token> — pre-provision an empty group
  bot.command("addgroup", async (ctx) => {
    const args = (ctx.match || "").trim().split(/\s+/);
    if (args.length < 2 || !args[0]) {
      return ctx.reply("Usage: /addgroup <group_id> <bot_token>");
    }

    const [groupIdStr, botToken] = args;
    const groupId = Number(groupIdStr);

    if (!Number.isFinite(groupId)) {
      return ctx.reply("Invalid argument: group_id must be a number.");
    }

    // Check if group already exists
    const existingGroup = await EmptyGroup.findOne({ groupId });
    if (existingGroup) {
      return ctx.reply(`Group ${groupId} is already added.`);
    }

    // Check if group is already used by a tenant
    const existingTenant = await Tenant.findOne({ agentGroupId: groupId });
    if (existingTenant) {
      return ctx.reply(`Group ${groupId} is already assigned to tenant ${existingTenant._id}.`);
    }

    // Validate bot token
    let meResult;
    try {
      const testBot = new Bot(botToken);
      meResult = await testBot.api.getMe();
    } catch (err) {
      return ctx.reply(`Invalid bot token: ${err.message}`);
    }

    // Verify bot is admin in the group
    try {
      const admins = await new Bot(botToken).api.getChatAdministrators(groupId);
      const isAdmin = admins.some((a) => a.user.id === meResult.id);
      if (!isAdmin) {
        return ctx.reply(
          `Bot @${meResult.username} is not an admin in group ${groupId}. Add the bot as admin first.`
        );
      }
    } catch (err) {
      return ctx.reply(
        `Could not verify bot in group ${groupId}. Make sure the bot is added as admin.`
      );
    }

    await EmptyGroup.create({
      groupId,
      botToken,
      botUsername: meResult.username,
    });

    return ctx.reply(
      `✅ Group added!\nGroup ID: ${groupId}\nBot: @${meResult.username}\n\nThis group is now available for /register.`
    );
  });

  // /listgroups — show available pre-configured groups
  bot.command("listgroups", async (ctx) => {
    const groups = await EmptyGroup.find();
    if (groups.length === 0) {
      return ctx.reply("No available groups. Use /addgroup to add one.");
    }

    const lines = groups.map(
      (g) => `• Group ${g.groupId} — @${g.botUsername || "unknown"} — added ${g.createdAt.toLocaleDateString()}`
    );
    return ctx.reply(`Available groups (${groups.length}):\n${lines.join("\n")}`);
  });

  // /register <admin_user_id> <group_name> — register a new tenant using a pre-configured group
  bot.command("register", async (ctx) => {
    const match = (ctx.match || "").trim();
    const spaceIdx = match.indexOf(" ");
    if (!match || spaceIdx === -1) {
      return ctx.reply("Usage: /register <admin_user_id> <group_name>");
    }

    const adminUserIdStr = match.slice(0, spaceIdx);
    const groupName = match.slice(spaceIdx + 1).trim();
    const adminUserId = Number(adminUserIdStr);

    if (!Number.isFinite(adminUserId)) {
      return ctx.reply("Invalid argument: admin_user_id must be a number.");
    }
    if (!groupName) {
      return ctx.reply("Please provide a group name.");
    }

    // Pick the next available empty group
    const emptyGroup = await EmptyGroup.findOne();
    if (!emptyGroup) {
      return ctx.reply("No available groups. Ask the technical admin to add one with /addgroup.");
    }

    const { groupId, botToken, botUsername } = emptyGroup;

    // Check for duplicate bot token (shouldn't happen, but just in case)
    const existing = await Tenant.findOne({ botToken });
    if (existing) {
      return ctx.reply(`Bot @${botUsername} is already registered as tenant ${existing._id}.`);
    }

    // Rename the group
    try {
      await new Bot(botToken).api.setChatTitle(groupId, groupName);
    } catch (err) {
      return ctx.reply(`Failed to rename group: ${err.message}`);
    }

    // Generate invite link for the admin
    let inviteLink;
    try {
      const result = await new Bot(botToken).api.createChatInviteLink(groupId, {
        name: `Invite for ${groupName}`,
      });
      inviteLink = result.invite_link;
    } catch (err) {
      console.error("[MasterBot] Failed to create invite link:", err.message);
      inviteLink = "(could not generate invite link — add admin manually)";
    }

    // Create tenant record
    const tenant = await Tenant.create({
      botToken,
      botUsername,
      agentGroupId: groupId,
      status: "active",
    });

    // Remove from empty groups pool
    await EmptyGroup.deleteOne({ _id: emptyGroup._id });

    // Start the Sub-Bot immediately
    try {
      await botManager.startBot(tenant);
    } catch (err) {
      console.error(`[MasterBot] Failed to start Sub-Bot for tenant ${tenant._id}:`, err.message);
    }

    return ctx.reply(
      `✅ Tenant registered!\n\nBot: @${botUsername}\nGroup: ${groupName}\nTenant ID: ${tenant._id}\n\n🔗 Invite link for the admin:\n${inviteLink}\n\nShare this link with the admin (user ID: ${adminUserId}) so they can join the group.`
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

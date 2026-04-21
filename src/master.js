const { Bot } = require("grammy");
const { Tenant, EmptyGroup, Customer } = require("./db");

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
Send /listgroups to see pre-configured groups ready to use. If none are available, see /grouphelp for exact steps on how to prepare one.

Step 2️⃣  Create a bot
Open Telegram, search for @BotFather, send /newbot, and follow the prompts. You'll get a bot token (looks like 7123456789:AAH...). Save it.

Step 3️⃣  Register
Send this command:
/register <bot_token> <display_name>

The display_name is the name you want for this tenant's support group (e.g. your company or brand name). It doesn't need to match any existing group name — the system will rename the assigned group for you.

Example:
/register 7123456789:AAHxyz... Yanis Support
/register 8631872902:AAEAmy... Mirage

Step 4️⃣  Add the bot to the group
After registering, I'll give you an invite link and the bot's username. Open the group using the invite link, then add the bot (@BotUsername) as a member.

The bot will be promoted to admin automatically. Once that's done, it will activate and I'll confirm here. ✅

━━━━━━━━━━━━━━━━━━━━━━
📋 All commands:

Group prep (technical admin):
/grouphelp — Step-by-step guide to prepare a new group
/validate <group_id> — Check if a group is ready to be assigned
/addgroup <group_id> — Add a pre-configured empty group
/removegroup <group_id> — Remove a group from the pool
/listgroups — See available groups

Tenant management:
/register <bot_token> <group_name> — Register a new tenant
/list — See all registered tenants
/listusers <tenant_id> — List all customers for a tenant
/status <tenant_id> — Check a tenant's status
/stop <tenant_id> — Pause a tenant
/start <tenant_id> — Resume a tenant
/remove <tenant_id> — Remove a tenant`
    );
  });

  // /grouphelp — step-by-step guide to prepare a new agent group
  bot.command("grouphelp", async (ctx) => {
    return ctx.reply(
`🛠 How to prepare a new agent group

Step 1️⃣  Create a new Telegram group
Open Telegram and create a new group with any name (e.g. "EmptyGroup1", "EmptyGroup2"). You can add just yourself for now.

Step 2️⃣  Add @PaydoraMasterBot to the group
Search for @PaydoraMasterBot and add it as a member.

Step 3️⃣  Promote @PaydoraMasterBot to admin
Go to the group info → Members → tap on @PaydoraMasterBot → Promote to Admin. Make sure it has permissions to manage topics, delete messages, and invite users.

Step 4️⃣  Enable Topics
Go to Edit Group (pencil icon) → Topics → turn ON. This converts the group into a supergroup with forum topics.

Step 5️⃣  Get the group ID
Add @RawDataBot (or any group-info bot) to the group. It will send a message showing the chat ID (a negative number like -1001234567890). Copy that number, then remove the info bot.

Step 6️⃣  Add the group to the pool
Send this command to me:
/addgroup <group_id>

Example:
/addgroup -1001234567890

💡 Tip: Before adding, you can run /validate <group_id> to check everything is set up correctly.

Step 7️⃣  Verify
Send /listgroups to confirm the group appears in the available pool.

✅ The group is now ready to be assigned to a tenant via /register.`
    );
  });

  // /validate <group_id> — check if a group is ready to be assigned
  bot.command("validate", async (ctx) => {
    const groupIdStr = (ctx.match || "").trim();
    if (!groupIdStr) {
      return ctx.reply("Usage: /validate <group_id>");
    }

    const groupId = Number(groupIdStr);
    if (!Number.isFinite(groupId)) {
      return ctx.reply("Invalid argument: group_id must be a number.");
    }

    const checks = [];
    let chat;

    // 1. Can the bot access the group?
    try {
      chat = await bot.api.getChat(groupId);
      checks.push("✅ Bot has access to the group");
    } catch (err) {
      checks.push("❌ Bot cannot access the group — make sure @PaydoraMasterBot is a member");
      return ctx.reply(`Validation results for ${groupId}:\n\n${checks.join("\n")}\n\nFix this first, then re-run /validate.`);
    }

    // 2. Is it a supergroup?
    if (chat.type === "supergroup") {
      checks.push("✅ Group is a supergroup");
    } else {
      checks.push(`❌ Group is a "${chat.type}" — it must be a supergroup. Enable Topics in group settings to convert it.`);
    }

    // 3. Are topics (forum) enabled?
    if (chat.is_forum) {
      checks.push("✅ Topics are enabled");
    } else {
      checks.push("❌ Topics are not enabled — go to Edit Group → Topics → turn ON");
    }

    // 4. Is the bot an admin?
    let botMember;
    try {
      const me = await bot.api.getMe();
      botMember = await bot.api.getChatMember(groupId, me.id);
    } catch (err) {
      checks.push("❌ Could not check bot's admin status");
      return ctx.reply(`Validation results for ${groupId}:\n\n${checks.join("\n")}`);
    }

    if (botMember.status === "administrator" || botMember.status === "creator") {
      checks.push("✅ Bot is an admin");

      // 5. Check specific permissions
      if (botMember.status === "administrator") {
        const perms = [];
        if (botMember.can_manage_topics) {
          perms.push("✅ Can manage topics");
        } else {
          perms.push("❌ Cannot manage topics — enable this permission");
        }
        if (botMember.can_delete_messages) {
          perms.push("✅ Can delete messages");
        } else {
          perms.push("⚠️ Cannot delete messages (optional but recommended)");
        }
        if (botMember.can_invite_users) {
          perms.push("✅ Can invite users");
        } else {
          perms.push("⚠️ Cannot invite users (needed for generating invite links)");
        }
        checks.push(...perms);
      }
    } else {
      checks.push("❌ Bot is not an admin — promote @PaydoraMasterBot to admin with topic management permissions");
    }

    // 6. Already in pool or assigned?
    const inPool = await EmptyGroup.findOne({ groupId });
    const assignedTenant = await Tenant.findOne({ agentGroupId: groupId });
    if (assignedTenant) {
      checks.push(`⚠️ Group is already assigned to tenant ${assignedTenant._id}`);
    } else if (inPool) {
      checks.push("ℹ️ Group is already in the available pool");
    } else {
      checks.push("ℹ️ Group is not yet in the pool — use /addgroup to add it");
    }

    const allPassed = checks.every((c) => !c.startsWith("❌"));
    const summary = allPassed
      ? "\n🎉 Group is ready to go!"
      : "\n⚠️ Some issues need to be fixed before this group can be used.";

    return ctx.reply(`Validation results for "${chat.title || groupId}":\n\n${checks.join("\n")}${summary}`);
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

    const existingTenant = await Tenant.findOne({ agentGroupId: groupId, status: { $ne: "removed" } });
    if (existingTenant) {
      return ctx.reply(`Group ${groupId} is already assigned to tenant ${existingTenant._id}.`);
    }

    await EmptyGroup.create({ groupId });
    return ctx.reply(`✅ Group ${groupId} added to the pool. It's now available for /register.`);
  });

  // /listgroups — show available pre-configured groups with validation status
  bot.command("listgroups", async (ctx) => {
    const groups = await EmptyGroup.find();
    if (groups.length === 0) {
      return ctx.reply("No available groups. Ask the technical admin to add one with /addgroup.\nSee /grouphelp for step-by-step instructions.");
    }

    const lines = await Promise.all(
      groups.map(async (g) => {
        let title = "Unknown";
        let status = "❓";
        try {
          const chat = await bot.api.getChat(g.groupId);
          title = chat.title || "Untitled";

          const me = await bot.api.getMe();
          const member = await bot.api.getChatMember(g.groupId, me.id);

          const isAdmin = member.status === "administrator" || member.status === "creator";
          const hasTopics = chat.is_forum === true;
          const canManageTopics = member.status === "creator" || member.can_manage_topics;

          if (isAdmin && hasTopics && canManageTopics) {
            status = "✅";
          } else {
            const issues = [];
            if (!isAdmin) issues.push("not admin");
            if (!hasTopics) issues.push("topics off");
            if (!canManageTopics) issues.push("no topic perms");
            status = `⚠️ (${issues.join(", ")})`;
          }
        } catch (_) {
          status = "❌ (no access)";
        }
        return `• ${status} ${title} (${g.groupId}) — added ${g.createdAt.toLocaleDateString()}`;
      })
    );
    return ctx.reply(`📦 ${groups.length} group${groups.length === 1 ? "" : "s"} ready to assign:\n${lines.join("\n")}\n\n✅ = ready  ⚠️ = issues  ❌ = no access\nUse /validate <group_id> for details.\nUse /register <bot_token> <display_name> to add a tenant.`);
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

    // Check for duplicate bot token (exclude removed tenants)
    const existing = await Tenant.findOne({ botToken, status: { $ne: "removed" } });
    if (existing) {
      return ctx.reply(`This bot token is already registered (tenant: ${existing._id}).`);
    }

    // Clean up any removed tenant with the same token so the unique index doesn't block re-registration
    await Tenant.deleteMany({ botToken, status: "removed" });

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

    // Reply with success before starting the bot (startBot can take time)
    await ctx.reply(
      `✅ Tenant created (pending bot setup)!\n\nBot: @${meResult.username}\nGroup: ${groupName}\nTenant ID: ${tenant._id}\n\n🔗 Group invite link:\n${inviteLink}\n\n👉 Next step: Open the group and add @${meResult.username} as a member.\n\nThe bot will be promoted to admin automatically. Once that's done, it will activate and I'll confirm here.`
    );

    // Start the sub-bot so it can listen for my_chat_member updates
    try {
      await botManager.startBot(tenant);
    } catch (err) {
      console.error(`[MasterBot] Failed to start Sub-Bot for tenant ${tenant._id}:`, err.message);
      await ctx.reply(`⚠️ Sub-Bot failed to start: ${err.message}\nThe tenant was created but the bot isn't running. Try /start ${tenant._id} later.`);
    }

    return;
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

  // /listusers <tenant_id> — list all customers who messaged a tenant's bot
  bot.command("listusers", async (ctx) => {
    const tenantId = (ctx.match || "").trim();
    if (!tenantId) return ctx.reply("Usage: /listusers <tenant_id>");

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return ctx.reply(`Tenant ${tenantId} not found.`);

    const customers = await Customer.find({ tenantId: tenant._id });
    if (customers.length === 0) {
      return ctx.reply(`No customers found for tenant ${tenantId}.`);
    }

    const lines = await Promise.all(
      customers.map(async (c) => {
        let username = "N/A";
        try {
          const chat = await bot.api.getChat(c.telegramUserId);
          username = chat.username ? `@${chat.username}` : chat.first_name || "N/A";
        } catch (_) {
          // User may have blocked the bot or privacy settings prevent lookup
        }
        return `• ${c.alias} — ${username} (ID: ${c.telegramUserId}) — ${c.status}`;
      })
    );

    return ctx.reply(
      `👥 ${customers.length} customer${customers.length === 1 ? "" : "s"} for tenant ${tenantId}:\n\n${lines.join("\n")}`
    );
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

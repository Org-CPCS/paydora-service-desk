const Tenant = require("../../db/models/tenant");
const EmptyGroup = require("../../db/models/empty-group");

/**
 * /validate <group_id> — check if a group is ready to be assigned.
 */
async function handleValidate(ctx, { bot }) {
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
}

module.exports = { handleValidate };

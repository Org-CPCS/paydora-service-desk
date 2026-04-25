const EmptyGroup = require("../../db/models/empty-group");

/**
 * /listgroups — show available pre-configured groups with validation status.
 */
async function handleListGroups(ctx, { bot }) {
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
}

module.exports = { handleListGroups };

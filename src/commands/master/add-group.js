const Tenant = require("../../db/models/tenant");
const EmptyGroup = require("../../db/models/empty-group");

/**
 * /addgroup <group_id> — pre-provision an empty group.
 */
async function handleAddGroup(ctx) {
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
}

module.exports = { handleAddGroup };

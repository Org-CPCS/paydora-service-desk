const EmptyGroup = require("../../db/models/empty-group");

/**
 * /removegroup <group_id> — remove a group from the pool.
 */
async function handleRemoveGroup(ctx) {
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
}

module.exports = { handleRemoveGroup };

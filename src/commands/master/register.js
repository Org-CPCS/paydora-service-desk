const { Bot } = require("grammy");
const Tenant = require("../../db/models/tenant");
const TenantBot = require("../../db/models/tenant-bot");
const EmptyGroup = require("../../db/models/empty-group");

/**
 * /register <bot_token> <group_name> — register a tenant, pending bot addition to group.
 */
async function handleRegister(ctx, { bot, botManager }) {
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

  // Rename the group using the Master Bot
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

  // Create tenant in "pending" status
  const tenant = await Tenant.create({
    botToken,
    botUsername: meResult.username,
    agentGroupId: groupId,
    status: "pending",
  });

  // Create TenantBot record
  await TenantBot.create({
    tenantId: tenant._id,
    botToken,
    botUsername: meResult.username,
    status: "pending",
  });

  // Remove from empty groups pool
  await EmptyGroup.deleteOne({ _id: emptyGroup._id });

  // Reply with success before starting the bot
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
}

module.exports = { handleRegister };

const { Bot } = require("grammy");

// Master bot command handlers
const { handleHelp } = require("../commands/master/help");
const { handleGroupHelp } = require("../commands/master/group-help");
const { handleValidate } = require("../commands/master/validate");
const { handleAddGroup } = require("../commands/master/add-group");
const { handleRemoveGroup } = require("../commands/master/remove-group");
const { handleListGroups } = require("../commands/master/list-groups");
const { handleRegister } = require("../commands/master/register");
const { handleStop, handleStart, handleRemove, handleList, handleStatus } = require("../commands/master/tenant-lifecycle");
const { handleMessageAllUsers, handleMessage } = require("../commands/master/messaging");
const { handleListUsers, handleUserCount } = require("../commands/master/user-management");

/**
 * Creates the Master Bot for tenant management.
 * Multiple Super Admins (comma-separated IDs) can interact with this bot.
 * @param {string} token - Master bot Telegram token
 * @param {string} superAdminIds - Comma-separated Telegram user IDs
 * @param {import('../bots/bot-manager').BotManager} botManager
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

  const deps = { bot, botManager };

  // Help & guides
  bot.command("help", (ctx) => handleHelp(ctx));
  bot.command("grouphelp", (ctx) => handleGroupHelp(ctx));

  // Group management
  bot.command("validate", (ctx) => handleValidate(ctx, deps));
  bot.command("addgroup", (ctx) => handleAddGroup(ctx));
  bot.command("listgroups", (ctx) => handleListGroups(ctx, deps));
  bot.command("removegroup", (ctx) => handleRemoveGroup(ctx));

  // Tenant management
  bot.command("register", (ctx) => handleRegister(ctx, deps));
  bot.command("stop", (ctx) => handleStop(ctx, deps));
  bot.command("start", (ctx) => handleStart(ctx, deps));
  bot.command("remove", (ctx) => handleRemove(ctx, deps));
  bot.command("list", (ctx) => handleList(ctx));
  bot.command("status", (ctx) => handleStatus(ctx, deps));

  // Messaging
  bot.command("messageallusers", (ctx) => handleMessageAllUsers(ctx, deps));
  bot.command("message", (ctx) => handleMessage(ctx, deps));

  // User management
  bot.command("listusers", (ctx) => handleListUsers(ctx));
  bot.command("usercount", (ctx) => handleUserCount(ctx));

  return bot;
}

module.exports = { createMasterBot };

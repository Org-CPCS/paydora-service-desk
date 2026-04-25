/**
 * /help — step-by-step guide.
 */
async function handleHelp(ctx) {
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
/usercount <tenant_id> — Show customer count for a tenant
/message <tenant_id> <user_id> <text> — Message a customer via sub-bot
/messageAllUsers <tenant_id> <text> — Broadcast to all customers
/status <tenant_id> — Check a tenant's status
/stop <tenant_id> — Pause a tenant
/start <tenant_id> — Resume a tenant
/remove <tenant_id> — Remove a tenant`
  );
}

module.exports = { handleHelp };

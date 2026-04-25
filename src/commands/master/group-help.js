/**
 * /grouphelp — step-by-step guide to prepare a new agent group.
 */
async function handleGroupHelp(ctx) {
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
}

module.exports = { handleGroupHelp };

const Customer = require("../../db/models/customer");

/**
 * /setUsername command — let the customer set a display name.
 */
async function handleSetUsername(ctx, { tenantId }) {
  const name = ctx.message.text.slice("/setusername".length).trim();
  if (!name) {
    return ctx.reply("Usage: /setUsername YourName\n\nThis sets the name our support team sees when you message us.");
  }
  if (name.length > 64) {
    return ctx.reply("⚠️ Name is too long. Please keep it under 64 characters.");
  }
  const customer = await Customer.findOne({ tenantId, telegramUserId: ctx.from.id });
  if (customer) {
    customer.firstName = name;
    await customer.save();
  }
  return ctx.reply(`✅ Your name has been set to "${name}". Our team will see this when you message us.`);
}

module.exports = { handleSetUsername };

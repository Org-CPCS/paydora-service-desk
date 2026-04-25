/**
 * /start command — welcome message for customers in DM.
 */
async function handleStart(ctx) {
  return ctx.reply(
    "Hey there 👋 Thank you for messaging us!\n\nJust type your question or describe your issue and one of our team members will be with you shortly. We're happy to help!\n\n💡 Tip: Send /setUsername YourName to set the name our team sees."
  );
}

module.exports = { handleStart };

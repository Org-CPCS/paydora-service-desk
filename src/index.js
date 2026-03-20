require("dotenv").config();
const { Bot } = require("grammy");
const db = require("./db");
const {
  getOrCreateCustomer,
  relayToAgents,
  relayToCustomer,
  AGENT_GROUP_ID,
} = require("./relay");

const bot = new Bot(process.env.BOT_TOKEN);

const ADMIN_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter(Boolean);

// --- Customer DM handler ---
bot.on("message", async (ctx, next) => {
  // Only handle private (DM) messages from customers
  if (ctx.chat.type !== "private") return next();

  // /start command
  if (ctx.message.text === "/start") {
    return ctx.reply(
      "Hey there 👋 Welcome to Paydora Support!\n\nJust type your question or describe your issue and one of our team members will be with you shortly. We're happy to help!"
    );
  }

  const customer = await getOrCreateCustomer(bot, ctx.from.id);
  await relayToAgents(bot, customer, ctx.message);
});

// --- Agent group handler ---
bot.on("message", async (ctx) => {
  // Only handle messages from the agent group
  if (ctx.chat.id !== AGENT_GROUP_ID) return;

  // Ignore messages from the bot itself (prevent echo loops)
  if (ctx.from.is_bot) return;

  // Must be inside a topic (thread)
  const threadId = ctx.message.message_thread_id;
  if (!threadId) return;

  // Handle /close command
  if (ctx.message.text === "/close") {
    const { Customer } = require("./db");
    const customer = await Customer.findOne({ threadId });
    if (customer) {
      customer.status = "closed";
      await customer.save();
      await ctx.reply("✅ Conversation closed.", { message_thread_id: threadId });
      try {
        await bot.api.editForumTopic(AGENT_GROUP_ID, threadId, {
          name: `✅ ${customer.alias}`,
        });
        await bot.api.closeForumTopic(AGENT_GROUP_ID, threadId);
      } catch (e) {
        // topic might already be closed
      }
    }
    return;
  }

  // Handle /note command — internal note, not forwarded
  if (ctx.message.text && ctx.message.text.startsWith("/note ")) {
    await ctx.reply(`📝 Note: ${ctx.message.text.slice(6)}`, {
      message_thread_id: threadId,
    });
    return;
  }

  // Handle /whois command — admin only
  if (ctx.message.text && ctx.message.text.startsWith("/whois ")) {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply("Not authorized.", { message_thread_id: threadId });
    }
    const alias = ctx.message.text.slice(7).trim();
    const { Customer } = require("./db");
    const customer = await Customer.findOne({ alias });
    if (customer) {
      return ctx.reply(`${alias} → Telegram ID: ${customer.telegramUserId}`, {
        message_thread_id: threadId,
      });
    }
    return ctx.reply("Customer not found.", { message_thread_id: threadId });
  }

  // Regular message — relay to customer
  await relayToCustomer(bot, threadId, ctx.message);
});

// --- Start ---
async function main() {
  await db.connect();
  console.log("Bot starting...");
  bot.start();
}

main().catch(console.error);

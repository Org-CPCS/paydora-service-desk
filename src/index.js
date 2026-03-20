require("dotenv").config();
const mongoose = require("mongoose");
const db = require("./db");
const { BotManager } = require("./bot-manager");
const { createMasterBot } = require("./master");

async function main() {
  // Validate required environment variables
  if (!process.env.SUPER_ADMIN_ID) {
    console.error("SUPER_ADMIN_ID environment variable is required.");
    process.exit(1);
  }
  if (!process.env.MASTER_BOT_TOKEN) {
    console.error("MASTER_BOT_TOKEN environment variable is required.");
    process.exit(1);
  }

  // Connect to MongoDB
  await db.connect();

  // Create Bot Manager
  const botManager = new BotManager();

  // Create and start Master Bot
  const masterBot = createMasterBot(
    process.env.MASTER_BOT_TOKEN,
    process.env.SUPER_ADMIN_ID,
    botManager
  );
  masterBot.start({
    onStart: () => console.log("[Master] Master Bot started."),
  });

  // Start all active Sub-Bots
  await botManager.loadAndStartAll();
  console.log("[Main] All active Sub-Bots loaded.");

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`[Main] Received ${signal}, shutting down...`);
    await botManager.stopAll();
    await masterBot.stop();
    await mongoose.connection.close();
    console.log("[Main] Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[Main] Fatal error:", err);
  process.exit(1);
});

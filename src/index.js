require("dotenv").config();
const mongoose = require("mongoose");
const db = require("./db");
const { BotManager } = require("./bot-manager");
const { createMasterBot } = require("./master");

async function main() {
  // Validate required environment variables
  if (!process.env.SUPER_ADMIN_IDS) {
    console.error("SUPER_ADMIN_IDS environment variable is required.");
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
    process.env.SUPER_ADMIN_IDS,
    botManager
  );
  masterBot.start({
    onStart: () => console.log("[Master] Master Bot started."),
  });

  // Notify all super admins when a pending tenant activates
  const adminIds = process.env.SUPER_ADMIN_IDS.split(",").map((id) => Number(id.trim()));
  botManager.setActivationCallback(async (tenantId) => {
    const { Tenant } = require("./db");
    const tenant = await Tenant.findById(tenantId);
    const msg = `🟢 Tenant ${tenantId} is now active!\nBot: @${tenant?.botUsername || "unknown"}\n\nThe support bot is ready to receive customer messages.`;
    for (const adminId of adminIds) {
      try {
        await masterBot.api.sendMessage(adminId, msg);
      } catch (err) {
        console.error(`[Main] Failed to notify admin ${adminId}:`, err.message);
      }
    }
  });

  // When a sub-bot is added to a group as member, Master Bot promotes it to admin
  botManager.setPromotionCallback(async (tenantId, groupId, botId) => {
    try {
      await masterBot.api.promoteChatMember(groupId, botId, {
        can_manage_topics: true,
        can_delete_messages: true,
        can_invite_users: true,
        can_pin_messages: true,
        can_manage_chat: true,
      });
      console.log(`[Main] Promoted sub-bot ${botId} to admin in group ${groupId}`);
    } catch (err) {
      console.error(`[Main] Failed to promote sub-bot in group ${groupId}:`, err.message);
      // Notify admins about the failure
      for (const adminId of adminIds) {
        try {
          await masterBot.api.sendMessage(
            adminId,
            `⚠️ Could not auto-promote the bot in group ${groupId} for tenant ${tenantId}.\nPlease promote it to admin manually.`
          );
        } catch (_) {}
      }
    }
  });

  // Start all active and pending Sub-Bots
  await botManager.loadAndStartAll();
  console.log("[Main] All Sub-Bots loaded.");

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

const { Tenant } = require("./db");
const { createSubBot } = require("./sub-bot");

class BotManager {
  constructor() {
    /** @type {Map<string, { bot: import('grammy').Bot, startedAt: Date }>} */
    this.bots = new Map();
  }

  /**
   * Load all active tenants from the database and start a Sub-Bot for each.
   * Uses startBotWithRetry so a single failing tenant doesn't block others.
   */
  async loadAndStartAll() {
    const tenants = await Tenant.find({ status: "active" });
    for (const tenant of tenants) {
      await this.startBotWithRetry(tenant);
    }
  }

  /**
   * Create and start a Sub-Bot for the given tenant.
   * @param {object} tenant - Mongoose tenant document
   */
  async startBot(tenant) {
    const tenantId = tenant._id.toString();
    const bot = createSubBot(tenant.botToken, {
      tenantId: tenant._id,
      agentGroupId: tenant.agentGroupId,
    });

    // Attach error handler for fatal polling errors — triggers retry
    bot.catch(async (err) => {
      console.error(`[BotManager] Fatal error for tenant ${tenantId}:`, err.message || err);
      // Stop the failed bot and attempt restart with retry
      try {
        await this.stopBot(tenantId);
      } catch (_) {
        // Already stopped or failed to stop — ignore
      }
      await this.startBotWithRetry(tenant);
    });

    const startedAt = new Date();
    // bot.start() returns a promise that resolves when polling stops;
    // the onStart callback fires once polling is confirmed running.
    bot.start({
      onStart: () => {
        console.log(`[BotManager] Sub-Bot started for tenant ${tenantId}`);
      },
    });

    this.bots.set(tenantId, { bot, startedAt });
  }

  /**
   * Start a Sub-Bot with retry logic.
   * @param {object} tenant - Mongoose tenant document
   * @param {number} maxRetries - Maximum retry attempts (default 3)
   * @param {number} delayMs - Delay between retries in ms (default 5000)
   */
  async startBotWithRetry(tenant, maxRetries = 3, delayMs = 5000) {
    const tenantId = tenant._id.toString();
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.startBot(tenant);
        return; // success
      } catch (err) {
        console.error(
          `[BotManager] Failed to start bot for tenant ${tenantId} (attempt ${attempt}/${maxRetries}):`,
          err.message || err
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    console.error(
      `[BotManager] Giving up on tenant ${tenantId} after ${maxRetries} failed attempts.`
    );
  }

  /**
   * Stop a running Sub-Bot and remove it from the map.
   * @param {string} tenantId
   */
  async stopBot(tenantId) {
    const entry = this.bots.get(tenantId);
    if (!entry) return;
    await entry.bot.stop();
    this.bots.delete(tenantId);
    console.log(`[BotManager] Sub-Bot stopped for tenant ${tenantId}`);
  }

  /**
   * Stop all running Sub-Bots.
   */
  async stopAll() {
    const stopPromises = [];
    for (const [tenantId, entry] of this.bots) {
      stopPromises.push(
        entry.bot.stop().catch((err) => {
          console.error(`[BotManager] Error stopping bot for tenant ${tenantId}:`, err.message || err);
        })
      );
    }
    await Promise.all(stopPromises);
    this.bots.clear();
    console.log("[BotManager] All Sub-Bots stopped.");
  }

  /**
   * Get the status of a specific tenant's Sub-Bot.
   * @param {string} tenantId
   * @returns {{ running: boolean, startedAt: Date } | null}
   */
  getStatus(tenantId) {
    const entry = this.bots.get(tenantId);
    if (!entry) return null;
    return { running: true, startedAt: entry.startedAt };
  }

  /**
   * Get status info for all tracked Sub-Bots.
   * @returns {Map<string, { running: boolean, startedAt: Date }>}
   */
  getAllStatuses() {
    const statuses = new Map();
    for (const [tenantId, entry] of this.bots) {
      statuses.set(tenantId, { running: true, startedAt: entry.startedAt });
    }
    return statuses;
  }
}

module.exports = { BotManager };

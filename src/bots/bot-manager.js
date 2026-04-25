const Tenant = require("../db/models/tenant");
const TenantBot = require("../db/models/tenant-bot");
const { createSubBot } = require("./create-sub-bot");

class BotManager {
  constructor() {
    /**
     * Map key is `${tenantId}:${botToken}` for multi-bot support.
     * @type {Map<string, { bot: import('grammy').Bot, startedAt: Date, tenantId: string, botToken: string }>}
     */
    this.bots = new Map();
    /** @type {((tenantId: string) => void) | null} */
    this.onActivation = null;
    /** @type {((tenantId: string, groupId: number, botId: number) => void) | null} */
    this.onPromoteBot = null;
    /** @type {((tenantId: string, groupId: number) => void) | null} */
    this.onMasterBotKicked = null;
    /** @type {number | null} */
    this.masterBotId = null;
  }

  /** @param {(tenantId: string) => void} callback */
  setActivationCallback(callback) {
    this.onActivation = callback;
  }

  /** @param {(tenantId: string, groupId: number, botId: number) => void} callback */
  setPromotionCallback(callback) {
    this.onPromoteBot = callback;
  }

  /** @param {(tenantId: string, groupId: number) => void} callback */
  setMasterBotKickedCallback(callback) {
    this.onMasterBotKicked = callback;
  }

  /** @param {number} botId */
  setMasterBotId(botId) {
    this.masterBotId = botId;
  }

  /**
   * Build the map key for a bot entry.
   */
  _key(tenantId, botToken) {
    return `${tenantId}:${botToken}`;
  }

  /**
   * Load all active/pending tenants and start all their bots.
   */
  async loadAndStartAll() {
    const tenants = await Tenant.find({ status: { $in: ["active", "pending"] } });
    for (const tenant of tenants) {
      const tenantId = tenant._id.toString();

      // Load TenantBot records for this tenant
      const tenantBots = await TenantBot.find({
        tenantId: tenant._id,
        status: { $in: ["active", "pending"] },
      });

      if (tenantBots.length > 0) {
        // Multi-bot path: start each TenantBot
        for (const tb of tenantBots) {
          await this.startBotWithRetry(tenant, tb.botToken);
        }
      } else {
        // Legacy path: tenant has botToken directly (no TenantBot records yet)
        await this.startBotWithRetry(tenant, tenant.botToken);
      }
    }
  }

  /**
   * Create and start a Sub-Bot for the given tenant + bot token.
   * @param {object} tenant - Mongoose tenant document
   * @param {string} [botToken] - specific bot token (defaults to tenant.botToken for backwards compat)
   */
  async startBot(tenant, botToken) {
    const token = botToken || tenant.botToken;
    const tenantId = tenant._id.toString();
    const key = this._key(tenantId, token);

    // If this specific bot is already running, stop it first
    if (this.bots.has(key)) {
      console.log(`[BotManager] Bot already running for ${key}, stopping before restart...`);
      try {
        await this.stopBotByKey(key);
      } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    const bot = createSubBot(token, {
      tenantId: tenant._id,
      agentGroupId: tenant.agentGroupId,
    }, {
      notifyActivation: (tid) => {
        if (this.onActivation) this.onActivation(tid);
      },
      promoteBot: (tid, groupId, botId) => {
        if (this.onPromoteBot) this.onPromoteBot(tid, groupId, botId);
      },
      masterBotKicked: (tid, groupId) => {
        if (this.onMasterBotKicked) this.onMasterBotKicked(tid, groupId);
      },
      masterBotId: this.masterBotId,
    });

    let isRestarting = false;

    bot.catch(async (err) => {
      console.error(`[BotManager] Fatal error for ${key}:`, err.message || err);
      if (isRestarting) {
        console.log(`[BotManager] Restart already in progress for ${key}, skipping duplicate.`);
        return;
      }
      isRestarting = true;
      try {
        await this.stopBotByKey(key);
      } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await this.startBotWithRetry(tenant, token);
    });

    const startedAt = new Date();
    bot.start({
      onStart: () => {
        console.log(`[BotManager] Sub-Bot started for tenant ${tenantId} (token: ...${token.slice(-6)})`);
      },
      allowed_updates: ["message", "my_chat_member", "chat_member", "callback_query"],
    });

    this.bots.set(key, { bot, startedAt, tenantId, botToken: token });
  }

  /**
   * Start a Sub-Bot with retry logic.
   * @param {object} tenant
   * @param {string} [botToken]
   * @param {number} [maxRetries=3]
   * @param {number} [delayMs=5000]
   */
  async startBotWithRetry(tenant, botToken, maxRetries = 3, delayMs = 5000) {
    const token = botToken || tenant.botToken;
    const tenantId = tenant._id.toString();
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.startBot(tenant, token);
        return;
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
      `[BotManager] Giving up on tenant ${tenantId} (token: ...${token.slice(-6)}) after ${maxRetries} failed attempts.`
    );
  }

  /**
   * Stop a bot by its map key.
   * @param {string} key
   */
  async stopBotByKey(key) {
    const entry = this.bots.get(key);
    if (!entry) return;
    await entry.bot.stop();
    this.bots.delete(key);
    console.log(`[BotManager] Sub-Bot stopped: ${key}`);
  }

  /**
   * Stop all bots for a given tenant.
   * @param {string} tenantId
   */
  async stopBot(tenantId) {
    const keysToStop = [];
    for (const [key, entry] of this.bots) {
      if (entry.tenantId === tenantId) {
        keysToStop.push(key);
      }
    }
    for (const key of keysToStop) {
      await this.stopBotByKey(key);
    }
  }

  /**
   * Stop all running Sub-Bots.
   */
  async stopAll() {
    const stopPromises = [];
    for (const [key, entry] of this.bots) {
      stopPromises.push(
        entry.bot.stop().catch((err) => {
          console.error(`[BotManager] Error stopping bot ${key}:`, err.message || err);
        })
      );
    }
    await Promise.all(stopPromises);
    this.bots.clear();
    console.log("[BotManager] All Sub-Bots stopped.");
  }

  /**
   * Get the status of a specific tenant's bots.
   * Returns the first running bot's status for backwards compat.
   * @param {string} tenantId
   * @returns {{ running: boolean, startedAt: Date } | null}
   */
  getStatus(tenantId) {
    for (const [key, entry] of this.bots) {
      if (entry.tenantId === tenantId) {
        return { running: true, startedAt: entry.startedAt };
      }
    }
    return null;
  }

  /**
   * Get status info for all tracked Sub-Bots.
   * @returns {Map<string, { running: boolean, startedAt: Date }>}
   */
  getAllStatuses() {
    const statuses = new Map();
    for (const [key, entry] of this.bots) {
      statuses.set(key, { running: true, startedAt: entry.startedAt });
    }
    return statuses;
  }

  /**
   * Get a running bot entry for a tenant by tenantId.
   * Returns the first match (for backwards compat with master commands).
   * @param {string} tenantId
   * @returns {{ bot: import('grammy').Bot } | undefined}
   */
  getBotForTenant(tenantId) {
    for (const [key, entry] of this.bots) {
      if (entry.tenantId === tenantId) {
        return entry;
      }
    }
    return undefined;
  }
}

module.exports = { BotManager };

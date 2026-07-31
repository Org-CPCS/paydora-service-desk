const Tenant = require("../db/models/tenant");
const TenantBot = require("../db/models/tenant-bot");
const { createSubBot } = require("./create-sub-bot");

// Restart backoff. A bot that keeps dying must not hammer Telegram: each
// consecutive failure within the window doubles the delay, up to the cap.
const RESTART_BASE_DELAY_MS = 5000;
const RESTART_MAX_DELAY_MS = 5 * 60 * 1000;
const RESTART_WINDOW_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    /**
     * Serializes start/stop per key so two callers can never race and leave
     * a second long-polling instance alive on the same token (409 Conflict).
     * @type {Map<string, Promise<unknown>>}
     */
    this._locks = new Map();
    /** @type {Map<string, { count: number, windowStart: number }>} */
    this._restarts = new Map();
    /** @type {Map<string, NodeJS.Timeout>} */
    this._restartTimers = new Map();
    this._shuttingDown = false;
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
   * Run `fn` only once any in-flight start/stop for the same key has settled.
   * @param {string} key
   * @param {() => Promise<any>} fn
   */
  _withLock(key, fn) {
    const previous = this._locks.get(key) || Promise.resolve();
    // Run regardless of whether the previous operation resolved or rejected.
    const result = previous.then(fn, fn);
    this._locks.set(key, result.then(
      () => {},
      () => {}
    ));
    return result;
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
    return this._withLock(key, () => this._startBotLocked(tenant, token, key, tenantId));
  }

  /**
   * Start implementation. Only ever runs while holding the key's lock.
   */
  async _startBotLocked(tenant, token, key, tenantId) {
    if (this._shuttingDown) return;

    // Cancel any restart still pending for this key — we are starting now.
    this._cancelPendingRestart(key);

    // If this specific bot is already running, stop it first
    if (this.bots.has(key)) {
      console.log(`[BotManager] Bot already running for ${key}, stopping before restart...`);
      await this._stopBotLocked(key);
      await sleep(3000);
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

    // Errors raised here come from `bot.catch`, which only ever fires for
    // failures while handling a single update (a send to one chat that was
    // rate limited, a blocked user, a Mongo hiccup). Restarting the whole bot
    // cannot fix a per-update failure and only costs us the polling session,
    // so these are logged and nothing more. Polling death is handled below.
    bot.catch((err) => {
      const errMsg = (err && err.message) || String(err);
      console.error(`[BotManager] Update handler error for ${key}:`, errMsg);
    });

    const startedAt = new Date();
    // Register before starting: a concurrent caller must be able to see this
    // bot exists, otherwise both would poll the same token and Telegram
    // terminates one of them with 409 Conflict.
    this.bots.set(key, { bot, startedAt, tenantId, botToken: token });

    // bot.start() resolves when polling stops and rejects when it dies. This
    // promise is deliberately not awaited (it is long-lived), but it must be
    // handled or a dead poller becomes an unhandled rejection and the bot
    // silently stops receiving updates.
    Promise.resolve(
      bot.start({
        onStart: () => {
          console.log(`[BotManager] Sub-Bot started for tenant ${tenantId} (token: ...${token.slice(-6)})`);
        },
        allowed_updates: ["message", "my_chat_member", "chat_member", "callback_query"],
      })
    ).then(
      () => this._onPollingEnded(key, bot, tenant, token, null),
      (err) => this._onPollingEnded(key, bot, tenant, token, err)
    );
  }

  /**
   * Called when a bot's long-polling loop ends, cleanly or otherwise.
   * @param {string} key
   * @param {import('grammy').Bot} bot - the instance whose polling ended
   * @param {object} tenant
   * @param {string} token
   * @param {unknown} err - null when polling ended cleanly
   */
  _onPollingEnded(key, bot, tenant, token, err) {
    const current = this.bots.get(key);
    // If this instance is no longer the registered one, it was deliberately
    // replaced or stopped. Nothing to do.
    if (!current || current.bot !== bot) return;
    if (this._shuttingDown) return;

    if (!err) {
      console.log(`[BotManager] Polling ended for ${key}, not restarting.`);
      this.bots.delete(key);
      return;
    }

    const errMsg = (err && err.message) || String(err);
    console.error(`[BotManager] Polling failed for ${key}:`, errMsg);
    this.bots.delete(key);
    this._scheduleRestart(key, tenant, token);
  }

  /**
   * Schedule a restart with exponential backoff within a rolling window.
   */
  _scheduleRestart(key, tenant, token) {
    if (this._shuttingDown) return;
    if (this._restartTimers.has(key)) return;

    const delayMs = this._nextRestartDelay(key);
    console.log(`[BotManager] Restarting ${key} in ${Math.round(delayMs / 1000)}s.`);

    const timer = setTimeout(() => {
      this._restartTimers.delete(key);
      this.startBotWithRetry(tenant, token).catch((restartErr) => {
        console.error(`[BotManager] Restart failed for ${key}:`, restartErr.message || restartErr);
      });
    }, delayMs);
    // Do not hold the event loop open purely for a pending restart.
    if (typeof timer.unref === "function") timer.unref();
    this._restartTimers.set(key, timer);
  }

  /**
   * Backoff delay for the next restart of `key`: doubles per consecutive
   * failure inside the window, resets once the bot has been quiet for it.
   */
  _nextRestartDelay(key) {
    const now = Date.now();
    const record = this._restarts.get(key);

    if (!record || now - record.windowStart > RESTART_WINDOW_MS) {
      this._restarts.set(key, { count: 1, windowStart: now });
      return RESTART_BASE_DELAY_MS;
    }

    record.count += 1;
    const delayMs = RESTART_BASE_DELAY_MS * 2 ** (record.count - 1);
    if (delayMs >= RESTART_MAX_DELAY_MS) {
      console.warn(
        `[BotManager] ${key} has failed ${record.count} times in the last ` +
        `${Math.round(RESTART_WINDOW_MS / 60000)}min — backing off to the ` +
        `${Math.round(RESTART_MAX_DELAY_MS / 60000)}min maximum.`
      );
    }
    return Math.min(delayMs, RESTART_MAX_DELAY_MS);
  }

  /** Cancel a restart timer pending for `key`, if any. */
  _cancelPendingRestart(key) {
    const timer = this._restartTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this._restartTimers.delete(key);
    }
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
          await sleep(delayMs);
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
    return this._withLock(key, () => this._stopBotLocked(key));
  }

  /**
   * Stop implementation. Only ever runs while holding the key's lock.
   */
  async _stopBotLocked(key) {
    this._cancelPendingRestart(key);

    const entry = this.bots.get(key);
    if (!entry) return;

    // Deregister first: even if stop() throws, the entry must not linger, or
    // the map would point at a bot nobody can stop again.
    this.bots.delete(key);
    try {
      await entry.bot.stop();
    } catch (err) {
      console.error(`[BotManager] Error stopping bot ${key}:`, err.message || err);
    }
    console.log(`[BotManager] Sub-Bot stopped: ${key}`);
  }

  /**
   * Stop all bots for a given tenant.
   * @param {string} tenantId
   */
  async stopBot(tenantId) {
    // A bot waiting out its restart backoff is not in `this.bots`, so cancel
    // by key prefix too — otherwise a stopped tenant comes back when the
    // timer fires.
    for (const key of [...this._restartTimers.keys()]) {
      if (key.startsWith(`${tenantId}:`)) {
        this._cancelPendingRestart(key);
      }
    }

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
    this._shuttingDown = true;
    for (const key of [...this._restartTimers.keys()]) {
      this._cancelPendingRestart(key);
    }

    const keys = [...this.bots.keys()];
    await Promise.all(keys.map((key) => this.stopBotByKey(key)));
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

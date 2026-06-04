/**
 * Per-chat message queue with throttling.
 *
 * Telegram enforces rate limits per bot:
 * - ~30 messages/second to different chats
 * - ~20 messages/minute to the same group/chat
 *
 * This queue ensures we don't exceed these limits by:
 * 1. Spacing messages to the same chat (min interval between sends)
 * 2. Capping global throughput across all chats
 * 3. Retrying failed sends with exponential backoff
 * 4. Preserving message order per-chat
 */

const GLOBAL_RATE_LIMIT = 25; // max sends per second across all chats
const PER_CHAT_INTERVAL_MS = 3000; // min ms between messages to the same chat (20/min = 3s each)
const MAX_QUEUE_SIZE = 500; // max queued messages per chat before dropping oldest
const MAX_RETRIES = 3;

class MessageQueue {
  constructor({ perChatIntervalMs, globalRateLimit, maxQueueSize, maxRetries, retryBaseMs } = {}) {
    this.perChatIntervalMs = perChatIntervalMs ?? PER_CHAT_INTERVAL_MS;
    this.globalRateLimit = globalRateLimit ?? GLOBAL_RATE_LIMIT;
    this.maxQueueSize = maxQueueSize ?? MAX_QUEUE_SIZE;
    this.maxRetries = maxRetries ?? MAX_RETRIES;
    this.retryBaseMs = retryBaseMs ?? 1000;
    /** @type {Map<string, Array<{ task: Function, resolve: Function, reject: Function, retries: number }>>} */
    this.queues = new Map();
    /** @type {Map<string, number>} */
    this.lastSendTime = new Map();
    /** @type {Set<string>} */
    this.processing = new Set();

    // Global rate tracking
    this.sendTimestamps = [];
  }

  /**
   * Enqueue a message send operation for a specific chat.
   * @param {string|number} chatId - The target chat ID
   * @param {Function} task - Async function that performs the send
   * @returns {Promise<any>} Resolves when the message is actually sent
   */
  enqueue(chatId, task) {
    const key = String(chatId);

    if (!this.queues.has(key)) {
      this.queues.set(key, []);
    }

    const queue = this.queues.get(key);

    // If queue is too large, drop the oldest message (prevent memory leak)
    if (queue.length >= this.maxQueueSize) {
      const dropped = queue.shift();
      console.warn(`[MessageQueue] Dropped oldest message for chat ${key} (queue full)`);
      dropped.resolve(null); // Silently discard — caller gets null instead of a result
    }

    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject, retries: 0 });
      this._processQueue(key);
    });
  }

  /**
   * Process the queue for a specific chat, respecting rate limits.
   */
  async _processQueue(key) {
    if (this.processing.has(key)) return;
    this.processing.add(key);

    try {
      while (true) {
        const queue = this.queues.get(key);
        if (!queue || queue.length === 0) break;

        // Wait for per-chat interval
        const lastSend = this.lastSendTime.get(key) || 0;
        const elapsed = Date.now() - lastSend;
        if (elapsed < this.perChatIntervalMs) {
          await sleep(this.perChatIntervalMs - elapsed);
        }

        // Wait for global rate limit
        await this._waitForGlobalSlot();

        const item = queue.shift();
        try {
          const result = await item.task();
          this.lastSendTime.set(key, Date.now());
          this._recordGlobalSend();
          item.resolve(result);
        } catch (err) {
          if (this._isRetryable(err) && item.retries < this.maxRetries) {
            item.retries++;
            const backoff = Math.min(this.retryBaseMs * Math.pow(2, item.retries), 30000);
            console.warn(`[MessageQueue] Retrying for chat ${key} (attempt ${item.retries}/${MAX_RETRIES}) in ${backoff}ms`);
            await sleep(backoff);
            queue.unshift(item); // Put it back at the front
          } else {
            // Non-retryable or max retries exceeded — resolve silently to not crash the bot
            console.error(`[MessageQueue] Failed for chat ${key} after ${item.retries} retries:`, err.message);
            item.reject(err);
          }
        }
      }
    } finally {
      this.processing.delete(key);
      // Clean up empty queues
      const queue = this.queues.get(key);
      if (queue && queue.length === 0) {
        this.queues.delete(key);
      }
    }
  }

  /**
   * Wait until we have a global send slot available.
   */
  async _waitForGlobalSlot() {
    while (true) {
      const now = Date.now();
      // Remove timestamps older than 1 second
      this.sendTimestamps = this.sendTimestamps.filter((t) => now - t < 1000);
      if (this.sendTimestamps.length < this.globalRateLimit) {
        return;
      }
      // Wait until the oldest timestamp expires
      const waitMs = 1000 - (now - this.sendTimestamps[0]) + 10;
      await sleep(waitMs);
    }
  }

  _recordGlobalSend() {
    this.sendTimestamps.push(Date.now());
  }

  _isRetryable(err) {
    const msg = err.message || "";
    // 429 should be handled by auto-retry plugin, but just in case
    if (msg.includes("429")) return true;
    // Network errors are retryable
    if (msg.includes("Network request") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) return true;
    return false;
  }

  /**
   * Get queue stats for monitoring.
   */
  getStats() {
    let totalQueued = 0;
    for (const [, queue] of this.queues) {
      totalQueued += queue.length;
    }
    return {
      activeChats: this.queues.size,
      totalQueued,
      processing: this.processing.size,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singleton instance shared across all bots
const messageQueue = new MessageQueue();

module.exports = { messageQueue, MessageQueue };

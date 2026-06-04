const { MessageQueue } = require("../../src/relay/message-queue");

describe("MessageQueue", () => {
  let queue;

  beforeEach(() => {
    queue = new MessageQueue({ perChatIntervalMs: 0, retryBaseMs: 0 });
  });

  it("executes a single task immediately", async () => {
    const result = await queue.enqueue("chat1", async () => "done");
    expect(result).toBe("done");
  });

  it("preserves order for the same chat", async () => {
    const order = [];
    const p1 = queue.enqueue("chat1", async () => { order.push(1); });
    const p2 = queue.enqueue("chat1", async () => { order.push(2); });
    const p3 = queue.enqueue("chat1", async () => { order.push(3); });
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("processes different chats concurrently", async () => {
    const starts = [];
    const p1 = queue.enqueue("chat1", async () => {
      starts.push("chat1");
      await new Promise((r) => setTimeout(r, 50));
    });
    const p2 = queue.enqueue("chat2", async () => {
      starts.push("chat2");
      await new Promise((r) => setTimeout(r, 50));
    });

    await Promise.all([p1, p2]);
    // Both should have started (concurrently for different chats)
    expect(starts).toContain("chat1");
    expect(starts).toContain("chat2");
  });

  it("retries on retryable errors", async () => {
    let attempts = 0;
    const result = await queue.enqueue("chat1", async () => {
      attempts++;
      if (attempts < 3) throw new Error("Network request failed");
      return "success";
    });
    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("rejects after max retries exceeded", async () => {
    await expect(
      queue.enqueue("chat1", async () => {
        throw new Error("Network request failed");
      })
    ).rejects.toThrow("Network request failed");
  });

  it("rejects immediately on non-retryable errors", async () => {
    let attempts = 0;
    await expect(
      queue.enqueue("chat1", async () => {
        attempts++;
        throw new Error("403: Forbidden: bot was blocked by the user");
      })
    ).rejects.toThrow("403: Forbidden");
    expect(attempts).toBe(1);
  });

  it("drops oldest message when queue overflows", async () => {
    const smallQueue = new MessageQueue({ perChatIntervalMs: 0, retryBaseMs: 0, maxQueueSize: 5 });

    // Block the queue with a long-running task
    let unblock;
    const blocker = new Promise((resolve) => { unblock = resolve; });
    const firstTask = smallQueue.enqueue("chat1", () => blocker);

    // Fill the queue beyond capacity (7 items, max is 5)
    const promises = [];
    for (let i = 0; i < 7; i++) {
      promises.push(smallQueue.enqueue("chat1", async () => i));
    }

    // Unblock and let everything drain
    unblock("first");
    await firstTask;
    const results = await Promise.all(promises);

    // At least 2 should have been dropped (resolved with null)
    const dropped = results.filter((r) => r === null);
    expect(dropped.length).toBeGreaterThanOrEqual(2);
  });

  it("reports stats correctly", async () => {
    let unblock;
    const blocker = new Promise((resolve) => { unblock = resolve; });
    const task = queue.enqueue("chat1", () => blocker);
    queue.enqueue("chat2", async () => "fast");

    // Give chat2 time to process
    await new Promise((r) => setTimeout(r, 50));

    const stats = queue.getStats();
    expect(stats.activeChats).toBeGreaterThanOrEqual(1);
    expect(stats.processing).toBeGreaterThanOrEqual(1);

    unblock();
    await task;
  });

  it("cleans up empty queues after processing", async () => {
    await queue.enqueue("chat1", async () => "done");
    // After processing, the queue map should be cleaned up
    expect(queue.queues.has("chat1")).toBe(false);
  });

  it("handles 429 errors as retryable", async () => {
    let attempts = 0;
    const result = await queue.enqueue("chat1", async () => {
      attempts++;
      if (attempts === 1) throw new Error("429: Too Many Requests: retry after 1");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("handles ECONNRESET as retryable", async () => {
    let attempts = 0;
    const result = await queue.enqueue("chat1", async () => {
      attempts++;
      if (attempts === 1) throw new Error("ECONNRESET");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });
});

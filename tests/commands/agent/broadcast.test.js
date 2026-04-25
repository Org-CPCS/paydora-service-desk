const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx, createMockBot } = require("../../setup");
const { handleBroadcast, handleBroadcastConfirm, handleBroadcastCancel, pendingBroadcasts } = require("../../../src/commands/agent/broadcast");
const Customer = require("../../../src/db/models/customer");
const Tenant = require("../../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => {
  await clearTestDb();
  pendingBroadcasts.clear();
});
afterAll(async () => await teardownTestDb());

describe("handleBroadcast", () => {
  let tenant;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
  });

  it("shows usage when no text or file provided", async () => {
    const ctx = createMockCtx({ message: { text: "/broadcastallusers" } });
    await handleBroadcast(ctx, { tenantId: tenant._id, threadId: 42 });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage"), { message_thread_id: 42 });
  });

  it("reports when no customers to broadcast to", async () => {
    const ctx = createMockCtx({ message: { text: "/broadcastallusers Hello everyone" } });
    await handleBroadcast(ctx, { tenantId: tenant._id, threadId: 42 });
    expect(ctx.reply).toHaveBeenCalledWith("No customers to broadcast to.", { message_thread_id: 42 });
  });

  it("stores pending broadcast and shows confirmation", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
    });

    const ctx = createMockCtx({
      message: { text: "/broadcastallusers Hello everyone" },
      from: { id: 555 },
    });
    await handleBroadcast(ctx, { tenantId: tenant._id, threadId: 42 });

    // Should store in pendingBroadcasts
    const key = `${tenant._id}:555`;
    expect(pendingBroadcasts.has(key)).toBe(true);
    expect(pendingBroadcasts.get(key).text).toBe("Hello everyone");

    // Should show confirmation with inline keyboard
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("This will send a message to 1 customer"),
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });

  it("handles photo broadcast with caption", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
    });

    const ctx = createMockCtx({
      message: {
        caption: "/broadcastallusers Check this out",
        photo: [{ file_id: "small" }, { file_id: "large" }],
      },
      from: { id: 555 },
    });
    await handleBroadcast(ctx, { tenantId: tenant._id, threadId: 42 });

    const key = `${tenant._id}:555`;
    const pending = pendingBroadcasts.get(key);
    expect(pending.text).toBe("Check this out");
    expect(pending.fileId).toBe("large");
    expect(pending.fileType).toBe("photo");
  });
});

describe("handleBroadcastConfirm", () => {
  let tenant, bot;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    bot = createMockBot();
  });

  it("rejects confirmation from a different user", async () => {
    const ctx = createMockCtx({
      from: { id: 999 },
      match: [null, "555"],
    });
    await handleBroadcastConfirm(ctx, { tenantId: tenant._id, bot });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ show_alert: true })
    );
  });

  it("reports expired broadcast", async () => {
    const ctx = createMockCtx({
      from: { id: 555 },
      match: [null, "555"],
    });
    await handleBroadcastConfirm(ctx, { tenantId: tenant._id, bot });
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining("expired"));
  });

  it("sends text broadcast to telegram customers", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
    });
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 222,
      alias: "User-2",
    });

    const key = `${tenant._id}:555`;
    pendingBroadcasts.set(key, { text: "Hello all", fileId: null, fileType: null, timestamp: Date.now() });

    const ctx = createMockCtx({
      from: { id: 555 },
      match: [null, "555"],
    });
    await handleBroadcastConfirm(ctx, { tenantId: tenant._id, bot });

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(111, "Hello all");
    expect(bot.api.sendMessage).toHaveBeenCalledWith(222, "Hello all");
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining("2 sent"));
  });

  it("sends photo broadcast to telegram customers", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
    });

    const key = `${tenant._id}:555`;
    pendingBroadcasts.set(key, { text: "Caption", fileId: "photo123", fileType: "photo", timestamp: Date.now() });

    const ctx = createMockCtx({
      from: { id: 555 },
      match: [null, "555"],
    });
    await handleBroadcastConfirm(ctx, { tenantId: tenant._id, bot });

    expect(bot.api.sendPhoto).toHaveBeenCalledWith(111, "photo123", { caption: "Caption" });
  });

  it("sends document broadcast to telegram customers", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
    });

    const key = `${tenant._id}:555`;
    pendingBroadcasts.set(key, { text: "A file", fileId: "doc123", fileType: "document", timestamp: Date.now() });

    const ctx = createMockCtx({
      from: { id: 555 },
      match: [null, "555"],
    });
    await handleBroadcastConfirm(ctx, { tenantId: tenant._id, bot });

    expect(bot.api.sendDocument).toHaveBeenCalledWith(111, "doc123", { caption: "A file" });
  });

  it("skips blocked customers", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
      status: "blocked",
    });
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 222,
      alias: "User-2",
      status: "open",
    });

    const key = `${tenant._id}:555`;
    pendingBroadcasts.set(key, { text: "Hello", fileId: null, fileType: null, timestamp: Date.now() });

    const ctx = createMockCtx({
      from: { id: 555 },
      match: [null, "555"],
    });
    await handleBroadcastConfirm(ctx, { tenantId: tenant._id, bot });

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(222, "Hello");
  });

  it("counts blocked errors separately", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
    });

    bot.api.sendMessage.mockRejectedValueOnce(new Error("403 bot was blocked"));

    const key = `${tenant._id}:555`;
    pendingBroadcasts.set(key, { text: "Hello", fileId: null, fileType: null, timestamp: Date.now() });

    const ctx = createMockCtx({
      from: { id: 555 },
      match: [null, "555"],
    });
    await handleBroadcastConfirm(ctx, { tenantId: tenant._id, bot });

    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining("1 blocked"));
  });
});

describe("handleBroadcastCancel", () => {
  let tenant;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
  });

  it("cancels the broadcast and removes from pending", async () => {
    const key = `${tenant._id}:555`;
    pendingBroadcasts.set(key, { text: "Hello", timestamp: Date.now() });

    const ctx = createMockCtx({
      from: { id: 555 },
      match: [null, "555"],
    });
    await handleBroadcastCancel(ctx, { tenantId: tenant._id });

    expect(pendingBroadcasts.has(key)).toBe(false);
    expect(ctx.editMessageText).toHaveBeenCalledWith("❌ Broadcast cancelled.");
  });

  it("rejects cancellation from a different user", async () => {
    const ctx = createMockCtx({
      from: { id: 999 },
      match: [null, "555"],
    });
    await handleBroadcastCancel(ctx, { tenantId: tenant._id });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ show_alert: true })
    );
  });
});

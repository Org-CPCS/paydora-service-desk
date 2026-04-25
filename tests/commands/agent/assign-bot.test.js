const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx } = require("../../setup");
const { handleAssignBot, handleAssignBotCallback } = require("../../../src/commands/agent/assign-bot");
const Customer = require("../../../src/db/models/customer");
const Tenant = require("../../../src/db/models/tenant");
const TenantBot = require("../../../src/db/models/tenant-bot");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("handleAssignBot", () => {
  let tenant;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
  });

  it("requires a topic thread", async () => {
    const ctx = createMockCtx();
    await handleAssignBot(ctx, { tenantId: tenant._id, threadId: null });
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("inside a customer topic"),
      {}
    );
  });

  it("reports if no customer found for topic", async () => {
    const ctx = createMockCtx();
    await handleAssignBot(ctx, { tenantId: tenant._id, threadId: 999 });
    expect(ctx.reply).toHaveBeenCalledWith(
      "❓ No customer found for this topic.",
      { message_thread_id: 999 }
    );
  });

  it("reports if no bots configured", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
      threadId: 42,
    });

    const ctx = createMockCtx();
    await handleAssignBot(ctx, { tenantId: tenant._id, threadId: 42 });
    expect(ctx.reply).toHaveBeenCalledWith(
      "⚠️ No bots configured for this tenant.",
      { message_thread_id: 42 }
    );
  });

  it("shows inline keyboard with available bots", async () => {
    await TenantBot.create({ tenantId: tenant._id, botToken: "tok-a", botUsername: "botA" });
    await TenantBot.create({ tenantId: tenant._id, botToken: "tok-b", botUsername: "botB" });
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
      threadId: 42,
      lastBotToken: "tok-a",
    });

    const ctx = createMockCtx();
    await handleAssignBot(ctx, { tenantId: tenant._id, threadId: 42 });

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Assign a bot"),
      expect.objectContaining({ reply_markup: expect.anything() })
    );
    // The message should mention the currently assigned bot
    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("@botA");
  });

  it("marks the currently assigned bot with a checkmark", async () => {
    await TenantBot.create({ tenantId: tenant._id, botToken: "tok-a", botUsername: "botA" });
    await TenantBot.create({ tenantId: tenant._id, botToken: "tok-b", botUsername: "botB" });
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
      threadId: 42,
      lastBotToken: "tok-a",
    });

    const ctx = createMockCtx();
    await handleAssignBot(ctx, { tenantId: tenant._id, threadId: 42 });

    // Check the inline keyboard has the checkmark on botA
    const replyMarkup = ctx.reply.mock.calls[0][1].reply_markup;
    const buttons = replyMarkup.inline_keyboard.flat();
    const botAButton = buttons.find((b) => b.callback_data === "assignbot:tok-a");
    const botBButton = buttons.find((b) => b.callback_data === "assignbot:tok-b");
    expect(botAButton.text).toContain("✅");
    expect(botBButton.text).not.toContain("✅");
  });
});

describe("handleAssignBotCallback", () => {
  let tenant;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
  });

  it("assigns the selected bot to the customer", async () => {
    await TenantBot.create({ tenantId: tenant._id, botToken: "tok-a", botUsername: "botA" });
    await TenantBot.create({ tenantId: tenant._id, botToken: "tok-b", botUsername: "botB" });
    const customer = await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
      threadId: 42,
      lastBotToken: "tok-a",
    });

    const ctx = createMockCtx({
      match: [null, "tok-b"],
      callbackQuery: {
        message: { message_thread_id: 42 },
      },
    });
    await handleAssignBotCallback(ctx, { tenantId: tenant._id });

    const updated = await Customer.findById(customer._id);
    expect(updated.lastBotToken).toBe("tok-b");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("@botB") })
    );
  });

  it("rejects if no thread found", async () => {
    const ctx = createMockCtx({
      match: [null, "tok-b"],
      callbackQuery: { message: {} },
    });
    await handleAssignBotCallback(ctx, { tenantId: tenant._id });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ show_alert: true })
    );
  });

  it("rejects if customer not found", async () => {
    const ctx = createMockCtx({
      match: [null, "tok-b"],
      callbackQuery: { message: { message_thread_id: 999 } },
    });
    await handleAssignBotCallback(ctx, { tenantId: tenant._id });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Customer not found.", show_alert: true })
    );
  });

  it("rejects if selected bot not found", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
      threadId: 42,
    });

    const ctx = createMockCtx({
      match: [null, "nonexistent-token"],
      callbackQuery: { message: { message_thread_id: 42 } },
    });
    await handleAssignBotCallback(ctx, { tenantId: tenant._id });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Bot not found or inactive.", show_alert: true })
    );
  });
});

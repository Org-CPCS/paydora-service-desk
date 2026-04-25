const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx, createMockBot } = require("../../setup");
const { handleBlock } = require("../../../src/commands/agent/block");
const Customer = require("../../../src/db/models/customer");
const Tenant = require("../../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("handleBlock", () => {
  let tenant, bot;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    bot = createMockBot();
  });

  it("blocks the customer and closes the topic", async () => {
    const customer = await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "Alex-1",
      threadId: 42,
      status: "open",
    });

    const ctx = createMockCtx();
    await handleBlock(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 42, bot });

    const updated = await Customer.findById(customer._id);
    expect(updated.status).toBe("blocked");
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("has been blocked"),
      { message_thread_id: 42 }
    );
    expect(bot.api.closeForumTopic).toHaveBeenCalledWith(-100, 42);
  });

  it("reports if customer not found", async () => {
    const ctx = createMockCtx();
    await handleBlock(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 999, bot });
    expect(ctx.reply).toHaveBeenCalledWith("❓ No customer found for this topic.", { message_thread_id: 999 });
  });

  it("reports if customer already blocked", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "Alex-1",
      threadId: 42,
      status: "blocked",
    });

    const ctx = createMockCtx();
    await handleBlock(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 42, bot });
    expect(ctx.reply).toHaveBeenCalledWith("ℹ️ This user is already blocked.", { message_thread_id: 42 });
  });

  it("handles closeForumTopic failure gracefully", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "Alex-1",
      threadId: 42,
    });

    bot.api.closeForumTopic.mockRejectedValueOnce(new Error("API error"));
    const ctx = createMockCtx();

    // Should not throw
    await handleBlock(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 42, bot });
    expect(ctx.reply).toHaveBeenCalled();
  });
});

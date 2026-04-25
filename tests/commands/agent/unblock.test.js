const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx, createMockBot } = require("../../setup");
const { handleUnblock } = require("../../../src/commands/agent/unblock");
const Customer = require("../../../src/db/models/customer");
const Tenant = require("../../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("handleUnblock", () => {
  let tenant, bot;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    bot = createMockBot();
  });

  it("unblocks the customer and reopens the topic", async () => {
    const customer = await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "Alex-1",
      threadId: 42,
      status: "blocked",
    });

    const ctx = createMockCtx();
    await handleUnblock(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 42, bot });

    const updated = await Customer.findById(customer._id);
    expect(updated.status).toBe("open");
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("has been unblocked"),
      { message_thread_id: 42 }
    );
    expect(bot.api.reopenForumTopic).toHaveBeenCalledWith(-100, 42);
  });

  it("reports if customer not found", async () => {
    const ctx = createMockCtx();
    await handleUnblock(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 999, bot });
    expect(ctx.reply).toHaveBeenCalledWith("❓ No customer found for this topic.", { message_thread_id: 999 });
  });

  it("reports if customer is not blocked", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "Alex-1",
      threadId: 42,
      status: "open",
    });

    const ctx = createMockCtx();
    await handleUnblock(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 42, bot });
    expect(ctx.reply).toHaveBeenCalledWith("ℹ️ This user is not blocked.", { message_thread_id: 42 });
  });
});

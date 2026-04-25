const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx } = require("../../setup");
const { handleClose } = require("../../../src/commands/agent/close");
const Customer = require("../../../src/db/models/customer");
const Tenant = require("../../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("handleClose", () => {
  let tenant;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
  });

  it("closes the conversation and renames the topic", async () => {
    const customer = await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "Alex-1",
      threadId: 42,
      status: "open",
    });

    const ctx = createMockCtx();
    await handleClose(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 42 });

    const updated = await Customer.findById(customer._id);
    expect(updated.status).toBe("closed");
    expect(ctx.reply).toHaveBeenCalledWith("✅ Conversation closed.", { message_thread_id: 42 });
    expect(ctx.api.editForumTopic).toHaveBeenCalledWith(-100, 42, { name: "[done] Alex-1" });
    expect(ctx.api.closeForumTopic).toHaveBeenCalledWith(-100, 42);
  });

  it("does nothing if no customer found", async () => {
    const ctx = createMockCtx();
    await handleClose(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 999 });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("handles topic API failure gracefully", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "Alex-1",
      threadId: 42,
    });

    const ctx = createMockCtx();
    ctx.api.editForumTopic.mockRejectedValueOnce(new Error("API error"));

    // Should not throw
    await handleClose(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 42 });
    expect(ctx.reply).toHaveBeenCalledWith("✅ Conversation closed.", { message_thread_id: 42 });
  });
});

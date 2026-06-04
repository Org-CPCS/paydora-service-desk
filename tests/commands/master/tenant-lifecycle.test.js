const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx } = require("../../setup");
const { handleStop, handleStart, handleRemove, handleStatus } = require("../../../src/commands/master/tenant-lifecycle");
const Tenant = require("../../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("tenant-lifecycle ObjectId validation", () => {
  const mockBotManager = {
    stopBot: jest.fn(),
    startBot: jest.fn(),
    getStatus: jest.fn().mockReturnValue(null),
  };

  it("/stop rejects invalid ObjectId (numeric bot ID)", async () => {
    const ctx = createMockCtx({ match: "8882312657" });
    await handleStop(ctx, { botManager: mockBotManager });

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("is not a valid tenant ID")
    );
    expect(mockBotManager.stopBot).not.toHaveBeenCalled();
  });

  it("/start rejects invalid ObjectId (numeric bot ID)", async () => {
    const ctx = createMockCtx({ match: "8882312657" });
    await handleStart(ctx, { botManager: mockBotManager });

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("is not a valid tenant ID")
    );
    expect(mockBotManager.startBot).not.toHaveBeenCalled();
  });

  it("/remove rejects invalid ObjectId (numeric bot ID)", async () => {
    const ctx = createMockCtx({ match: "8882312657" });
    await handleRemove(ctx, { botManager: mockBotManager });

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("is not a valid tenant ID")
    );
    expect(mockBotManager.stopBot).not.toHaveBeenCalled();
  });

  it("/status rejects invalid ObjectId (numeric bot ID)", async () => {
    const ctx = createMockCtx({ match: "8882312657" });
    await handleStatus(ctx, { botManager: mockBotManager });

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("is not a valid tenant ID")
    );
  });

  it("/stop rejects random string as ObjectId", async () => {
    const ctx = createMockCtx({ match: "not-an-objectid" });
    await handleStop(ctx, { botManager: mockBotManager });

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("is not a valid tenant ID")
    );
  });

  it("/stop works with a valid ObjectId", async () => {
    const tenant = await Tenant.create({
      botToken: "tok1",
      agentGroupId: -100,
      status: "active",
    });

    const ctx = createMockCtx({ match: tenant._id.toString() });
    await handleStop(ctx, { botManager: mockBotManager });

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("stopped")
    );
    expect(mockBotManager.stopBot).toHaveBeenCalledWith(tenant._id.toString());

    const updated = await Tenant.findById(tenant._id);
    expect(updated.status).toBe("inactive");
  });

  it("/start works with a valid ObjectId", async () => {
    const tenant = await Tenant.create({
      botToken: "tok2",
      agentGroupId: -200,
      status: "inactive",
    });

    const ctx = createMockCtx({ match: tenant._id.toString() });
    await handleStart(ctx, { botManager: mockBotManager });

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("started")
    );
    expect(mockBotManager.startBot).toHaveBeenCalled();

    const updated = await Tenant.findById(tenant._id);
    expect(updated.status).toBe("active");
  });

  it("/status returns not found for valid ObjectId that doesn't exist", async () => {
    const ctx = createMockCtx({ match: "aaaaaaaaaaaaaaaaaaaaaaaa" });
    await handleStatus(ctx, { botManager: mockBotManager });

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("not found")
    );
  });

  it("/stop returns usage hint when no argument given", async () => {
    const ctx = createMockCtx({ match: "" });
    await handleStop(ctx, { botManager: mockBotManager });

    expect(ctx.reply).toHaveBeenCalledWith("Usage: /stop <tenant_id>");
  });
});

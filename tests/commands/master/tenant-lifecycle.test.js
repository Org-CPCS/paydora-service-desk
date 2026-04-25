const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx } = require("../../setup");
const { handleStop, handleStart, handleRemove, handleList, handleStatus } = require("../../../src/commands/master/tenant-lifecycle");
const Tenant = require("../../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

function createMockBotManager() {
  return {
    stopBot: jest.fn().mockResolvedValue(undefined),
    startBot: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue(null),
    bots: new Map(),
  };
}

describe("handleStop", () => {
  it("shows usage when no tenant_id", async () => {
    const ctx = createMockCtx({ match: "" });
    await handleStop(ctx, { botManager: createMockBotManager() });
    expect(ctx.reply).toHaveBeenCalledWith("Usage: /stop <tenant_id>");
  });

  it("reports tenant not found", async () => {
    const ctx = createMockCtx({ match: "64a1b2c3d4e5f6a7b8c9d0e1" });
    await handleStop(ctx, { botManager: createMockBotManager() });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("stops the tenant and sets status to inactive", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100, status: "active" });
    const bm = createMockBotManager();
    const ctx = createMockCtx({ match: tenant._id.toString() });

    await handleStop(ctx, { botManager: bm });

    const updated = await Tenant.findById(tenant._id);
    expect(updated.status).toBe("inactive");
    expect(bm.stopBot).toHaveBeenCalledWith(tenant._id.toString());
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("stopped"));
  });
});

describe("handleStart", () => {
  it("shows usage when no tenant_id", async () => {
    const ctx = createMockCtx({ match: "" });
    await handleStart(ctx, { botManager: createMockBotManager() });
    expect(ctx.reply).toHaveBeenCalledWith("Usage: /start <tenant_id>");
  });

  it("starts the tenant and sets status to active", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100, status: "inactive" });
    const bm = createMockBotManager();
    const ctx = createMockCtx({ match: tenant._id.toString() });

    await handleStart(ctx, { botManager: bm });

    const updated = await Tenant.findById(tenant._id);
    expect(updated.status).toBe("active");
    expect(bm.startBot).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("started"));
  });
});

describe("handleRemove", () => {
  it("removes the tenant and stops the bot", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    const bm = createMockBotManager();
    const ctx = createMockCtx({ match: tenant._id.toString() });

    await handleRemove(ctx, { botManager: bm });

    const updated = await Tenant.findById(tenant._id);
    expect(updated.status).toBe("removed");
    expect(bm.stopBot).toHaveBeenCalledWith(tenant._id.toString());
  });
});

describe("handleList", () => {
  it("reports when no tenants registered", async () => {
    const ctx = createMockCtx();
    await handleList(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("No tenants registered.");
  });

  it("lists all tenants", async () => {
    await Tenant.create({ botToken: "tok1", agentGroupId: -100, botUsername: "bot1" });
    await Tenant.create({ botToken: "tok2", agentGroupId: -200, botUsername: "bot2", status: "inactive" });

    const ctx = createMockCtx();
    await handleList(ctx);

    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("@bot1");
    expect(msg).toContain("@bot2");
    expect(msg).toContain("active");
    expect(msg).toContain("inactive");
  });
});

describe("handleStatus", () => {
  it("shows usage when no tenant_id", async () => {
    const ctx = createMockCtx({ match: "" });
    await handleStatus(ctx, { botManager: createMockBotManager() });
    expect(ctx.reply).toHaveBeenCalledWith("Usage: /status <tenant_id>");
  });

  it("shows tenant status with uptime", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100, botUsername: "mybot" });
    const bm = createMockBotManager();
    bm.getStatus.mockReturnValue({ running: true, startedAt: new Date(Date.now() - 3661000) }); // ~1h 1m 1s

    const ctx = createMockCtx({ match: tenant._id.toString() });
    await handleStatus(ctx, { botManager: bm });

    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("active");
    expect(msg).toContain("@mybot");
    expect(msg).toContain("1h");
  });

  it("shows N/A uptime when bot is not running", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    const bm = createMockBotManager();

    const ctx = createMockCtx({ match: tenant._id.toString() });
    await handleStatus(ctx, { botManager: bm });

    expect(ctx.reply.mock.calls[0][0]).toContain("N/A");
  });
});

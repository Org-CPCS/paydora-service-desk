const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx } = require("../../setup");
const { handleListBots } = require("../../../src/commands/master/list-bots");
const Tenant = require("../../../src/db/models/tenant");
const TenantBot = require("../../../src/db/models/tenant-bot");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

function createMockBotManager(runningKeys = []) {
  const bots = new Map();
  for (const key of runningKeys) {
    bots.set(key, { bot: {}, startedAt: new Date() });
  }
  return {
    bots,
    getStatus: jest.fn((tenantId) => {
      for (const [key] of bots) {
        if (key === tenantId || key.startsWith(tenantId + ":")) {
          return { running: true, startedAt: new Date() };
        }
      }
      return null;
    }),
  };
}

describe("handleListBots", () => {
  it("shows usage when no tenant_id", async () => {
    const ctx = createMockCtx({ match: "" });
    await handleListBots(ctx, { botManager: createMockBotManager() });
    expect(ctx.reply).toHaveBeenCalledWith("Usage: /listbots <tenant_id>");
  });

  it("reports tenant not found", async () => {
    const ctx = createMockCtx({ match: "64a1b2c3d4e5f6a7b8c9d0e1" });
    await handleListBots(ctx, { botManager: createMockBotManager() });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("shows legacy single-bot tenant", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100, botUsername: "mybot" });
    const bm = createMockBotManager([tenant._id.toString()]);

    const ctx = createMockCtx({ match: tenant._id.toString() });
    await handleListBots(ctx, { botManager: bm });

    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("@mybot");
    expect(msg).toContain("🟢 running");
    expect(msg).toContain("primary");
  });

  it("shows multiple bots for a tenant", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100, botUsername: "bot1" });
    await TenantBot.create({ tenantId: tenant._id, botToken: "tok1", botUsername: "bot1" });
    await TenantBot.create({ tenantId: tenant._id, botToken: "tok2", botUsername: "bot2" });

    const tenantId = tenant._id.toString();
    const bm = createMockBotManager([`${tenantId}:tok1`]);

    const ctx = createMockCtx({ match: tenantId });
    await handleListBots(ctx, { botManager: bm });

    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("2 bots");
    expect(msg).toContain("@bot1");
    expect(msg).toContain("@bot2");
    expect(msg).toContain("🟢 running"); // bot1 is running
    expect(msg).toContain("🔴 stopped"); // bot2 is not
  });

  it("excludes removed bots", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    await TenantBot.create({ tenantId: tenant._id, botToken: "tok1", botUsername: "bot1" });
    await TenantBot.create({ tenantId: tenant._id, botToken: "tok2", botUsername: "bot2", status: "removed" });

    const ctx = createMockCtx({ match: tenant._id.toString() });
    await handleListBots(ctx, { botManager: createMockBotManager() });

    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("1 bot");
    expect(msg).toContain("@bot1");
    expect(msg).not.toContain("@bot2");
  });
});

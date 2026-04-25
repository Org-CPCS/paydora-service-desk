const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx, createMockBot } = require("../../setup");
const { handleMessageAllUsers, handleMessage } = require("../../../src/commands/master/messaging");
const Customer = require("../../../src/db/models/customer");
const Tenant = require("../../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

function createMockBotManager(subBot) {
  const bots = new Map();
  return {
    bots,
    getBotForTenant: jest.fn((tenantId) => {
      // Look for any entry matching the tenantId
      for (const [key, entry] of bots) {
        if (key === tenantId || key.startsWith(tenantId + ":")) {
          return entry;
        }
      }
      return undefined;
    }),
  };
}

describe("handleMessageAllUsers", () => {
  let tenant, subBot;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    subBot = createMockBot();
  });

  it("shows usage when no arguments", async () => {
    const ctx = createMockCtx({ match: "" });
    await handleMessageAllUsers(ctx, { botManager: createMockBotManager() });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage"));
  });

  it("shows usage when only tenant_id provided", async () => {
    const ctx = createMockCtx({ match: tenant._id.toString() });
    await handleMessageAllUsers(ctx, { botManager: createMockBotManager() });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage"));
  });

  it("reports tenant not found", async () => {
    const ctx = createMockCtx({ match: "64a1b2c3d4e5f6a7b8c9d0e1 Hello" });
    await handleMessageAllUsers(ctx, { botManager: createMockBotManager() });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("reports when sub-bot is not running", async () => {
    const bm = createMockBotManager();
    const ctx = createMockCtx({ match: `${tenant._id} Hello` });
    await handleMessageAllUsers(ctx, { botManager: bm });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("not running"));
  });

  it("reports when no customers found", async () => {
    const bm = createMockBotManager();
    bm.bots.set(tenant._id.toString(), { bot: subBot });
    const ctx = createMockCtx({ match: `${tenant._id} Hello` });
    await handleMessageAllUsers(ctx, { botManager: bm });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("No customers found"));
  });

  it("broadcasts to all non-blocked customers", async () => {
    await Customer.create({ tenantId: tenant._id, telegramUserId: 111, alias: "U-1" });
    await Customer.create({ tenantId: tenant._id, telegramUserId: 222, alias: "U-2" });
    await Customer.create({ tenantId: tenant._id, telegramUserId: 333, alias: "U-3", status: "blocked" });

    const bm = createMockBotManager();
    bm.bots.set(tenant._id.toString(), { bot: subBot });
    const ctx = createMockCtx({ match: `${tenant._id} Hello everyone` });
    await handleMessageAllUsers(ctx, { botManager: bm });

    expect(subBot.api.sendMessage).toHaveBeenCalledTimes(2);
    expect(subBot.api.sendMessage).toHaveBeenCalledWith(111, "Hello everyone");
    expect(subBot.api.sendMessage).toHaveBeenCalledWith(222, "Hello everyone");
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("2 sent, 0 failed"));
  });

  it("counts failures", async () => {
    await Customer.create({ tenantId: tenant._id, telegramUserId: 111, alias: "U-1" });
    subBot.api.sendMessage.mockRejectedValueOnce(new Error("Network error"));

    const bm = createMockBotManager();
    bm.bots.set(tenant._id.toString(), { bot: subBot });
    const ctx = createMockCtx({ match: `${tenant._id} Hello` });
    await handleMessageAllUsers(ctx, { botManager: bm });

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("0 sent, 1 failed"));
  });
});

describe("handleMessage", () => {
  let tenant, subBot;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100, botUsername: "mybot" });
    subBot = createMockBot();
  });

  it("shows usage when insufficient arguments", async () => {
    const ctx = createMockCtx({ match: "tenantid" });
    await handleMessage(ctx, { botManager: createMockBotManager() });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage"));
  });

  it("rejects non-numeric user_id", async () => {
    const ctx = createMockCtx({ match: `${tenant._id} abc Hello` });
    await handleMessage(ctx, { botManager: createMockBotManager() });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("must be a number"));
  });

  it("sends a message to the specified user", async () => {
    const bm = createMockBotManager();
    bm.bots.set(tenant._id.toString(), { bot: subBot });
    const ctx = createMockCtx({ match: `${tenant._id} 12345 Hello there` });
    await handleMessage(ctx, { botManager: bm });

    expect(subBot.api.sendMessage).toHaveBeenCalledWith(12345, "Hello there");
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Message sent"));
  });

  it("reports send failure", async () => {
    subBot.api.sendMessage.mockRejectedValueOnce(new Error("403 Forbidden"));
    const bm = createMockBotManager();
    bm.bots.set(tenant._id.toString(), { bot: subBot });
    const ctx = createMockCtx({ match: `${tenant._id} 12345 Hello` });
    await handleMessage(ctx, { botManager: bm });

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Failed to send"));
  });
});

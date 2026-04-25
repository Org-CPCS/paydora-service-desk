const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx } = require("../../setup");
const { handleListUsers, handleUserCount } = require("../../../src/commands/master/user-management");
const Customer = require("../../../src/db/models/customer");
const Tenant = require("../../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("handleListUsers", () => {
  it("shows usage when no tenant_id", async () => {
    const ctx = createMockCtx({ match: "" });
    await handleListUsers(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Usage: /listusers <tenant_id>");
  });

  it("reports tenant not found", async () => {
    const ctx = createMockCtx({ match: "64a1b2c3d4e5f6a7b8c9d0e1" });
    await handleListUsers(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("reports when no customers found", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    const ctx = createMockCtx({ match: tenant._id.toString() });
    await handleListUsers(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("No customers found"));
  });

  it("lists all customers with details", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "Alex-1",
      firstName: "Alex",
      lastName: "Smith",
      username: "asmith",
    });
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 222,
      alias: "User-2",
    });

    const ctx = createMockCtx({ match: tenant._id.toString() });
    await handleListUsers(ctx);

    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("2 customers");
    expect(msg).toContain("Alex-1");
    expect(msg).toContain("Alex Smith");
    expect(msg).toContain("@asmith");
    expect(msg).toContain("User-2");
    expect(msg).toContain("no username");
  });
});

describe("handleUserCount", () => {
  it("shows usage when no tenant_id", async () => {
    const ctx = createMockCtx({ match: "" });
    await handleUserCount(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Usage: /usercount <tenant_id>");
  });

  it("shows customer count", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100, botUsername: "mybot" });
    await Customer.create({ tenantId: tenant._id, telegramUserId: 111, alias: "U-1" });
    await Customer.create({ tenantId: tenant._id, telegramUserId: 222, alias: "U-2" });

    const ctx = createMockCtx({ match: tenant._id.toString() });
    await handleUserCount(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("2 customers"));
    expect(ctx.reply.mock.calls[0][0]).toContain("@mybot");
  });

  it("shows singular form for 1 customer", async () => {
    const tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    await Customer.create({ tenantId: tenant._id, telegramUserId: 111, alias: "U-1" });

    const ctx = createMockCtx({ match: tenant._id.toString() });
    await handleUserCount(ctx);

    expect(ctx.reply.mock.calls[0][0]).toMatch(/1 customer[^s]/);
  });
});

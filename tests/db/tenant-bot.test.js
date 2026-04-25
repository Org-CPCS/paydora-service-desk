const { setupTestDb, clearTestDb, teardownTestDb } = require("../setup");
const Tenant = require("../../src/db/models/tenant");
const TenantBot = require("../../src/db/models/tenant-bot");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("TenantBot model", () => {
  let tenant;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "master-tok", agentGroupId: -100 });
  });

  it("creates a tenant bot with required fields", async () => {
    const tb = await TenantBot.create({
      tenantId: tenant._id,
      botToken: "bot-tok-1",
    });
    expect(tb.tenantId.toString()).toBe(tenant._id.toString());
    expect(tb.botToken).toBe("bot-tok-1");
    expect(tb.status).toBe("active"); // default
    expect(tb.createdAt).toBeInstanceOf(Date);
  });

  it("stores optional botUsername", async () => {
    const tb = await TenantBot.create({
      tenantId: tenant._id,
      botToken: "bot-tok-1",
      botUsername: "mybot",
    });
    expect(tb.botUsername).toBe("mybot");
  });

  it("enforces unique botToken globally", async () => {
    await TenantBot.create({ tenantId: tenant._id, botToken: "dup-tok" });
    const tenant2 = await Tenant.create({ botToken: "master-tok-2", agentGroupId: -200 });
    await expect(
      TenantBot.create({ tenantId: tenant2._id, botToken: "dup-tok" })
    ).rejects.toThrow();
  });

  it("allows multiple bots per tenant", async () => {
    const tb1 = await TenantBot.create({ tenantId: tenant._id, botToken: "tok-1", botUsername: "bot1" });
    const tb2 = await TenantBot.create({ tenantId: tenant._id, botToken: "tok-2", botUsername: "bot2" });
    const bots = await TenantBot.find({ tenantId: tenant._id });
    expect(bots).toHaveLength(2);
  });

  it("validates status enum", async () => {
    await expect(
      TenantBot.create({ tenantId: tenant._id, botToken: "tok-1", status: "invalid" })
    ).rejects.toThrow();
  });
});

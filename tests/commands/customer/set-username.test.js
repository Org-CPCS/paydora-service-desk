const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx } = require("../../setup");
const { handleSetUsername } = require("../../../src/commands/customer/set-username");
const Customer = require("../../../src/db/models/customer");
const Tenant = require("../../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("handleSetUsername", () => {
  let tenant;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
  });

  it("shows usage when no name provided", async () => {
    const ctx = createMockCtx({ message: { text: "/setusername" } });
    await handleSetUsername(ctx, { tenantId: tenant._id });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage"));
  });

  it("rejects names longer than 64 characters", async () => {
    const longName = "A".repeat(65);
    const ctx = createMockCtx({ message: { text: `/setusername ${longName}` } });
    await handleSetUsername(ctx, { tenantId: tenant._id });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("too long"));
  });

  it("updates customer firstName when customer exists", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
      firstName: "OldName",
    });

    const ctx = createMockCtx({
      message: { text: "/setusername NewName" },
      from: { id: 111 },
    });
    await handleSetUsername(ctx, { tenantId: tenant._id });

    const updated = await Customer.findOne({ tenantId: tenant._id, telegramUserId: 111 });
    expect(updated.firstName).toBe("NewName");
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("NewName"));
  });

  it("responds with confirmation even if customer does not exist yet", async () => {
    const ctx = createMockCtx({
      message: { text: "/setusername MyName" },
      from: { id: 999 },
    });
    await handleSetUsername(ctx, { tenantId: tenant._id });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("MyName"));
  });
});

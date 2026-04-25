const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx } = require("../../setup");
const { handleAddGroup } = require("../../../src/commands/master/add-group");
const EmptyGroup = require("../../../src/db/models/empty-group");
const Tenant = require("../../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("handleAddGroup", () => {
  it("shows usage when no group_id provided", async () => {
    const ctx = createMockCtx({ match: "" });
    await handleAddGroup(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Usage: /addgroup <group_id>");
  });

  it("rejects non-numeric group_id", async () => {
    const ctx = createMockCtx({ match: "abc" });
    await handleAddGroup(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Invalid argument: group_id must be a number.");
  });

  it("adds a new group to the pool", async () => {
    const ctx = createMockCtx({ match: "-1001234" });
    await handleAddGroup(ctx);

    const group = await EmptyGroup.findOne({ groupId: -1001234 });
    expect(group).not.toBeNull();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("added to the pool"));
  });

  it("rejects duplicate group", async () => {
    await EmptyGroup.create({ groupId: -1001234 });
    const ctx = createMockCtx({ match: "-1001234" });
    await handleAddGroup(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Group -1001234 is already in the pool.");
  });

  it("rejects group already assigned to a tenant", async () => {
    await Tenant.create({ botToken: "tok1", agentGroupId: -1001234 });
    const ctx = createMockCtx({ match: "-1001234" });
    await handleAddGroup(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("already assigned to tenant"));
  });

  it("allows group assigned to a removed tenant", async () => {
    await Tenant.create({ botToken: "tok1", agentGroupId: -1001234, status: "removed" });
    const ctx = createMockCtx({ match: "-1001234" });
    await handleAddGroup(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("added to the pool"));
  });
});

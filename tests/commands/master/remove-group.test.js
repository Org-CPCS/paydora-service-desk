const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx } = require("../../setup");
const { handleRemoveGroup } = require("../../../src/commands/master/remove-group");
const EmptyGroup = require("../../../src/db/models/empty-group");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("handleRemoveGroup", () => {
  it("shows usage when no group_id provided", async () => {
    const ctx = createMockCtx({ match: "" });
    await handleRemoveGroup(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Usage: /removegroup <group_id>");
  });

  it("rejects non-numeric group_id", async () => {
    const ctx = createMockCtx({ match: "abc" });
    await handleRemoveGroup(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Invalid argument: group_id must be a number.");
  });

  it("removes an existing group from the pool", async () => {
    await EmptyGroup.create({ groupId: -1001234 });
    const ctx = createMockCtx({ match: "-1001234" });
    await handleRemoveGroup(ctx);

    const group = await EmptyGroup.findOne({ groupId: -1001234 });
    expect(group).toBeNull();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("removed from the pool"));
  });

  it("reports when group is not in the pool", async () => {
    const ctx = createMockCtx({ match: "-999" });
    await handleRemoveGroup(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Group -999 is not in the pool.");
  });
});

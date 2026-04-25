const { setupTestDb, clearTestDb, teardownTestDb } = require("../setup");
const { getNextAlias } = require("../../src/db/get-next-alias");
const Counter = require("../../src/db/models/counter");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("getNextAlias", () => {
  it("generates sequential aliases with firstName", async () => {
    const a1 = await getNextAlias("tenant1", "Alex");
    const a2 = await getNextAlias("tenant1", "Alex");
    const a3 = await getNextAlias("tenant1", "Alex");
    expect(a1).toBe("Alex-1");
    expect(a2).toBe("Alex-2");
    expect(a3).toBe("Alex-3");
  });

  it("uses 'User' when firstName is not provided", async () => {
    const alias = await getNextAlias("tenant2", null);
    expect(alias).toBe("User-1");
  });

  it("uses 'User' when firstName is undefined", async () => {
    const alias = await getNextAlias("tenant3");
    expect(alias).toBe("User-1");
  });

  it("maintains separate counters per tenant", async () => {
    const a1 = await getNextAlias("tenantA", "John");
    const b1 = await getNextAlias("tenantB", "Jane");
    const a2 = await getNextAlias("tenantA", "John");
    expect(a1).toBe("John-1");
    expect(b1).toBe("Jane-1");
    expect(a2).toBe("John-2");
  });

  it("persists counter in the database", async () => {
    await getNextAlias("tenantX", "Test");
    await getNextAlias("tenantX", "Test");
    const counter = await Counter.findById("alias:tenantX");
    expect(counter.seq).toBe(2);
  });
});

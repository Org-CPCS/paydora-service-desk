const mongoose = require("mongoose");
const { setupTestDb, clearTestDb, teardownTestDb } = require("../setup");
const Tenant = require("../../src/db/models/tenant");
const Customer = require("../../src/db/models/customer");
const Counter = require("../../src/db/models/counter");
const EmptyGroup = require("../../src/db/models/empty-group");
const GroupMember = require("../../src/db/models/group-member");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("Tenant model", () => {
  it("creates a tenant with required fields", async () => {
    const tenant = await Tenant.create({
      botToken: "token123",
      agentGroupId: -1001234,
    });
    expect(tenant.botToken).toBe("token123");
    expect(tenant.agentGroupId).toBe(-1001234);
    expect(tenant.status).toBe("active"); // default
    expect(tenant.createdAt).toBeInstanceOf(Date);
  });

  it("enforces unique botToken", async () => {
    await Tenant.create({ botToken: "dup", agentGroupId: -100 });
    await expect(
      Tenant.create({ botToken: "dup", agentGroupId: -200 })
    ).rejects.toThrow();
  });

  it("validates status enum", async () => {
    await expect(
      Tenant.create({ botToken: "t1", agentGroupId: -100, status: "invalid" })
    ).rejects.toThrow();
  });

  it("allows all valid statuses", async () => {
    for (const status of ["active", "inactive", "removed", "pending"]) {
      const t = await Tenant.create({
        botToken: `token-${status}`,
        agentGroupId: -100,
        status,
      });
      expect(t.status).toBe(status);
    }
  });

  it("stores optional fields", async () => {
    const tenant = await Tenant.create({
      botToken: "t2",
      agentGroupId: -100,
      botUsername: "mybot",
      webhookUrl: "https://example.com/hook",
    });
    expect(tenant.botUsername).toBe("mybot");
    expect(tenant.webhookUrl).toBe("https://example.com/hook");
  });
});

describe("Customer model", () => {
  let tenantId;

  beforeEach(async () => {
    const tenant = await Tenant.create({ botToken: "ct1", agentGroupId: -100 });
    tenantId = tenant._id;
  });

  it("creates a customer with required fields", async () => {
    const customer = await Customer.create({
      tenantId,
      telegramUserId: 12345,
      alias: "User-1",
    });
    expect(customer.alias).toBe("User-1");
    expect(customer.status).toBe("open"); // default
    expect(customer.source).toBe("telegram"); // default
  });

  it("enforces unique tenantId + telegramUserId", async () => {
    await Customer.create({ tenantId, telegramUserId: 111, alias: "A-1" });
    await expect(
      Customer.create({ tenantId, telegramUserId: 111, alias: "A-2" })
    ).rejects.toThrow();
  });

  it("enforces unique tenantId + alias", async () => {
    await Customer.create({ tenantId, telegramUserId: 111, alias: "A-1" });
    await expect(
      Customer.create({ tenantId, telegramUserId: 222, alias: "A-1" })
    ).rejects.toThrow();
  });

  it("allows same telegramUserId across different tenants", async () => {
    const tenant2 = await Tenant.create({ botToken: "ct2", agentGroupId: -200 });
    await Customer.create({ tenantId, telegramUserId: 111, alias: "A-1" });
    const c2 = await Customer.create({
      tenantId: tenant2._id,
      telegramUserId: 111,
      alias: "B-1",
    });
    expect(c2.telegramUserId).toBe(111);
  });

  it("stores optional profile fields", async () => {
    const customer = await Customer.create({
      tenantId,
      telegramUserId: 111,
      alias: "A-1",
      firstName: "John",
      lastName: "Doe",
      username: "johndoe",
    });
    expect(customer.firstName).toBe("John");
    expect(customer.lastName).toBe("Doe");
    expect(customer.username).toBe("johndoe");
  });

  it("supports web source with externalUserId", async () => {
    const customer = await Customer.create({
      tenantId,
      telegramUserId: 111,
      alias: "A-1",
      source: "web",
      externalUserId: "ext-123",
    });
    expect(customer.source).toBe("web");
    expect(customer.externalUserId).toBe("ext-123");
  });

  it("validates status enum", async () => {
    await expect(
      Customer.create({ tenantId, telegramUserId: 111, alias: "A-1", status: "invalid" })
    ).rejects.toThrow();
  });
});

describe("Counter model", () => {
  it("creates a counter with string _id", async () => {
    const counter = await Counter.create({ _id: "alias:tenant1", seq: 5 });
    expect(counter._id).toBe("alias:tenant1");
    expect(counter.seq).toBe(5);
  });

  it("defaults seq to 0", async () => {
    const counter = await Counter.create({ _id: "test" });
    expect(counter.seq).toBe(0);
  });
});

describe("EmptyGroup model", () => {
  it("creates an empty group", async () => {
    const group = await EmptyGroup.create({ groupId: -1001234 });
    expect(group.groupId).toBe(-1001234);
    expect(group.createdAt).toBeInstanceOf(Date);
  });

  it("enforces unique groupId", async () => {
    await EmptyGroup.create({ groupId: -100 });
    await expect(EmptyGroup.create({ groupId: -100 })).rejects.toThrow();
  });
});

describe("GroupMember model", () => {
  it("creates a group member", async () => {
    const member = await GroupMember.create({
      groupId: -100,
      userId: 111,
      username: "agent1",
    });
    expect(member.groupId).toBe(-100);
    expect(member.userId).toBe(111);
    expect(member.username).toBe("agent1");
  });

  it("enforces unique groupId + username", async () => {
    await GroupMember.create({ groupId: -100, userId: 111, username: "agent1" });
    await expect(
      GroupMember.create({ groupId: -100, userId: 222, username: "agent1" })
    ).rejects.toThrow();
  });

  it("enforces unique groupId + userId", async () => {
    await GroupMember.create({ groupId: -100, userId: 111, username: "agent1" });
    await expect(
      GroupMember.create({ groupId: -100, userId: 111, username: "agent2" })
    ).rejects.toThrow();
  });
});

describe("db/index barrel export", () => {
  it("re-exports all models and helpers", () => {
    const db = require("../../src/db/index");
    expect(db.connect).toBeInstanceOf(Function);
    expect(db.Tenant).toBeDefined();
    expect(db.Customer).toBeDefined();
    expect(db.Counter).toBeDefined();
    expect(db.EmptyGroup).toBeDefined();
    expect(db.GroupMember).toBeDefined();
    expect(db.getNextAlias).toBeInstanceOf(Function);
  });
});

describe("backwards-compat shim (src/db.js)", () => {
  it("re-exports the same interface", () => {
    const shim = require("../../src/db");
    const direct = require("../../src/db/index");
    expect(Object.keys(shim).sort()).toEqual(Object.keys(direct).sort());
  });
});

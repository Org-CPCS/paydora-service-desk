const { setupTestDb, clearTestDb, teardownTestDb, createMockBot } = require("../setup");
const { getOrCreateCustomer } = require("../../src/relay/get-or-create-customer");
const Customer = require("../../src/db/models/customer");
const Tenant = require("../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("getOrCreateCustomer", () => {
  let tenant, bot;
  const agentGroupId = -1001234;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId });
    bot = createMockBot();
  });

  it("creates a new customer with alias and topic", async () => {
    const fromUser = { first_name: "Alex", last_name: "Smith", username: "asmith" };
    const customer = await getOrCreateCustomer(bot, tenant._id, 111, fromUser, agentGroupId);

    expect(customer.alias).toBe("Alex-1");
    expect(customer.telegramUserId).toBe(111);
    expect(customer.firstName).toBe("Alex");
    expect(customer.lastName).toBe("Smith");
    expect(customer.username).toBe("asmith");
    expect(customer.threadId).toBe(999); // from mock createForumTopic
    expect(customer.status).toBe("open");

    // Should have created a forum topic
    expect(bot.api.createForumTopic).toHaveBeenCalledWith(agentGroupId, "Alex-1");
    // Should have posted a welcome message
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      agentGroupId,
      "New conversation started with Alex-1",
      { message_thread_id: 999 }
    );
  });

  it("returns existing customer with open status", async () => {
    const fromUser = { first_name: "Alex" };
    const c1 = await getOrCreateCustomer(bot, tenant._id, 111, fromUser, agentGroupId);
    bot.api.createForumTopic.mockClear();
    bot.api.sendMessage.mockClear();

    const c2 = await getOrCreateCustomer(bot, tenant._id, 111, fromUser, agentGroupId);
    expect(c2._id.toString()).toBe(c1._id.toString());
    // Should NOT create a new topic
    expect(bot.api.createForumTopic).not.toHaveBeenCalled();
  });

  it("reopens closed conversations", async () => {
    const fromUser = { first_name: "Alex" };
    const c1 = await getOrCreateCustomer(bot, tenant._id, 111, fromUser, agentGroupId);

    // Close the conversation
    c1.status = "closed";
    await c1.save();

    bot.api.sendMessage.mockClear();

    const c2 = await getOrCreateCustomer(bot, tenant._id, 111, fromUser, agentGroupId);
    expect(c2.status).toBe("open");
    expect(bot.api.reopenForumTopic).toHaveBeenCalledWith(agentGroupId, 999);
    expect(bot.api.editForumTopic).toHaveBeenCalledWith(agentGroupId, 999, { name: "Alex-1" });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      agentGroupId,
      expect.stringContaining("conversation reopened"),
      { message_thread_id: 999 }
    );
  });

  it("does not reopen blocked conversations", async () => {
    const fromUser = { first_name: "Alex" };
    const c1 = await getOrCreateCustomer(bot, tenant._id, 111, fromUser, agentGroupId);

    c1.status = "blocked";
    await c1.save();

    const c2 = await getOrCreateCustomer(bot, tenant._id, 111, fromUser, agentGroupId);
    expect(c2.status).toBe("blocked");
    expect(bot.api.reopenForumTopic).not.toHaveBeenCalled();
  });

  it("handles reopen topic API failure gracefully", async () => {
    const fromUser = { first_name: "Alex" };
    const c1 = await getOrCreateCustomer(bot, tenant._id, 111, fromUser, agentGroupId);
    c1.status = "closed";
    await c1.save();

    bot.api.reopenForumTopic.mockRejectedValueOnce(new Error("API error"));

    // Should not throw
    const c2 = await getOrCreateCustomer(bot, tenant._id, 111, fromUser, agentGroupId);
    expect(c2.status).toBe("open");
  });

  it("updates profile fields when they change", async () => {
    // Create customer without a threadId first (simulating partial creation)
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 222,
      alias: "Old-1",
      firstName: "OldName",
    });

    const fromUser = { first_name: "NewName", last_name: "NewLast", username: "newuser" };
    const customer = await getOrCreateCustomer(bot, tenant._id, 222, fromUser, agentGroupId);

    expect(customer.firstName).toBe("NewName");
    expect(customer.lastName).toBe("NewLast");
    expect(customer.username).toBe("newuser");
  });

  it("supports web source option", async () => {
    const fromUser = { first_name: "WebUser" };
    const customer = await getOrCreateCustomer(
      bot, tenant._id, 333, fromUser, agentGroupId,
      { source: "web", externalUserId: "ext-1" }
    );
    expect(customer.source).toBe("web");
    expect(customer.externalUserId).toBe("ext-1");
  });

  it("uses 'User' prefix when firstName is missing", async () => {
    const customer = await getOrCreateCustomer(bot, tenant._id, 444, {}, agentGroupId);
    expect(customer.alias).toBe("User-1");
  });
});

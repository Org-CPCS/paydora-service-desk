const { setupTestDb, clearTestDb, teardownTestDb, createMockBot } = require("../setup");
const { getOrCreateCustomer } = require("../../src/relay/get-or-create-customer");
const Customer = require("../../src/db/models/customer");
const Tenant = require("../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("getOrCreateCustomer botToken tracking", () => {
  let tenant, bot;
  const agentGroupId = -1001234;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId });
    bot = createMockBot();
  });

  it("stores lastBotToken on new customer", async () => {
    const customer = await getOrCreateCustomer(
      bot, tenant._id, 111, { first_name: "Alex" }, agentGroupId,
      { botToken: "tok-a" }
    );
    expect(customer.lastBotToken).toBe("tok-a");
  });

  it("updates lastBotToken when customer messages a different bot", async () => {
    // First message via bot A
    const c1 = await getOrCreateCustomer(
      bot, tenant._id, 111, { first_name: "Alex" }, agentGroupId,
      { botToken: "tok-a" }
    );
    expect(c1.lastBotToken).toBe("tok-a");

    // Second message via bot B
    bot.api.createForumTopic.mockClear();
    const c2 = await getOrCreateCustomer(
      bot, tenant._id, 111, { first_name: "Alex" }, agentGroupId,
      { botToken: "tok-b" }
    );
    expect(c2.lastBotToken).toBe("tok-b");
    // Should NOT create a new topic
    expect(bot.api.createForumTopic).not.toHaveBeenCalled();
  });

  it("does not overwrite lastBotToken when same bot messages again", async () => {
    const c1 = await getOrCreateCustomer(
      bot, tenant._id, 111, { first_name: "Alex" }, agentGroupId,
      { botToken: "tok-a" }
    );

    // Same bot messages again — should not trigger a save just for botToken
    const c2 = await getOrCreateCustomer(
      bot, tenant._id, 111, { first_name: "Alex" }, agentGroupId,
      { botToken: "tok-a" }
    );
    expect(c2.lastBotToken).toBe("tok-a");
  });

  it("works without botToken option (backwards compat)", async () => {
    const customer = await getOrCreateCustomer(
      bot, tenant._id, 111, { first_name: "Alex" }, agentGroupId
    );
    expect(customer.lastBotToken).toBeNull();
  });
});

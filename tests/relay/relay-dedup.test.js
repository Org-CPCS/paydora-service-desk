const { setupTestDb, clearTestDb, teardownTestDb, createMockBot } = require("../setup");
const { relayToCustomer } = require("../../src/relay/relay-to-customer");
const Customer = require("../../src/db/models/customer");
const Tenant = require("../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("relayToCustomer multi-bot deduplication", () => {
  let tenant, bot;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    bot = createMockBot();
  });

  it("relays when botToken matches customer.lastBotToken", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
      threadId: 42,
      lastBotToken: "tok-a",
    });

    await relayToCustomer(bot, tenant._id, 42, { text: "Hello" }, { botToken: "tok-a" });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(111, "Hello");
  });

  it("skips when botToken does NOT match customer.lastBotToken", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
      threadId: 42,
      lastBotToken: "tok-a",
    });

    await relayToCustomer(bot, tenant._id, 42, { text: "Hello" }, { botToken: "tok-b" });
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("relays when customer has no lastBotToken (legacy)", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
      threadId: 42,
      // no lastBotToken
    });

    await relayToCustomer(bot, tenant._id, 42, { text: "Hello" }, { botToken: "tok-a" });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(111, "Hello");
  });

  it("relays when no botToken option is passed (legacy single-bot)", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "User-1",
      threadId: 42,
      lastBotToken: "tok-a",
    });

    await relayToCustomer(bot, tenant._id, 42, { text: "Hello" });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(111, "Hello");
  });
});

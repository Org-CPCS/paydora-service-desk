const { setupTestDb, clearTestDb, teardownTestDb, createMockBot } = require("../setup");
const { relayToCustomer } = require("../../src/relay/relay-to-customer");
const { relayToAgents } = require("../../src/relay/relay-to-agents");
const Customer = require("../../src/db/models/customer");
const Tenant = require("../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("Multi-bot dedup — relayToCustomer", () => {
  let tenant;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "bot-a-token", agentGroupId: -100 });
  });

  it("primary bot relays to Telegram customer", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "Alice-1",
      threadId: 42,
      lastBotToken: "bot-a-token",
    });

    const bot = createMockBot();
    await relayToCustomer(bot, tenant._id, 42, { text: "Reply from staff" }, { botToken: "bot-a-token" });

    expect(bot.api.sendMessage).toHaveBeenCalledWith(111, "Reply from staff");
  });

  it("non-primary bot does NOT relay to Telegram customer", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "Alice-1",
      threadId: 42,
      lastBotToken: "bot-a-token",
    });

    const bot = createMockBot();
    await relayToCustomer(bot, tenant._id, 42, { text: "Reply from staff" }, { botToken: "bot-b-token" });

    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("primary bot relays to web customer via webhook", async () => {
    process.env.CHAT_WEBHOOK_URL = "https://example.com/webhook";
    process.env.CHAT_WEBHOOK_SECRET = "secret123";

    // Mock fetch globally
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 222,
      alias: "WebUser-5",
      threadId: 55,
      lastBotToken: "bot-a-token",
      source: "web",
      externalUserId: "ext-123",
    });

    const bot = createMockBot();
    await relayToCustomer(bot, tenant._id, 55, { text: "Staff reply" }, { botToken: "bot-a-token" });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/webhook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-webhook-secret": "secret123",
        }),
      })
    );

    // Verify payload
    const callBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(callBody.customerAlias).toBe("WebUser-5");
    expect(callBody.text).toBe("Staff reply");
    expect(callBody.contentType).toBe("text");

    global.fetch = originalFetch;
    delete process.env.CHAT_WEBHOOK_URL;
    delete process.env.CHAT_WEBHOOK_SECRET;
  });

  it("non-primary bot does NOT relay to web customer", async () => {
    process.env.CHAT_WEBHOOK_URL = "https://example.com/webhook";
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 222,
      alias: "WebUser-5",
      threadId: 55,
      lastBotToken: "bot-a-token",
      source: "web",
      externalUserId: "ext-123",
    });

    const bot = createMockBot();
    await relayToCustomer(bot, tenant._id, 55, { text: "Staff reply" }, { botToken: "bot-b-token" });

    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = originalFetch;
    delete process.env.CHAT_WEBHOOK_URL;
  });

  it("no customer found for threadId returns silently", async () => {
    const bot = createMockBot();
    await relayToCustomer(bot, tenant._id, 9999, { text: "Hello" }, { botToken: "bot-a-token" });

    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("legacy customer without lastBotToken — any bot can relay", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 333,
      alias: "Legacy-1",
      threadId: 77,
      // no lastBotToken
    });

    const bot = createMockBot();
    await relayToCustomer(bot, tenant._id, 77, { text: "Hello" }, { botToken: "any-bot-token" });

    expect(bot.api.sendMessage).toHaveBeenCalledWith(333, "Hello");
  });
});

describe("Multi-bot dedup — relayToAgents bot switch", () => {
  let tenant;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "bot-a-token", agentGroupId: -100 });
  });

  it("customer switching bots gets threadId used by the new bot", async () => {
    // Customer was originally on bot-a
    const customer = await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 444,
      alias: "Switcher-1",
      threadId: 80,
      lastBotToken: "bot-a-token",
    });

    // Now relaying through bot-b (which would have already updated lastBotToken in getOrCreateCustomer)
    customer.lastBotToken = "bot-b-token";

    const bot = createMockBot();
    const msg = { text: "Hi from new bot", from: { id: 444 } };
    await relayToAgents(bot, customer, msg, -100);

    // Should relay normally to the same thread
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      -100,
      "Switcher-1:\nHi from new bot",
      { message_thread_id: 80 }
    );
  });
});

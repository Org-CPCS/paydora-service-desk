const { setupTestDb, clearTestDb, teardownTestDb, createMockBot } = require("../setup");
const { relayToCustomer } = require("../../src/relay/relay-to-customer");
const Customer = require("../../src/db/models/customer");
const Tenant = require("../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("relayToCustomer", () => {
  let tenant, bot;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    bot = createMockBot();
  });

  it("does nothing if no customer found for threadId", async () => {
    await relayToCustomer(bot, tenant._id, 999, { text: "hi" });
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  describe("Telegram customers", () => {
    let customer;

    beforeEach(async () => {
      customer = await Customer.create({
        tenantId: tenant._id,
        telegramUserId: 12345,
        alias: "User-1",
        threadId: 42,
      });
    });

    it("relays text messages", async () => {
      await relayToCustomer(bot, tenant._id, 42, { text: "Hello from agent" });
      expect(bot.api.sendMessage).toHaveBeenCalledWith(12345, "Hello from agent");
    });

    it("relays photos", async () => {
      const msg = {
        photo: [{ file_id: "p1", width: 100 }, { file_id: "p2", width: 800 }],
        caption: "Check this",
      };
      await relayToCustomer(bot, tenant._id, 42, msg);
      expect(bot.api.sendPhoto).toHaveBeenCalledWith(12345, "p2", { caption: "Check this" });
    });

    it("relays documents", async () => {
      const msg = { document: { file_id: "d1" }, caption: "A file" };
      await relayToCustomer(bot, tenant._id, 42, msg);
      expect(bot.api.sendDocument).toHaveBeenCalledWith(12345, "d1", { caption: "A file" });
    });

    it("relays voice messages", async () => {
      const msg = { voice: { file_id: "v1" } };
      await relayToCustomer(bot, tenant._id, 42, msg);
      expect(bot.api.sendVoice).toHaveBeenCalledWith(12345, "v1");
    });

    it("relays video messages", async () => {
      const msg = { video: { file_id: "vid1" }, caption: "Video" };
      await relayToCustomer(bot, tenant._id, 42, msg);
      expect(bot.api.sendVideo).toHaveBeenCalledWith(12345, "vid1", { caption: "Video" });
    });

    it("relays stickers", async () => {
      const msg = { sticker: { file_id: "stk1" } };
      await relayToCustomer(bot, tenant._id, 42, msg);
      expect(bot.api.sendSticker).toHaveBeenCalledWith(12345, "stk1");
    });

    it("notifies agents when customer blocked the bot", async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error("403 Forbidden: bot was blocked by the user"));
      await relayToCustomer(bot, tenant._id, 42, { text: "hi" });
      // Second call should be the notification to agents
      expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
      expect(bot.api.sendMessage.mock.calls[1][1]).toContain("blocked the bot");
      expect(bot.api.sendMessage.mock.calls[1][2]).toEqual({ message_thread_id: 42 });
    });

    it("rethrows non-blocked errors", async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error("500 Internal Server Error"));
      await expect(
        relayToCustomer(bot, tenant._id, 42, { text: "hi" })
      ).rejects.toThrow("500 Internal Server Error");
    });
  });

  describe("Web customers", () => {
    let customer;
    const originalEnv = {};

    beforeEach(async () => {
      customer = await Customer.create({
        tenantId: tenant._id,
        telegramUserId: 99999,
        alias: "Web-1",
        threadId: 50,
        source: "web",
        externalUserId: "ext-abc",
      });
      originalEnv.CHAT_WEBHOOK_URL = process.env.CHAT_WEBHOOK_URL;
      originalEnv.CHAT_WEBHOOK_SECRET = process.env.CHAT_WEBHOOK_SECRET;
    });

    afterEach(() => {
      process.env.CHAT_WEBHOOK_URL = originalEnv.CHAT_WEBHOOK_URL || "";
      process.env.CHAT_WEBHOOK_SECRET = originalEnv.CHAT_WEBHOOK_SECRET || "";
      if (global.fetch.mockRestore) global.fetch.mockRestore();
    });

    it("does not send Telegram DM for web customers", async () => {
      process.env.CHAT_WEBHOOK_URL = "https://example.com/webhook";
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      await relayToCustomer(bot, tenant._id, 50, { text: "Agent reply" });
      // Should NOT call bot.api.sendMessage for the customer
      expect(bot.api.sendMessage).not.toHaveBeenCalled();
    });

    it("sends webhook POST with correct payload for text", async () => {
      process.env.CHAT_WEBHOOK_URL = "https://example.com/webhook";
      process.env.CHAT_WEBHOOK_SECRET = "secret123";
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      await relayToCustomer(bot, tenant._id, 50, { text: "Hello web user" });

      expect(global.fetch).toHaveBeenCalledWith("https://example.com/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": "secret123",
        },
        body: JSON.stringify({
          tenantId: tenant._id.toString(),
          customerAlias: "Web-1",
          text: "Hello web user",
          telegramFileId: null,
          contentType: "text",
        }),
      });
    });

    it("sends webhook POST with photo data", async () => {
      process.env.CHAT_WEBHOOK_URL = "https://example.com/webhook";
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const msg = {
        photo: [{ file_id: "small" }, { file_id: "large" }],
        caption: "A photo",
      };
      await relayToCustomer(bot, tenant._id, 50, msg);

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.telegramFileId).toBe("large");
      expect(body.contentType).toBe("image");
      expect(body.text).toBe("A photo");
    });

    it("handles missing CHAT_WEBHOOK_URL gracefully", async () => {
      delete process.env.CHAT_WEBHOOK_URL;
      process.env.CHAT_WEBHOOK_URL = "";
      // Should not throw
      await relayToCustomer(bot, tenant._id, 50, { text: "hi" });
      expect(bot.api.sendMessage).not.toHaveBeenCalled();
    });

    it("handles webhook POST failure gracefully", async () => {
      process.env.CHAT_WEBHOOK_URL = "https://example.com/webhook";
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });

      // Should not throw
      await relayToCustomer(bot, tenant._id, 50, { text: "hi" });
    });

    it("handles webhook network error gracefully", async () => {
      process.env.CHAT_WEBHOOK_URL = "https://example.com/webhook";
      global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

      // Should not throw
      await relayToCustomer(bot, tenant._id, 50, { text: "hi" });
    });
  });
});

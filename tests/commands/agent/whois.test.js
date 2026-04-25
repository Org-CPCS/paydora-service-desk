const { setupTestDb, clearTestDb, teardownTestDb, createMockCtx, createMockBot } = require("../../setup");
const { handleWhois } = require("../../../src/commands/agent/whois");
const Customer = require("../../../src/db/models/customer");
const Tenant = require("../../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("handleWhois", () => {
  let tenant, bot;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId: -100 });
    bot = createMockBot();
  });

  it("sends customer info via DM to the requesting admin", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 12345,
      alias: "Alex-1",
      threadId: 42,
    });

    bot.api.getChatMember.mockResolvedValue({ status: "administrator" });
    bot.api.getChat.mockResolvedValue({
      first_name: "John",
      last_name: "Doe",
      username: "johndoe",
    });

    const ctx = createMockCtx({ from: { id: 111 } });
    await handleWhois(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 42, bot });

    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      111,
      expect.stringContaining("John Doe")
    );
    expect(bot.api.sendMessage.mock.calls[0][1]).toContain("@johndoe");
    expect(bot.api.sendMessage.mock.calls[0][1]).toContain("12345");
    expect(ctx.reply).toHaveBeenCalledWith("✅ Customer info sent to your DM.", { message_thread_id: 42 });
  });

  it("rejects non-admin users", async () => {
    bot.api.getChatMember.mockResolvedValue({ status: "member" });

    const ctx = createMockCtx({ from: { id: 111 } });
    await handleWhois(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 42, bot });

    expect(ctx.reply).toHaveBeenCalledWith("⛔ Only admins can use /whois.", { message_thread_id: 42 });
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("reports if no customer found for topic", async () => {
    bot.api.getChatMember.mockResolvedValue({ status: "administrator" });

    const ctx = createMockCtx({ from: { id: 111 } });
    await handleWhois(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 999, bot });

    expect(ctx.reply).toHaveBeenCalledWith("❓ No customer found for this topic.", { message_thread_id: 999 });
  });

  it("handles DM send failure gracefully", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 12345,
      alias: "Alex-1",
      threadId: 42,
    });

    bot.api.getChatMember.mockResolvedValue({ status: "administrator" });
    bot.api.getChat.mockResolvedValue({ first_name: "John" });
    bot.api.sendMessage.mockRejectedValueOnce(new Error("403 Forbidden"));

    const ctx = createMockCtx({ from: { id: 111 }, me: { username: "testbot" } });
    await handleWhois(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 42, bot });

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't send DM"),
      { message_thread_id: 42 }
    );
  });

  it("handles user without username", async () => {
    await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 12345,
      alias: "Alex-1",
      threadId: 42,
    });

    bot.api.getChatMember.mockResolvedValue({ status: "creator" });
    bot.api.getChat.mockResolvedValue({ first_name: "John" });

    const ctx = createMockCtx({ from: { id: 111 } });
    await handleWhois(ctx, { tenantId: tenant._id, agentGroupId: -100, threadId: 42, bot });

    expect(bot.api.sendMessage.mock.calls[0][1]).toContain("no username");
  });
});

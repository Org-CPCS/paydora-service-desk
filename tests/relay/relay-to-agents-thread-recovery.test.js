const { setupTestDb, clearTestDb, teardownTestDb, createMockBot } = require("../setup");
const { relayToAgents } = require("../../src/relay/relay-to-agents");
const Customer = require("../../src/db/models/customer");
const Tenant = require("../../src/db/models/tenant");

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

describe("relayToAgents — thread not found recovery", () => {
  let tenant;
  const agentGroupId = -1001234;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: "tok1", agentGroupId });
  });

  it("recreates the topic and retries when thread not found", async () => {
    const customer = await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 111,
      alias: "Deleted-Thread-1",
      threadId: 42,
    });

    const bot = createMockBot();
    // First sendMessage call fails with "message thread not found"
    // Subsequent calls succeed (including the retry after topic creation)
    bot.api.sendMessage
      .mockRejectedValueOnce(new Error("400: Bad Request: message thread not found"))
      .mockResolvedValue({ message_id: 10 });

    // createForumTopic returns the new thread ID
    bot.api.createForumTopic.mockResolvedValue({ message_thread_id: 999 });

    const msg = { text: "Hello", from: { id: 111 } };
    await relayToAgents(bot, customer, msg, agentGroupId);

    // Should have tried to create a new topic
    expect(bot.api.createForumTopic).toHaveBeenCalledWith(agentGroupId, "Deleted-Thread-1");

    // Should have retried send with the new thread ID
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
    expect(bot.api.sendMessage).toHaveBeenLastCalledWith(
      agentGroupId,
      "Deleted-Thread-1:\nHello",
      { message_thread_id: 999 }
    );

    // Customer record should be updated in the DB
    const updated = await Customer.findById(customer._id);
    expect(updated.threadId).toBe(999);
  });

  it("does not recreate topic for other errors", async () => {
    const customer = await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 222,
      alias: "Other-Error-1",
      threadId: 50,
    });

    const bot = createMockBot();
    bot.api.sendMessage.mockRejectedValue(new Error("400: Bad Request: chat not found"));

    const msg = { text: "Hello", from: { id: 222 } };
    await relayToAgents(bot, customer, msg, agentGroupId);

    // Should NOT create a new topic
    expect(bot.api.createForumTopic).not.toHaveBeenCalled();

    // Customer threadId should be unchanged
    const updated = await Customer.findById(customer._id);
    expect(updated.threadId).toBe(50);
  });

  it("handles photo messages in thread recovery", async () => {
    const customer = await Customer.create({
      tenantId: tenant._id,
      telegramUserId: 333,
      alias: "Photo-User-1",
      threadId: 60,
    });

    const bot = createMockBot();
    bot.api.sendPhoto
      .mockRejectedValueOnce(new Error("400: Bad Request: message thread not found"))
      .mockResolvedValue({ message_id: 10 });
    bot.api.createForumTopic.mockResolvedValue({ message_thread_id: 888 });

    const msg = {
      photo: [{ file_id: "small", width: 100 }, { file_id: "large", width: 800 }],
      caption: "Look",
      from: { id: 333 },
    };
    await relayToAgents(bot, customer, msg, agentGroupId);

    expect(bot.api.createForumTopic).toHaveBeenCalledWith(agentGroupId, "Photo-User-1");
    expect(bot.api.sendPhoto).toHaveBeenCalledTimes(2);
    expect(bot.api.sendPhoto).toHaveBeenLastCalledWith(agentGroupId, "large", {
      message_thread_id: 888,
      caption: "Photo-User-1:\nLook",
    });
  });
});

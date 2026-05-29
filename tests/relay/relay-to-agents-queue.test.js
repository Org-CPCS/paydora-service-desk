const { createMockBot } = require("../setup");
const { relayToAgents } = require("../../src/relay/relay-to-agents");

describe("relayToAgents with message queue", () => {
  let bot;
  const customer = { alias: "Player-1", threadId: 77 };
  const agentGroupId = -1009999;

  beforeEach(() => {
    bot = createMockBot();
  });

  it("does not throw when the send fails", async () => {
    bot.api.sendMessage.mockRejectedValue(new Error("500 Internal Server Error"));
    // Should not throw — queue catches errors
    await relayToAgents(bot, customer, { text: "hello", from: { id: 1 } }, agentGroupId);
  });

  it("still sends messages correctly through the queue", async () => {
    await relayToAgents(bot, customer, { text: "test msg", from: { id: 1 } }, agentGroupId);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      agentGroupId,
      "Player-1:\ntest msg",
      { message_thread_id: 77 }
    );
  });

  it("handles multiple rapid messages in order", async () => {
    const messages = [];
    bot.api.sendMessage.mockImplementation(async (chatId, text, opts) => {
      messages.push(text);
      return { message_id: messages.length };
    });

    await Promise.all([
      relayToAgents(bot, customer, { text: "first", from: { id: 1 } }, agentGroupId),
      relayToAgents(bot, customer, { text: "second", from: { id: 1 } }, agentGroupId),
      relayToAgents(bot, customer, { text: "third", from: { id: 1 } }, agentGroupId),
    ]);

    expect(messages).toEqual([
      "Player-1:\nfirst",
      "Player-1:\nsecond",
      "Player-1:\nthird",
    ]);
  });

  it("handles photo relay failures gracefully", async () => {
    bot.api.sendPhoto.mockRejectedValue(new Error("403: Forbidden"));
    const msg = {
      photo: [{ file_id: "pic1", width: 800 }],
      caption: "look",
      from: { id: 1 },
    };
    // Should not throw
    await relayToAgents(bot, customer, msg, agentGroupId);
  });
});

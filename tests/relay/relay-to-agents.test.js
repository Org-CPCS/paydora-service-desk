const { createMockBot } = require("../setup");
const { relayToAgents } = require("../../src/relay/relay-to-agents");

describe("relayToAgents", () => {
  let bot;
  const customer = { alias: "Alex-1", threadId: 42 };
  const agentGroupId = -1001234;

  beforeEach(() => {
    bot = createMockBot();
  });

  it("relays text messages with alias prefix", async () => {
    const msg = { text: "Hello, I need help", from: { id: 1 } };
    await relayToAgents(bot, customer, msg, agentGroupId);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      agentGroupId,
      "Alex-1:\nHello, I need help",
      { message_thread_id: 42 }
    );
  });

  it("relays photos with caption", async () => {
    const msg = {
      photo: [
        { file_id: "small", width: 100 },
        { file_id: "large", width: 800 },
      ],
      caption: "Look at this",
      from: { id: 1 },
    };
    await relayToAgents(bot, customer, msg, agentGroupId);
    expect(bot.api.sendPhoto).toHaveBeenCalledWith(agentGroupId, "large", {
      message_thread_id: 42,
      caption: "Alex-1:\nLook at this",
    });
  });

  it("relays photos without caption", async () => {
    const msg = {
      photo: [{ file_id: "photo1", width: 800 }],
      from: { id: 1 },
    };
    await relayToAgents(bot, customer, msg, agentGroupId);
    expect(bot.api.sendPhoto).toHaveBeenCalledWith(agentGroupId, "photo1", {
      message_thread_id: 42,
      caption: "Alex-1:\n",
    });
  });

  it("relays documents", async () => {
    const msg = {
      document: { file_id: "doc1" },
      caption: "My file",
      from: { id: 1 },
    };
    await relayToAgents(bot, customer, msg, agentGroupId);
    expect(bot.api.sendDocument).toHaveBeenCalledWith(agentGroupId, "doc1", {
      message_thread_id: 42,
      caption: "Alex-1:\nMy file",
    });
  });

  it("relays voice messages", async () => {
    const msg = { voice: { file_id: "voice1" }, from: { id: 1 } };
    await relayToAgents(bot, customer, msg, agentGroupId);
    expect(bot.api.sendVoice).toHaveBeenCalledWith(agentGroupId, "voice1", {
      message_thread_id: 42,
      caption: "Alex-1:\n",
    });
  });

  it("relays video messages", async () => {
    const msg = {
      video: { file_id: "vid1" },
      caption: "Watch this",
      from: { id: 1 },
    };
    await relayToAgents(bot, customer, msg, agentGroupId);
    expect(bot.api.sendVideo).toHaveBeenCalledWith(agentGroupId, "vid1", {
      message_thread_id: 42,
      caption: "Alex-1:\nWatch this",
    });
  });

  it("relays stickers as text placeholder", async () => {
    const msg = { sticker: { file_id: "stk1" }, from: { id: 1 } };
    await relayToAgents(bot, customer, msg, agentGroupId);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      agentGroupId,
      "Alex-1:\n[sticker]",
      { message_thread_id: 42 }
    );
  });

  it("relays contacts", async () => {
    const msg = {
      contact: { first_name: "Jane", phone_number: "+1234567890" },
      from: { id: 1 },
    };
    await relayToAgents(bot, customer, msg, agentGroupId);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      agentGroupId,
      "Alex-1:\n[contact: Jane +1234567890]",
      { message_thread_id: 42 }
    );
  });

  it("relays locations", async () => {
    const msg = {
      location: { latitude: 40.7128, longitude: -74.006 },
      from: { id: 1 },
    };
    await relayToAgents(bot, customer, msg, agentGroupId);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      agentGroupId,
      "Alex-1:\n[location: 40.7128, -74.006]",
      { message_thread_id: 42 }
    );
  });

  it("handles unsupported message types", async () => {
    const msg = { from: { id: 1 } }; // no text, photo, etc.
    await relayToAgents(bot, customer, msg, agentGroupId);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      agentGroupId,
      "Alex-1:\n[unsupported message type]",
      { message_thread_id: 42 }
    );
  });
});

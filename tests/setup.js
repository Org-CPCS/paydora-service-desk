const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

/**
 * Connect to an in-memory MongoDB instance for testing.
 */
async function setupTestDb() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}

/**
 * Drop all collections between tests.
 */
async function clearTestDb() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

/**
 * Disconnect and stop the in-memory MongoDB.
 */
async function teardownTestDb() {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
}

/**
 * Create a mock grammY bot API object.
 * Every API method is a jest.fn() that resolves to a sensible default.
 */
function createMockBot() {
  const api = {
    sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
    sendPhoto: jest.fn().mockResolvedValue({ message_id: 2 }),
    sendDocument: jest.fn().mockResolvedValue({ message_id: 3 }),
    sendVoice: jest.fn().mockResolvedValue({ message_id: 4 }),
    sendVideo: jest.fn().mockResolvedValue({ message_id: 5 }),
    sendSticker: jest.fn().mockResolvedValue({ message_id: 6 }),
    createForumTopic: jest.fn().mockResolvedValue({ message_thread_id: 999 }),
    editForumTopic: jest.fn().mockResolvedValue(true),
    closeForumTopic: jest.fn().mockResolvedValue(true),
    reopenForumTopic: jest.fn().mockResolvedValue(true),
    getChatMember: jest.fn().mockResolvedValue({ status: "administrator" }),
    getChat: jest.fn().mockResolvedValue({ first_name: "John", last_name: "Doe", username: "johndoe" }),
    promoteChatMember: jest.fn().mockResolvedValue(true),
    setChatAdministratorCustomTitle: jest.fn().mockResolvedValue(true),
    getChatAdministrators: jest.fn().mockResolvedValue([]),
    setChatTitle: jest.fn().mockResolvedValue(true),
    createChatInviteLink: jest.fn().mockResolvedValue({ invite_link: "https://t.me/+abc123" }),
    unbanChatMember: jest.fn().mockResolvedValue(true),
    getMe: jest.fn().mockResolvedValue({ id: 100, username: "testbot" }),
  };
  return { api };
}

/**
 * Create a mock grammY context object for message handlers.
 */
function createMockCtx(overrides = {}) {
  const ctx = {
    reply: jest.fn().mockResolvedValue({ message_id: 1 }),
    api: {
      editForumTopic: jest.fn().mockResolvedValue(true),
      closeForumTopic: jest.fn().mockResolvedValue(true),
      reopenForumTopic: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
    },
    from: { id: 111, username: "agent1", first_name: "Agent" },
    me: { username: "testbot" },
    message: { text: "" },
    match: "",
    answerCallbackQuery: jest.fn().mockResolvedValue(true),
    editMessageText: jest.fn().mockResolvedValue(true),
    callbackQuery: { data: "" },
    ...overrides,
  };
  return ctx;
}

module.exports = {
  setupTestDb,
  clearTestDb,
  teardownTestDb,
  createMockBot,
  createMockCtx,
};

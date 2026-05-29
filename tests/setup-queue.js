// Disable message queue delays for fast tests
const { messageQueue } = require("../src/relay/message-queue");
messageQueue.perChatIntervalMs = 0;

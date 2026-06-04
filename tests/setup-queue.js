// Disable message queue delays for fast tests
const { messageQueue } = require("../src/relay/message-queue");
messageQueue.perChatIntervalMs = 0;
messageQueue.retryBaseMs = 0;

// Silence all console output in tests (remove noise)
// Restore with --verbose flag if needed for debugging
if (!process.env.VERBOSE_TESTS) {
  global.console.log = jest.fn();
  global.console.warn = jest.fn();
  global.console.error = jest.fn();
}

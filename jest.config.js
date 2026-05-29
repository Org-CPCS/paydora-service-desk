module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  // Increase timeout for mongodb-memory-server startup
  testTimeout: 30000,
  // Run test files sequentially to avoid MongoDB conflicts
  maxWorkers: 1,
  // Disable message queue delays in tests
  setupFiles: ["./tests/setup-queue.js"],
};

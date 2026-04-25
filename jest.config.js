module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  // Increase timeout for mongodb-memory-server startup
  testTimeout: 30000,
  // Run test files sequentially to avoid MongoDB conflicts
  maxWorkers: 1,
};

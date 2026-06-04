const { setupTestDb, clearTestDb, teardownTestDb } = require("../setup");
const { BotManager } = require("../../src/bots/bot-manager");
const Tenant = require("../../src/db/models/tenant");
const TenantBot = require("../../src/db/models/tenant-bot");

// Mock createSubBot to return a controllable fake bot
jest.mock("../../src/bots/create-sub-bot", () => ({
  createSubBot: jest.fn(),
}));
const { createSubBot } = require("../../src/bots/create-sub-bot");

beforeAll(async () => await setupTestDb());
afterEach(async () => {
  await clearTestDb();
  jest.clearAllMocks();
});
afterAll(async () => await teardownTestDb());

/**
 * Creates a fake bot that captures the error handler for manual triggering.
 */
function createFakeBot() {
  let errorHandler = null;
  const bot = {
    api: {
      config: { use: jest.fn() },
      getMe: jest.fn().mockResolvedValue({ id: 123, username: "testbot" }),
    },
    use: jest.fn(),
    on: jest.fn(),
    callbackQuery: jest.fn(),
    catch: jest.fn((handler) => { errorHandler = handler; }),
    start: jest.fn(({ onStart } = {}) => { if (onStart) onStart(); }),
    stop: jest.fn().mockResolvedValue(undefined),
  };
  return { bot, getErrorHandler: () => errorHandler };
}

describe("BotManager error handling", () => {
  let botManager;

  beforeEach(() => {
    botManager = new BotManager();
  });

  it("does not restart on 403 Forbidden errors", async () => {
    const { bot, getErrorHandler } = createFakeBot();
    createSubBot.mockReturnValue(bot);

    const tenant = await Tenant.create({
      botToken: "tok-403",
      agentGroupId: -100,
      status: "active",
    });

    await botManager.startBot(tenant, "tok-403");
    expect(botManager.bots.size).toBe(1);

    // Trigger a 403 error
    const handler = getErrorHandler();
    await handler(new Error("403: Forbidden: bot was blocked by the user"));

    // Bot should NOT have been stopped/restarted
    expect(bot.stop).not.toHaveBeenCalled();
    // Still running
    expect(botManager.bots.size).toBe(1);
  });

  it("does not restart on 400 Bad Request errors", async () => {
    const { bot, getErrorHandler } = createFakeBot();
    createSubBot.mockReturnValue(bot);

    const tenant = await Tenant.create({
      botToken: "tok-400",
      agentGroupId: -100,
      status: "active",
    });

    await botManager.startBot(tenant, "tok-400");

    const handler = getErrorHandler();
    await handler(new Error("400: Bad Request: message thread not found"));

    expect(bot.stop).not.toHaveBeenCalled();
    expect(botManager.bots.size).toBe(1);
  });

  it("does not restart on 429 Too Many Requests errors", async () => {
    const { bot, getErrorHandler } = createFakeBot();
    createSubBot.mockReturnValue(bot);

    const tenant = await Tenant.create({
      botToken: "tok-429",
      agentGroupId: -100,
      status: "active",
    });

    await botManager.startBot(tenant, "tok-429");

    const handler = getErrorHandler();
    await handler(new Error("429: Too Many Requests: retry after 15"));

    expect(bot.stop).not.toHaveBeenCalled();
    expect(botManager.bots.size).toBe(1);
  });

  it("restarts on truly fatal errors (network failures)", async () => {
    const fakes = [];
    createSubBot.mockImplementation(() => {
      const { bot } = createFakeBot();
      fakes.push(bot);
      return bot;
    });

    const tenant = await Tenant.create({
      botToken: "tok-fatal",
      agentGroupId: -100,
      status: "active",
    });

    await botManager.startBot(tenant, "tok-fatal");
    const firstBot = fakes[0];

    // Trigger a fatal network error — don't await (has internal 5s delay)
    const handler = firstBot.catch.mock.calls[0][0];
    handler(new Error("HttpError: Network request for 'getUpdates' failed!"));

    // Give it a tick to call stop (stop is called before the 5s delay for restart)
    await new Promise((r) => setImmediate(r));

    // Should have stopped the first bot
    expect(firstBot.stop).toHaveBeenCalled();
  });

  it("prevents duplicate restarts with isRestarting flag", async () => {
    const fakes = [];
    createSubBot.mockImplementation(() => {
      const { bot } = createFakeBot();
      fakes.push(bot);
      return bot;
    });

    const tenant = await Tenant.create({
      botToken: "tok-dedup",
      agentGroupId: -100,
      status: "active",
    });

    await botManager.startBot(tenant, "tok-dedup");
    const firstBot = fakes[0];
    const handler = firstBot.catch.mock.calls[0][0];

    // Trigger two fatal errors simultaneously — don't await
    handler(new Error("HttpError: Network request failed!"));
    handler(new Error("HttpError: Another network failure!"));

    // Give a tick for the first handler to set isRestarting and call stop
    await new Promise((r) => setImmediate(r));

    // stop should only be called once (second error skipped due to isRestarting)
    expect(firstBot.stop).toHaveBeenCalledTimes(1);
  });
});

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
 * Creates a fake bot that captures the error handler for manual triggering,
 * and lets a test end the long-polling promise on demand.
 */
function createFakeBot() {
  let errorHandler = null;
  let failPolling;
  let endPolling;
  // Mirrors grammY: start() resolves when polling stops, rejects when it dies.
  const polling = new Promise((resolve, reject) => {
    endPolling = resolve;
    failPolling = reject;
  });
  const bot = {
    api: {
      config: { use: jest.fn() },
      getMe: jest.fn().mockResolvedValue({ id: 123, username: "testbot" }),
    },
    use: jest.fn(),
    on: jest.fn(),
    callbackQuery: jest.fn(),
    catch: jest.fn((handler) => { errorHandler = handler; }),
    start: jest.fn(({ onStart } = {}) => { if (onStart) onStart(); return polling; }),
    stop: jest.fn().mockResolvedValue(undefined),
  };
  return {
    bot,
    getErrorHandler: () => errorHandler,
    failPolling: (err) => failPolling(err),
    endPolling: () => endPolling(),
  };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("BotManager error handling", () => {
  let botManager;

  beforeEach(() => {
    botManager = new BotManager();
  });

  afterEach(() => {
    // Cancel any backoff timers a test left pending.
    botManager._shuttingDown = true;
    for (const key of [...botManager._restartTimers.keys()]) {
      botManager._cancelPendingRestart(key);
    }
  });

  // Errors reaching bot.catch are per-update failures. Restarting the whole
  // bot cannot fix them — doing so is what produced 62k restarts in prod.
  it.each([
    ["403 Forbidden", "403: Forbidden: bot was blocked by the user"],
    ["400 Bad Request", "400: Bad Request: message thread not found"],
    ["429 Too Many Requests", "429: Too Many Requests: retry after 15"],
    ["Mongo failures", "MongoServerError: bad auth : Authentication failed."],
    ["network failures", "HttpError: Network request for 'sendMessage' failed!"],
  ])("does not restart the bot on %s in an update handler", async (_label, message) => {
    const { bot, getErrorHandler } = createFakeBot();
    createSubBot.mockReturnValue(bot);

    const tenant = await Tenant.create({
      botToken: "tok-handler",
      agentGroupId: -100,
      status: "active",
    });

    await botManager.startBot(tenant, "tok-handler");
    expect(botManager.bots.size).toBe(1);

    await getErrorHandler()(new Error(message));

    expect(bot.stop).not.toHaveBeenCalled();
    expect(botManager.bots.size).toBe(1);
  });

  it("restarts with backoff when long polling dies", async () => {
    const fakes = [];
    createSubBot.mockImplementation(() => {
      const fake = createFakeBot();
      fakes.push(fake);
      return fake.bot;
    });

    const tenant = await Tenant.create({
      botToken: "tok-polling",
      agentGroupId: -100,
      status: "active",
    });

    await botManager.startBot(tenant, "tok-polling");
    const key = botManager._key(tenant._id.toString(), "tok-polling");

    fakes[0].failPolling(
      new Error("Call to 'getUpdates' failed! (409: Conflict: terminated by other getUpdates request)")
    );
    await tick();

    // Dead instance is deregistered and a restart is queued, not run inline.
    expect(botManager.bots.has(key)).toBe(false);
    expect(botManager._restartTimers.has(key)).toBe(true);
  });

  it("backs off exponentially across repeated failures", () => {
    const key = "tenant:tok";
    expect(botManager._nextRestartDelay(key)).toBe(5000);
    expect(botManager._nextRestartDelay(key)).toBe(10000);
    expect(botManager._nextRestartDelay(key)).toBe(20000);
    expect(botManager._nextRestartDelay(key)).toBe(40000);
    // Caps rather than growing without bound.
    for (let i = 0; i < 10; i++) botManager._nextRestartDelay(key);
    expect(botManager._nextRestartDelay(key)).toBe(5 * 60 * 1000);
  });

  it("does not leave a second polling instance alive on concurrent starts", async () => {
    const fakes = [];
    createSubBot.mockImplementation(() => {
      const fake = createFakeBot();
      fakes.push(fake);
      return fake.bot;
    });

    const tenant = await Tenant.create({
      botToken: "tok-race",
      agentGroupId: -100,
      status: "active",
    });

    // Two callers race to start the same token — the exact shape that led to
    // orphaned pollers and 409 Conflict from Telegram.
    await Promise.all([
      botManager.startBot(tenant, "tok-race"),
      botManager.startBot(tenant, "tok-race"),
    ]);

    // Only one entry, and every superseded instance was stopped.
    expect(botManager.bots.size).toBe(1);
    const live = botManager.bots.get(botManager._key(tenant._id.toString(), "tok-race")).bot;
    for (const { bot } of fakes) {
      if (bot !== live) expect(bot.stop).toHaveBeenCalled();
    }
  });

  it("deregisters the bot even when stop() throws", async () => {
    const { bot } = createFakeBot();
    bot.stop.mockRejectedValue(new Error("socket already closed"));
    createSubBot.mockReturnValue(bot);

    const tenant = await Tenant.create({
      botToken: "tok-stopfail",
      agentGroupId: -100,
      status: "active",
    });

    await botManager.startBot(tenant, "tok-stopfail");
    const key = botManager._key(tenant._id.toString(), "tok-stopfail");

    await botManager.stopBotByKey(key);

    // A failed stop must not leave an unreachable entry behind.
    expect(botManager.bots.has(key)).toBe(false);
  });

  it("cancels a pending restart when the tenant is stopped", async () => {
    const fakes = [];
    createSubBot.mockImplementation(() => {
      const fake = createFakeBot();
      fakes.push(fake);
      return fake.bot;
    });

    const tenant = await Tenant.create({
      botToken: "tok-backoff",
      agentGroupId: -100,
      status: "active",
    });
    const tenantId = tenant._id.toString();

    await botManager.startBot(tenant, "tok-backoff");
    const key = botManager._key(tenantId, "tok-backoff");

    fakes[0].failPolling(new Error("HttpError: Network request failed!"));
    await tick();
    expect(botManager._restartTimers.has(key)).toBe(true);

    // The bot is mid-backoff so it is not in `bots` — stopping the tenant
    // must still prevent it from coming back.
    await botManager.stopBot(tenantId);
    expect(botManager._restartTimers.has(key)).toBe(false);
  });

  it("does not restart bots once shutdown has begun", async () => {
    const fakes = [];
    createSubBot.mockImplementation(() => {
      const fake = createFakeBot();
      fakes.push(fake);
      return fake.bot;
    });

    const tenant = await Tenant.create({
      botToken: "tok-shutdown",
      agentGroupId: -100,
      status: "active",
    });

    await botManager.startBot(tenant, "tok-shutdown");
    const key = botManager._key(tenant._id.toString(), "tok-shutdown");

    await botManager.stopAll();
    fakes[0].failPolling(new Error("HttpError: Network request failed!"));
    await tick();

    expect(botManager._restartTimers.has(key)).toBe(false);
    expect(botManager.bots.size).toBe(0);
  });
});

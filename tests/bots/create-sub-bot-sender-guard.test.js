const { setupTestDb, clearTestDb, teardownTestDb } = require("../setup");

// Observe whether the agent-group dispatch was reached without touching the network.
jest.mock("../../src/commands/agent/broadcast", () => ({
  handleBroadcast: jest.fn().mockResolvedValue(undefined),
  handleBroadcastConfirm: jest.fn().mockResolvedValue(undefined),
  handleBroadcastCancel: jest.fn().mockResolvedValue(undefined),
}));

const { handleBroadcast } = require("../../src/commands/agent/broadcast");
const { createSubBot } = require("../../src/bots/create-sub-bot");
const Tenant = require("../../src/db/models/tenant");
const TenantBot = require("../../src/db/models/tenant-bot");

const AGENT_GROUP = -1003788807836;
const TOKEN_A = "111111:AAA-primary";
const TOKEN_B = "222222:BBB-backup";
const ANONYMOUS_ADMIN_ID = 1087968824;

beforeAll(async () => await setupTestDb());
afterEach(async () => await clearTestDb());
afterAll(async () => await teardownTestDb());

/** Build the sub-bot under test with botInfo pre-set so no getMe call is made. */
function buildBot(tenantId) {
  const bot = createSubBot(TOKEN_A, { tenantId, agentGroupId: AGENT_GROUP });
  bot.botInfo = {
    id: 111111,
    is_bot: true,
    first_name: "Primary",
    username: "primary_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  return bot;
}

/** A /broadcastallusers message posted in the group's General topic. */
function broadcastUpdate(from) {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 1700000000,
      chat: { id: AGENT_GROUP, type: "supergroup", title: "Agents", is_forum: true },
      from,
      text: "/broadcastallusers Games are hitting",
      entities: [{ offset: 0, length: 18, type: "bot_command" }],
    },
  };
}

describe("agent group sender guard", () => {
  let tenant;

  beforeEach(async () => {
    tenant = await Tenant.create({ botToken: TOKEN_A, agentGroupId: AGENT_GROUP });
    // Two bots, backup registered first — the arrangement that broke Mirage.
    await TenantBot.create({ tenantId: tenant._id, botToken: TOKEN_A, botUsername: "primary_bot", status: "active" });
    await TenantBot.create({ tenantId: tenant._id, botToken: TOKEN_B, botUsername: "backup_bot", status: "active" });
    handleBroadcast.mockClear();
  });

  it("handles /broadcastallusers from an admin posting anonymously", async () => {
    const bot = buildBot(tenant._id);

    await bot.handleUpdate(
      broadcastUpdate({ id: ANONYMOUS_ADMIN_ID, is_bot: true, first_name: "Group", username: "GroupAnonymousBot" })
    );

    expect(handleBroadcast).toHaveBeenCalledTimes(1);
  });

  it("handles /broadcastallusers from a named agent", async () => {
    const bot = buildBot(tenant._id);

    await bot.handleUpdate(
      broadcastUpdate({ id: 7800860769, is_bot: false, first_name: "Robert", username: "ROBERTGREEN01" })
    );

    expect(handleBroadcast).toHaveBeenCalledTimes(1);
  });

  it("still ignores a sibling bot's own relayed message", async () => {
    const bot = buildBot(tenant._id);

    await bot.handleUpdate(
      broadcastUpdate({ id: 222222, is_bot: true, first_name: "Backup", username: "backup_bot" })
    );

    expect(handleBroadcast).not.toHaveBeenCalled();
  });
});

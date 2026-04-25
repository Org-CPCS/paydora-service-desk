/**
 * Verify that the backwards-compatibility shim files re-export
 * the same interface as the new module locations.
 */

describe("backwards-compatibility shims", () => {
  it("src/db.js re-exports src/db/index.js", () => {
    const shim = require("../src/db");
    const direct = require("../src/db/index");
    expect(Object.keys(shim).sort()).toEqual(Object.keys(direct).sort());
  });

  it("src/relay.js re-exports src/relay/index.js", () => {
    const shim = require("../src/relay");
    const direct = require("../src/relay/index");
    expect(Object.keys(shim).sort()).toEqual(Object.keys(direct).sort());
  });

  it("src/bot-manager.js re-exports src/bots/bot-manager.js", () => {
    const shim = require("../src/bot-manager");
    const direct = require("../src/bots/bot-manager");
    expect(Object.keys(shim).sort()).toEqual(Object.keys(direct).sort());
  });

  it("src/sub-bot.js re-exports src/bots/create-sub-bot.js", () => {
    const shim = require("../src/sub-bot");
    const direct = require("../src/bots/create-sub-bot");
    expect(Object.keys(shim).sort()).toEqual(Object.keys(direct).sort());
  });

  it("src/master.js re-exports src/bots/create-master-bot.js", () => {
    const shim = require("../src/master");
    const direct = require("../src/bots/create-master-bot");
    expect(Object.keys(shim).sort()).toEqual(Object.keys(direct).sort());
  });
});

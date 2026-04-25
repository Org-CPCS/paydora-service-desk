const { createMockCtx } = require("../../setup");
const { handleStart } = require("../../../src/commands/customer/start");

describe("handleStart", () => {
  it("sends a welcome message", async () => {
    const ctx = createMockCtx();
    await handleStart(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("Hey there");
    expect(msg).toContain("/setUsername");
  });
});

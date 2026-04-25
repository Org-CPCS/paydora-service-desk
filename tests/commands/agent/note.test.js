const { createMockCtx } = require("../../setup");
const { handleNote } = require("../../../src/commands/agent/note");

describe("handleNote", () => {
  it("posts the note in the topic thread", async () => {
    const ctx = createMockCtx({ message: { text: "/note This is internal" } });
    await handleNote(ctx, { threadId: 42 });
    expect(ctx.reply).toHaveBeenCalledWith("📝 Note: This is internal", {
      message_thread_id: 42,
    });
  });

  it("handles multi-word notes", async () => {
    const ctx = createMockCtx({ message: { text: "/note Customer seems upset, escalate to manager" } });
    await handleNote(ctx, { threadId: 10 });
    expect(ctx.reply).toHaveBeenCalledWith(
      "📝 Note: Customer seems upset, escalate to manager",
      { message_thread_id: 10 }
    );
  });
});

const { createMockCtx } = require("../../setup");
const { handleRename } = require("../../../src/commands/agent/rename");

describe("handleRename", () => {
  it("renames the topic", async () => {
    const ctx = createMockCtx({ message: { text: "/rename VIP Customer" } });
    await handleRename(ctx, { agentGroupId: -100, threadId: 42 });

    expect(ctx.api.editForumTopic).toHaveBeenCalledWith(-100, 42, { name: "VIP Customer" });
    expect(ctx.reply).toHaveBeenCalledWith(
      '✅ Topic renamed to "VIP Customer".',
      { message_thread_id: 42 }
    );
  });

  it("shows usage when no name provided", async () => {
    const ctx = createMockCtx({ message: { text: "/rename " } });
    await handleRename(ctx, { agentGroupId: -100, threadId: 42 });
    expect(ctx.reply).toHaveBeenCalledWith("Usage: /rename New Topic Name", { message_thread_id: 42 });
  });

  it("truncates names longer than 128 characters", async () => {
    const longName = "A".repeat(200);
    const ctx = createMockCtx({ message: { text: `/rename ${longName}` } });
    await handleRename(ctx, { agentGroupId: -100, threadId: 42 });

    expect(ctx.api.editForumTopic).toHaveBeenCalledWith(-100, 42, {
      name: "A".repeat(128),
    });
  });

  it("handles API failure gracefully", async () => {
    const ctx = createMockCtx({ message: { text: "/rename New Name" } });
    ctx.api.editForumTopic.mockRejectedValueOnce(new Error("API error"));

    await handleRename(ctx, { agentGroupId: -100, threadId: 42 });
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Failed to rename"),
      { message_thread_id: 42 }
    );
  });
});

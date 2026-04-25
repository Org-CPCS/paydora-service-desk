const { scrub } = require("../src/pii");

describe("scrub", () => {
  it("returns text unchanged (PII scrubbing is disabled)", () => {
    const text = "Hello, my name is John and my email is john@example.com";
    const userInfo = { id: 1, username: "johndoe", first_name: "John" };
    expect(scrub(text, userInfo)).toBe(text);
  });

  it("handles empty text", () => {
    expect(scrub("", {})).toBe("");
  });

  it("handles null userInfo", () => {
    expect(scrub("Hello", null)).toBe("Hello");
  });
});

/**
 * Basic PII scrubbing for outbound messages to the agent group.
 * Catches common patterns — not foolproof, but covers the obvious stuff.
 */

const patterns = [
  // Email addresses
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: "[email]" },
  // Phone numbers (international and local formats)
  { regex: /\+?\d[\d\s\-().]{7,}\d/g, label: "[phone]" },
  // Credit/debit card numbers (13-19 digits, with optional spaces/dashes)
  { regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b/g, label: "[card]" },
  // SSN-like patterns (XXX-XX-XXXX)
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, label: "[redacted]" },
  // Telegram usernames (@username)
  { regex: /@[a-zA-Z][a-zA-Z0-9_]{3,31}/g, label: "[username]" },
];

function scrub(text, userInfo) {
  if (!text) return text;
  let result = text;
  for (const { regex, label } of patterns) {
    result = result.replace(regex, label);
  }
  // Scrub the sender's own Telegram identity (username, first/last name)
  if (userInfo) {
    const names = [userInfo.username, userInfo.first_name, userInfo.last_name]
      .filter(Boolean);
    for (const name of names) {
      if (name.length >= 2) {
        result = result.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[redacted]");
      }
    }
  }
  return result;
}

module.exports = { scrub };

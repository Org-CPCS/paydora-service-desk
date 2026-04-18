/**
 * Scrubs the sender's Telegram username from message text.
 */

function scrub(text, userInfo) {
  if (!text) return text;
  let result = text;

  // Remove @username mentions
  result = result.replace(/@[a-zA-Z][a-zA-Z0-9_]{3,31}/g, "[username]");

  // NOTE: Previously removed the sender's username without the @ prefix,
  // but this was too aggressive and corrupted email addresses. Disabled.

  return result;
}

module.exports = { scrub };

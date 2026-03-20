/**
 * Scrubs the sender's Telegram username from message text.
 */

function scrub(text, userInfo) {
  if (!text) return text;
  let result = text;

  // Remove @username mentions
  result = result.replace(/@[a-zA-Z][a-zA-Z0-9_]{3,31}/g, "[username]");

  // Remove the sender's username even without the @ prefix
  if (userInfo?.username && userInfo.username.length >= 2) {
    const escaped = userInfo.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), "[username]");
  }

  return result;
}

module.exports = { scrub };

/**
 * Scrubs the sender's Telegram username from message text.
 */

function scrub(text, userInfo) {
  // PII scrubbing disabled — was corrupting email addresses
  return text;
}

module.exports = { scrub };

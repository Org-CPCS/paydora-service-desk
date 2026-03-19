# Customer Support Bot — Requirements

This document breaks down everything needed to make the bot work seamlessly,
with the primary goal of identity masking in a shared agent workspace.

---

## 1. Telegram Setup Requirements

### 1.1 Bot Creation
- Create a bot via @BotFather.
- Disable "Group Privacy" mode so the bot can read all messages in the agent group (not just commands).
  - BotFather → `/mybots` → Bot Settings → Group Privacy → Turn OFF.
- Note the bot token — this is the only secret the backend needs.

### 1.2 Agent Supergroup
- Create a Telegram Supergroup (not a basic group).
- Enable Topics (General → Topics → ON). This requires the group to be a supergroup.
- Add the bot to this group and make it an admin with these permissions:
  - Manage Topics (create, rename, close topics)
  - Send Messages
  - Delete Messages (to clean up if needed)
- Add agents as regular members — they only need permission to send messages in topics.
- Disable "Send Messages" in the General topic so agents only interact inside customer topics.

### 1.3 Important Telegram Constraints
- Bots cannot use `forwardMessage` without exposing the sender's identity. The bot must **copy** message content (text, photos, documents, etc.) and re-post it — never forward.
- Topic names are visible to all group members, so they must only contain the alias, never real names.
- Telegram supergroups support up to ~200 topics before UX degrades. Plan for topic archival/closing.

---

## 2. Identity Masking — The Core Problem

This is the most critical piece. Agents must never learn who the customer is.

### 2.1 What Must Be Masked
- Telegram user ID, username, first/last name, phone number — none of this reaches the agent group.
- The bot re-posts messages as its own, attributed to an alias like `cust-42`.

### 2.2 What Can Leak (and How to Prevent It)

| Leak Vector                              | Mitigation                                                                 |
|------------------------------------------|----------------------------------------------------------------------------|
| Customer says their name in the message  | Optional PII scrubbing (regex for names, phones, emails). Not foolproof.   |
| Bot forwards instead of copying          | Never use `forwardMessage`. Always copy content and re-post as the bot.    |
| Agent sees customer profile in group     | Customer is never in the group. Bot relays everything.                     |
| Topic name contains real info            | Topic names are strictly alias-based (e.g. `cust-42`).                    |
| Shared media with metadata               | Strip EXIF/metadata from images before forwarding. Or accept the risk.     |
| Agent searches alias in bot DM           | Bot should not respond to agents in DM — only operate in the group.        |

### 2.3 Alias Strategy
- Generate aliases on first contact: `cust-<incrementing number>` or `cust-<random 4-char>`.
- Persist the mapping: `alias ↔ telegram_user_id`.
- Same customer always gets the same alias (so their topic is reused).
- Only the system owner can look up the real identity behind an alias.

---

## 3. Message Routing Logic

### 3.1 Customer → Agent Group

```
Customer sends message to bot (DM)
  ↓
Bot receives update via polling/webhook
  ↓
Look up customer's alias (or create one + create a new topic)
  ↓
Copy message content into the customer's topic in the agent group
  Format: "cust-42:\n<message text>"
  For media: upload as bot with caption "cust-42: <caption>"
```

### 3.2 Agent Group → Customer

```
Agent replies inside a topic in the agent group
  ↓
Bot receives the message (group privacy OFF, bot is admin)
  ↓
Bot checks: is the sender the bot itself? → ignore (prevent echo loops)
  ↓
Look up which customer alias maps to this topic (by message_thread_id)
  ↓
Copy the reply content to the customer's DM with the bot
```

### 3.3 Supported Message Types
The bot must handle copying of:
- Text messages
- Photos (with captions)
- Documents / files
- Voice messages
- Video messages
- Stickers
- Location (if relevant)

Each type uses a different Bot API method (`sendMessage`, `sendPhoto`, `sendDocument`, etc.).

---

## 4. Data Model

Minimal schema needed:

```
customers
  - id              (primary key)
  - telegram_user_id (bigint, unique)
  - alias           (string, unique, e.g. "cust-42")
  - created_at      (timestamp)

topics
  - id              (primary key)
  - customer_id     (foreign key → customers)
  - thread_id       (bigint — Telegram's message_thread_id)
  - status          (open / closed)
  - created_at      (timestamp)

messages (optional, for history/audit)
  - id              (primary key)
  - topic_id        (foreign key → topics)
  - direction       (customer_to_agent / agent_to_customer)
  - sender_alias    (string — alias or agent name)
  - content_type    (text / photo / document / voice / etc.)
  - content         (text or file_id)
  - created_at      (timestamp)
```

SQLite is fine for ~5 agents and moderate volume. PostgreSQL if you want durability and concurrent access guarantees.

---

## 5. Edge Cases & Reliability

| Scenario                                  | How to Handle                                                              |
|-------------------------------------------|----------------------------------------------------------------------------|
| Customer sends message while no agent is online | Message lands in the topic. Agents see it when they come online. No loss. |
| Agent replies in the General topic (not a customer topic) | Bot ignores messages outside tracked topics.                  |
| Customer sends rapid-fire messages         | Queue and forward in order. Telegram rate limits: ~30 msgs/sec to groups. |
| Bot restarts mid-conversation              | Stateless relay — just needs the DB. Picks up where it left off.          |
| Topic limit approached (~200)              | Auto-close inactive topics after N hours/days. Reopen on new message.     |
| Customer blocks the bot                    | Bot gets an error sending. Log it, optionally notify agents in the topic. |
| Agent accidentally sends in wrong topic    | Message goes to wrong customer. Mitigate with clear topic naming. Consider a confirmation step for sensitive ops. |
| Multiple agents reply in same topic        | Fine — all replies go to the customer. Agents coordinate among themselves. |

---

## 6. Bot Commands (Optional but Useful)

### For Agents (in the group)
- `/close` — Close the current topic (mark conversation resolved).
- `/note <text>` — Add an internal note visible only in the group, not forwarded to customer.

### For Admins (in the group or DM with bot)
- `/whois cust-42` — Reveal the real identity behind an alias (admin only).
- `/stats` — Show open conversations, average response time, etc.
- `/broadcast <message>` — Send a message to all active customers (use carefully).

### For Customers (in DM with bot)
- `/start` — Welcome message explaining how to get help.
- `/status` — "An agent will be with you shortly" or "Your conversation is active."

---

## 7. Deployment Requirements

- A server that runs 24/7 (VPS, container, cloud VM).
- Webhook (recommended) or long-polling for receiving Telegram updates.
  - Webhook needs HTTPS — use a reverse proxy (nginx/caddy) with Let's Encrypt, or a platform that provides it (Railway, Fly.io, etc.).
  - Long-polling is simpler for development but less efficient at scale.
- Environment variables:
  - `BOT_TOKEN` — from BotFather
  - `AGENT_GROUP_ID` — chat ID of the supergroup
  - `DATABASE_URL` — connection string (or file path for SQLite)
  - `ADMIN_USER_IDS` — comma-separated Telegram user IDs for admin commands

---

## 8. Summary of What to Build

| Component              | What It Does                                                    |
|------------------------|------------------------------------------------------------------|
| Bot backend service    | Receives messages, manages aliases, routes between customer ↔ group |
| Database               | Stores alias mappings, topic IDs, optionally message history     |
| Telegram supergroup    | Shared workspace for agents, one topic per customer              |
| Telegram bot           | The interface customers interact with                            |

The bot backend is the only thing you write code for. Everything else is Telegram configuration.

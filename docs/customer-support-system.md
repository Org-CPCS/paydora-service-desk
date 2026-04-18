# Telegram-Based Customer Support System — Design Document

## Objective

Build a centralized, secure customer support system where:

- ~5 support agents share a common workspace
- Customers interact via a Telegram bot
- Customer identity (username, phone) is masked from agents
- Agents handle multiple customers simultaneously
- Agents never access the main Telegram account directly
- The system owner retains full control

---

## How It Works

### High-Level Flow

```
Customer (Telegram) → Bot → Shared Agent Group (Telegram) → Bot → Customer
```

1. A customer sends a message to the public-facing Telegram bot.
2. The bot assigns the customer an internal alias (e.g. `cust-9`) and stores the mapping privately.
3. The bot forwards the message into a shared Telegram group/supergroup, creating a dedicated topic (thread) for that customer.
4. Agents see the aliased message and reply within the topic.
5. The bot picks up the agent's reply and routes it back to the original customer.

### Message Example

```
[Shared Group — Topic: cust-9]

Bot: New customer cust-9
     "Hey, I'm Alex, I need help with my payment."

Agent Maria: "Hi! Could you share your order number?"

→ Bot forwards Maria's reply back to the customer as the bot's message.
```

---

## Core Components

### 1. Customer-Facing Telegram Bot

- Public bot that customers message directly.
- Receives all incoming customer messages.
- Generates and maintains alias mappings (customer ↔ alias).
- Forwards messages to the agent group.
- Delivers agent replies back to the customer.

### 2. Shared Agent Group (Telegram Supergroup with Topics)

- A private Telegram supergroup with Topics enabled.
- Each customer conversation gets its own topic, named by alias.
- Agents are members of this group and respond inside topics.
- Agents never see real customer identity — only the alias.

### 3. Relay Service (Bot Backend)

- A backend service (the bot's server-side logic) that:
  - Listens for customer messages via the Bot API.
  - Creates/manages topics in the agent group.
  - Forwards messages in both directions.
  - Stores alias ↔ customer mappings.
  - Optionally scrubs PII from message content.

---

## Alias & Privacy

| Data              | Visible to Agents? | Stored by System? |
|-------------------|---------------------|--------------------|
| Telegram username | No                  | Yes (encrypted)    |
| Phone number      | No                  | Yes (encrypted)    |
| Alias (cust-N)    | Yes                 | Yes                |
| Message content   | Yes                 | Yes                |

- Aliases are generated sequentially or randomly per session/customer.
- Only the system owner (or an admin panel) can resolve an alias back to a real identity.

---

## Agent Experience

- Agents join the private supergroup.
- They see a list of topics — one per active customer.
- They reply in-thread; the bot handles delivery.
- Agents can handle multiple topics (customers) at once.
- No direct contact with customers outside the bot flow.

---

## Security & Control

- Agents have no access to the bot token or the bot's backend.
- The group is invite-only; the owner controls membership.
- The alias mapping database is accessible only to the system owner.
- Bot token and secrets are stored server-side, never shared.
- Optional: admin commands to reassign, close, or escalate conversations.

---

## Technical Considerations

| Concern                        | Approach                                                        |
|--------------------------------|------------------------------------------------------------------|
| Bot framework                  | Python (`python-telegram-bot`) or Node.js (`telegraf` / `grammY`) |
| Persistence                    | PostgreSQL or SQLite for alias mappings & conversation state      |
| Topic management               | Telegram Bot API `createForumTopic` / `sendMessage` with `message_thread_id` |
| Deployment                     | Single lightweight server or container (VPS, cloud function, etc.) |
| Rate limits                    | Telegram Bot API limits — batch/queue outgoing messages if needed |
| PII scrubbing (optional)       | Regex-based filter on forwarded messages to strip phones/emails   |

---

## Web Chat Integration (Tenant Configuration)

When a tenant is configured to support web-based customers (from the CPCS frontend), the tenant record must include a `webhookUrl` field. This URL points to the CPCS backend webhook endpoint (e.g. `https://<cpcs-host>/v1/chat/webhook`). When an agent replies to a web-sourced customer, the bot POSTs the message to this URL instead of sending a Telegram DM. The request includes an `x-webhook-secret` header for authentication (see `CHAT_WEBHOOK_SECRET` in `.env.example`).

---

## Open Questions / Future Enhancements

- Should conversations auto-close after inactivity?
- Is there a need for an admin dashboard (web UI) to view alias mappings and conversation history?
- Should the system support canned responses or quick-reply templates for agents?
- Multi-language support needed?
- SLA tracking or response-time metrics?

---

## Summary

The entire system lives inside Telegram. Customers talk to a bot, agents talk in a private group, and a relay service connects the two while keeping customer identity hidden. It's simple to operate, requires minimal infrastructure, and keeps the owner in full control.

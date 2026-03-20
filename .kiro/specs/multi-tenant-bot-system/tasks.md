# Implementation Plan: Multi-Tenant Bot System

## Overview

Transform the existing single-tenant Paydora support bot into a multi-tenant system. The implementation proceeds bottom-up: first extend the data layer with tenant scoping, then build the Bot Manager and Sub-Bot factory, then the Master Bot, and finally rewrite the entry point to wire everything together. Each step builds on the previous one so there is no orphaned code.

## Tasks

- [x] 1. Extend the database layer with tenant support
  - [x] 1.1 Add the Tenant model and update Customer schema in `src/db.js`
    - Add `tenantSchema` with fields: `botToken` (unique), `botUsername`, `agentGroupId`, `adminUserId`, `status` (enum: active/inactive/removed), `createdAt`
    - Add `tenantId` (ObjectId, ref Tenant, required) field to `customerSchema`
    - Replace the `unique: true` index on `telegramUserId` with a compound unique index `{ tenantId: 1, telegramUserId: 1 }`
    - Add compound unique index `{ tenantId: 1, alias: 1 }`
    - Add compound index `{ tenantId: 1, threadId: 1 }`
    - Export the new `Tenant` model
    - _Requirements: 2.1, 2.2_

  - [x] 1.2 Update `getNextAlias` to be tenant-scoped in `src/db.js`
    - Change signature to `getNextAlias(tenantId, firstName)`
    - Use counter `_id` of `alias:${tenantId}` instead of the global `"customerAlias"`
    - _Requirements: 2.5_

  - [ ]* 1.3 Write property test for tenant-scoped alias counters
    - **Property 7: Tenant-scoped alias counters are independent**
    - **Validates: Requirements 2.5**

  - [ ]* 1.4 Write property test for tenant data isolation
    - **Property 6: Tenant data isolation**
    - **Validates: Requirements 2.3, 2.4**

- [x] 2. Refactor relay module for multi-tenancy
  - [x] 2.1 Update `src/relay.js` to accept tenant context parameters
    - Remove the `AGENT_GROUP_ID` constant (no longer read from `process.env`)
    - Change `getOrCreateCustomer(bot, telegramUserId, fromUser)` → `getOrCreateCustomer(bot, tenantId, telegramUserId, fromUser, agentGroupId)`
    - Change `relayToAgents(bot, customer, msg)` → `relayToAgents(bot, customer, msg, agentGroupId)`
    - Change `relayToCustomer(bot, threadId, msg)` → `relayToCustomer(bot, tenantId, threadId, msg)`
    - Scope all `Customer.findOne` queries by `tenantId`
    - Pass `tenantId` to `getNextAlias` when creating new customers
    - Replace all hardcoded `AGENT_GROUP_ID` references with the `agentGroupId` parameter
    - _Requirements: 2.3, 2.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.7_

  - [ ]* 2.2 Write property test for customer creation scoping
    - **Property 10: Customer creation scoped to tenant**
    - **Validates: Requirements 2.2, 4.1, 4.2**

  - [ ]* 2.3 Write property test for message relay content preservation
    - **Property 11: Message relay to agent group preserves content**
    - **Validates: Requirements 4.3**

  - [ ]* 2.4 Write property test for close/reopen round trip
    - **Property 13: Close and reopen round trip**
    - **Validates: Requirements 4.5, 4.7**

- [-] 3. Create the Sub-Bot handler factory
  - [x] 3.1 Create `src/sub-bot.js` with `createSubBot(token, tenant)` function
    - Accept `tenant` object with `{ tenantId, agentGroupId, adminUserId }`
    - Create a new grammY `Bot` instance with the given token
    - Register private message handler: on DM, call `getOrCreateCustomer(bot, tenantId, ...)` then `relayToAgents(bot, customer, msg, agentGroupId)`
    - Register `/start` command handler for customer welcome message
    - Register agent group handler: filter messages by `ctx.chat.id === agentGroupId`, ignore bot messages, require `message_thread_id`
    - Register `/close` command: scope `Customer.findOne` by `{ tenantId, threadId }`, update status, rename topic with `[done]` prefix
    - Register `/note` command: post note in topic, do not relay to customer
    - Register `/whois` command: check `ctx.from.id === adminUserId`, scope `Customer.findOne` by `{ tenantId, alias }`, reply with Telegram ID or "Customer not found."
    - Apply PII scrubbing via `src/pii.js` on all relayed customer messages
    - Return the configured `Bot` instance
    - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 7.1, 7.2, 7.3_

  - [ ]* 3.2 Write property test for whois tenant scoping
    - **Property 20: Whois scoped to tenant**
    - **Validates: Requirements 7.1**

  - [ ]* 3.3 Write property test for whois admin restriction
    - **Property 21: Whois restricted to Tenant Admin**
    - **Validates: Requirements 7.2**

  - [ ]* 3.4 Write property test for notes not relayed
    - **Property 14: Notes are not relayed to customer**
    - **Validates: Requirements 4.6**

  - [ ]* 3.5 Write property test for PII scrubbing
    - **Property 15: PII scrubbing removes all username forms**
    - **Validates: Requirements 5.1, 5.2**

- [x] 4. Checkpoint — Verify data layer and sub-bot factory
  - Ensure all tests pass, ask the user if questions arise.

- [-] 5. Create the Bot Manager
  - [x] 5.1 Create `src/bot-manager.js` with the `BotManager` class
    - Maintain a `Map<tenantId, { bot, startedAt }>` of running Sub-Bot instances
    - Implement `async loadAndStartAll()`: load all tenants with status `"active"` from the `Tenant` model, call `startBot(tenant)` for each
    - Implement `async startBot(tenant)`: call `createSubBot(token, tenant)`, call `bot.start()` with an `onStart` callback, store in the map with `startedAt` timestamp
    - Implement `async startBotWithRetry(tenant, maxRetries = 3, delayMs = 5000)`: wrap `startBot` with retry logic, log errors with tenant ID, continue on final failure
    - Implement `async stopBot(tenantId)`: call `bot.stop()` on the instance, remove from the map
    - Implement `async stopAll()`: iterate all running bots, call `bot.stop()` on each
    - Implement `getStatus(tenantId)`: return `{ running, startedAt }` or null
    - Implement `getAllStatuses()`: return status info for all tracked bots
    - Use `startBotWithRetry` in `loadAndStartAll` so a single failing tenant doesn't block others
    - Attach grammY error handler on each Sub-Bot that triggers retry on fatal polling errors
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 8.1, 9.1, 9.4_

  - [ ]* 5.2 Write property test for only active tenants started on boot
    - **Property 8: Only active tenants started on boot**
    - **Validates: Requirements 3.1**

  - [ ]* 5.3 Write property test for sub-bot retry on fatal error
    - **Property 9: Sub-Bot retry on fatal error**
    - **Validates: Requirements 3.5**

  - [ ]* 5.4 Write property test for graceful shutdown
    - **Property 22: Graceful shutdown stops all bots**
    - **Validates: Requirements 8.1**

- [x] 6. Create the Master Bot
  - [x] 6.1 Create `src/master.js` with `createMasterBot(token, superAdminId, botManager)` function
    - Create a new grammY `Bot` instance with the given token
    - Add middleware that checks `ctx.from.id === Number(superAdminId)` — silently ignore non-matching senders
    - Implement `/register <bot_token> <agent_group_id> <admin_user_id>`:
      - Parse and validate arguments (reply with usage if missing, reply with error if non-numeric IDs)
      - Check for duplicate bot token in `Tenant` collection
      - Validate token by calling `new Bot(token).api.getMe()`
      - Verify bot is admin in agent group by calling `getChatAdministrators`
      - Create `Tenant` record with status `"active"`
      - Call `botManager.startBot(tenant)` to start the Sub-Bot immediately
      - Reply with confirmation containing bot username, tenant ID, and admin user ID
    - Implement `/stop <tenant_id>`: update tenant status to `"inactive"`, call `botManager.stopBot(tenantId)`, reply with confirmation
    - Implement `/start <tenant_id>`: update tenant status to `"active"`, call `botManager.startBot(tenant)`, reply with confirmation
    - Implement `/remove <tenant_id>`: call `botManager.stopBot(tenantId)`, update tenant status to `"removed"`, reply with confirmation
    - Implement `/list`: query all tenants, reply with formatted list of tenant IDs, bot usernames, and statuses
    - Implement `/status <tenant_id>`: query tenant, get bot manager status, reply with status, bot username, admin user ID, and uptime
    - Return the configured `Bot` instance
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 10.3, 10.4_

  - [ ]* 6.2 Write property test for Super Admin authentication gate
    - **Property 1: Super Admin authentication gate**
    - **Validates: Requirements 1.8, 6.6, 10.3, 10.4**

  - [ ]* 6.3 Write property test for registration validation
    - **Property 2: Registration validation rejects invalid inputs**
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 6.4 Write property test for duplicate token rejection
    - **Property 5: Duplicate bot token rejection**
    - **Validates: Requirements 1.7**

  - [ ]* 6.5 Write property test for registration confirmation fields
    - **Property 4: Registration confirmation contains required fields**
    - **Validates: Requirements 1.4**

  - [ ]* 6.6 Write property test for stop/start round trip
    - **Property 16: Stop then start restores active state**
    - **Validates: Requirements 6.2, 6.3**

  - [ ]* 6.7 Write property test for remove sets terminal status
    - **Property 17: Remove sets terminal status**
    - **Validates: Requirements 6.4**

  - [ ]* 6.8 Write property test for list completeness
    - **Property 18: List returns all registered tenants**
    - **Validates: Requirements 6.5**

  - [ ]* 6.9 Write property test for status response fields
    - **Property 19: Status response contains required fields**
    - **Validates: Requirements 6.1**

- [x] 7. Checkpoint — Verify Bot Manager and Master Bot
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Rewrite entry point and update configuration
  - [x] 8.1 Rewrite `src/index.js` as the multi-tenant entry point
    - Connect to MongoDB
    - Validate `SUPER_ADMIN_ID` is set — abort with error log if missing
    - Validate `MASTER_BOT_TOKEN` is set — abort with error log if missing
    - Create `BotManager` instance
    - Create and start Master Bot via `createMasterBot()`
    - Call `botManager.loadAndStartAll()` to start all active Sub-Bots
    - Register `SIGTERM` and `SIGINT` handlers: call `botManager.stopAll()`, stop Master Bot, close Mongoose connection, exit
    - Remove all old single-tenant bot logic (old `Bot` instance, old handlers, old `AGENT_GROUP_ID` usage)
    - _Requirements: 3.1, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 10.1, 10.2_

  - [x] 8.2 Update `.env.example` with new environment variables
    - Replace `BOT_TOKEN` and `AGENT_GROUP_ID` with `MASTER_BOT_TOKEN`, `SUPER_ADMIN_ID`, and `MONGODB_URI`
    - Add comments explaining each variable
    - _Requirements: 10.1_

  - [ ]* 8.3 Write property test for tenant persistence across restarts
    - **Property 23: Tenant persistence across restarts**
    - **Validates: Requirements 8.2, 8.3**

  - [ ]* 8.4 Write property test for agent reply relay to customer
    - **Property 12: Agent reply relay to customer**
    - **Validates: Requirements 4.4**

- [x] 9. Final checkpoint — Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped (user has indicated tests are not needed for now)
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation between major phases
- The existing `src/pii.js` module requires no changes — it is already stateless and tenant-agnostic
- The `ecosystem.config.js` and PM2 deployment remain unchanged since the app is still a single-process Node.js application

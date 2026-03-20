# Requirements Document

## Introduction

This feature transforms the existing single-tenant Paydora customer support bot into a multi-tenant system. A master bot (@MasterPaydoraServiceBot) is controlled exclusively by the Super Admin (system owner) and handles tenant registration and lifecycle management. The Super Admin manually creates each tenant's supergroup with topics enabled, adds the sub-bot as admin, and then registers the tenant via the Master Bot. Each registered tenant has a Tenant Admin who manages their agent group and staff. All tenants run within a single Node.js process, share one MongoDB database (separated by tenant ID), and each sub-bot operates as a fully independent customer support system with its own customers, agent group, and conversation topics.

## Glossary

- **Master_Bot**: The central Telegram bot (@MasterPaydoraServiceBot) that handles tenant registration, validation, and lifecycle management. Only the Super_Admin can interact with the Master_Bot. It does not handle customer support messages.
- **Super_Admin**: The system owner whose Telegram user ID is configured via the `SUPER_ADMIN_ID` environment variable. Only the Super_Admin can send commands to the Master_Bot to register, manage, and remove tenants.
- **Sub_Bot**: A grammY Bot instance created at runtime for a registered tenant. Each Sub_Bot has its own Telegram bot token and handles customer support for one tenant.
- **Tenant**: A registered entity consisting of a bot token, agent group ID, admin Telegram user ID, and associated configuration. Each Tenant maps to exactly one Sub_Bot.
- **Tenant_Registry**: The MongoDB collection that stores all Tenant configurations and their operational status.
- **Agent_Group**: A Telegram supergroup with topics enabled, created manually by the Super_Admin, where support agents handle customer conversations. The Sub_Bot must be added as an admin before registration.
- **Bot_Manager**: The in-process component responsible for creating, starting, stopping, and tracking all active Sub_Bot instances.
- **Tenant_Admin**: The Telegram user specified during registration (via `admin_user_id`) who has scoped admin rights within their Agent_Group. The Tenant_Admin can add agents/staff to the Agent_Group and use scoped commands (e.g., /whois) within the group. The Tenant_Admin does not interact with the Master_Bot.
- **Customer_Collection**: The per-tenant MongoDB collection (or tenant-scoped documents) storing customer alias mappings, thread IDs, and conversation state.

## Requirements

### Requirement 1: Tenant Registration via Master Bot

**User Story:** As the Super_Admin, I want to register a tenant's bot token, agent group, and admin user with the Master_Bot, so that a new Sub_Bot is provisioned for the tenant's customer support system.

#### Acceptance Criteria

1. WHEN the Super_Admin sends a `/register <bot_token> <agent_group_id> <admin_user_id>` command to the Master_Bot, THE Master_Bot SHALL validate the bot token by calling the Telegram `getMe` API.
2. WHEN the bot token is valid, THE Master_Bot SHALL verify that the Sub_Bot has admin permissions in the specified Agent_Group by calling the `getChatAdministrators` API.
3. WHEN both the token and Agent_Group are valid, THE Master_Bot SHALL store the Tenant configuration (including the specified admin_user_id as the Tenant_Admin) in the Tenant_Registry with a status of "active".
4. WHEN registration succeeds, THE Master_Bot SHALL reply to the Super_Admin with a confirmation message containing the bot username, tenant ID, and assigned Tenant_Admin user ID.
5. IF the bot token is invalid or the Telegram API returns an error, THEN THE Master_Bot SHALL reply with a descriptive error message indicating the token is invalid.
6. IF the Sub_Bot is not an admin in the specified Agent_Group, THEN THE Master_Bot SHALL reply with an error message instructing the Super_Admin to add the bot as an admin with topic management permissions.
7. IF a Tenant with the same bot token already exists in the Tenant_Registry, THEN THE Master_Bot SHALL reply with an error message indicating the bot is already registered.
8. IF a non-Super_Admin user sends any command to the Master_Bot, THEN THE Master_Bot SHALL ignore the command and not reply.

### Requirement 2: Tenant Data Isolation

**User Story:** As the Super_Admin, I want each tenant's customer data to be completely isolated from other tenants, so that no cross-tenant data leakage occurs.

#### Acceptance Criteria

1. THE Tenant_Registry SHALL store each Tenant with a unique tenant ID, bot token, agent group ID, Tenant_Admin Telegram user ID, status, and creation timestamp.
2. THE Customer_Collection SHALL associate every customer record with a tenant ID field.
3. WHEN a Sub_Bot queries for customer data, THE database layer SHALL scope all queries to the corresponding tenant ID.
4. THE database layer SHALL enforce that no query from one Sub_Bot can read or write customer records belonging to a different tenant ID.
5. THE alias generation counter SHALL be scoped per tenant, so that each tenant has its own independent alias sequence (e.g., `User-1`, `User-2`).

### Requirement 3: Sub-Bot Lifecycle Management

**User Story:** As the Super_Admin, I want all registered Sub_Bots to start automatically when the application launches and to be manageable at runtime, so that tenants experience uninterrupted service.

#### Acceptance Criteria

1. WHEN the application starts, THE Bot_Manager SHALL load all Tenant records with status "active" from the Tenant_Registry and start a grammY Bot instance for each.
2. WHEN a new Tenant is registered via the Master_Bot, THE Bot_Manager SHALL immediately create and start a new Sub_Bot instance without restarting the application.
3. WHEN a Sub_Bot is started, THE Bot_Manager SHALL register message handlers for customer DMs, agent group replies, and all existing bot commands (/close, /note, /whois, /start).
4. IF a Sub_Bot fails to start due to an invalid token or network error, THEN THE Bot_Manager SHALL log the error with the tenant ID and continue starting remaining Sub_Bots.
5. IF a running Sub_Bot encounters a fatal polling error, THEN THE Bot_Manager SHALL attempt to restart the Sub_Bot up to 3 times with a 5-second delay between attempts.

### Requirement 4: Sub-Bot Customer Support Relay

**User Story:** As a customer, I want to message a tenant's Sub_Bot and have my messages relayed to the tenant's agent group, so that I receive support from the correct team.

#### Acceptance Criteria

1. WHEN a customer sends a private message to a Sub_Bot, THE Sub_Bot SHALL look up or create a customer record scoped to the Sub_Bot's tenant ID.
2. WHEN a new customer contacts a Sub_Bot for the first time, THE Sub_Bot SHALL create a forum topic in the tenant's Agent_Group using the customer's generated alias.
3. WHEN a customer message is received, THE Sub_Bot SHALL relay the message content (text, photo, document, voice, video, sticker, contact, location) to the corresponding topic in the tenant's Agent_Group.
4. WHEN an agent replies in a topic in the tenant's Agent_Group, THE Sub_Bot SHALL relay the reply back to the corresponding customer's private chat.
5. THE Sub_Bot SHALL support the /close command in agent topics to mark conversations as closed and visually update the topic name with a "[done]" prefix.
6. THE Sub_Bot SHALL support the /note command in agent topics to post internal notes that are not relayed to the customer.
7. WHEN a customer sends a new message to a closed conversation, THE Sub_Bot SHALL reopen the topic and update the topic name to remove the "[done]" prefix.

### Requirement 5: PII Scrubbing per Tenant

**User Story:** As a Tenant_Admin, I want customer messages to have Telegram usernames scrubbed before agents see them, so that customer privacy is maintained.

#### Acceptance Criteria

1. WHEN a customer message is relayed to the Agent_Group, THE Sub_Bot SHALL scrub all Telegram @username mentions from the message text and captions.
2. WHEN a customer message is relayed to the Agent_Group, THE Sub_Bot SHALL scrub the sender's Telegram username from the message text even when written without the @ prefix.
3. THE Sub_Bot SHALL apply PII scrubbing independently per tenant, using only the sending customer's user information.

### Requirement 6: Master Bot Tenant Administration

**User Story:** As the Super_Admin, I want to manage all tenants' status through the Master_Bot, so that I can control any support bot without server access.

#### Acceptance Criteria

1. WHEN the Super_Admin sends `/status <tenant_id>` to the Master_Bot, THE Master_Bot SHALL reply with the current status (active/inactive), bot username, Tenant_Admin user ID, and uptime of the specified tenant's Sub_Bot.
2. WHEN the Super_Admin sends `/stop <tenant_id>` to the Master_Bot, THE Master_Bot SHALL stop the corresponding Sub_Bot instance and set the Tenant status to "inactive".
3. WHEN the Super_Admin sends `/start <tenant_id>` to the Master_Bot, THE Master_Bot SHALL start the corresponding Sub_Bot instance and set the Tenant status to "active".
4. WHEN the Super_Admin sends `/remove <tenant_id>` to the Master_Bot, THE Master_Bot SHALL stop the Sub_Bot, set the Tenant status to "removed", and confirm removal to the Super_Admin.
5. WHEN the Super_Admin sends `/list` to the Master_Bot, THE Master_Bot SHALL reply with a list of all registered tenants and their current statuses.
6. THE Master_Bot SHALL only accept commands from the Super_Admin, identified by matching the sender's Telegram user ID against the `SUPER_ADMIN_ID` environment variable.

### Requirement 7: Whois Command with Tenant Scope

**User Story:** As a Tenant_Admin, I want the /whois command to only reveal customer identities within my tenant's scope, so that cross-tenant identity lookups are impossible.

#### Acceptance Criteria

1. WHEN a Tenant_Admin sends `/whois <alias>` in a tenant's Agent_Group, THE Sub_Bot SHALL look up the alias only within the corresponding tenant's Customer_Collection.
2. THE Sub_Bot SHALL only execute the /whois command for users whose Telegram user IDs match the tenant's Tenant_Admin user ID.
3. IF the alias is not found within the tenant's Customer_Collection, THEN THE Sub_Bot SHALL reply with "Customer not found."

### Requirement 8: Graceful Shutdown and Persistence

**User Story:** As the Super_Admin, I want the application to shut down gracefully and resume all tenants on restart, so that no tenant experiences data loss or prolonged downtime.

#### Acceptance Criteria

1. WHEN the application receives a SIGTERM or SIGINT signal, THE Bot_Manager SHALL stop all running Sub_Bot instances gracefully before exiting.
2. WHEN the application restarts, THE Bot_Manager SHALL restore all previously active Sub_Bots by reading the Tenant_Registry.
3. THE Tenant_Registry SHALL persist all tenant configurations in MongoDB so that no registration data is lost across application restarts.

### Requirement 9: Single-Process Multi-Tenant Architecture

**User Story:** As the Super_Admin, I want all Sub_Bots to run within a single Node.js process, so that resource usage is efficient and deployment remains simple.

#### Acceptance Criteria

1. THE Bot_Manager SHALL manage all Sub_Bot instances within a single Node.js process using grammY's long-polling mechanism.
2. THE application SHALL use a single MongoDB connection shared across all tenants.
3. THE application SHALL continue to be deployable via PM2 using the existing ecosystem.config.js pattern.
4. WHEN a new Sub_Bot is added, THE Bot_Manager SHALL create the grammY Bot instance in-process without spawning child processes or workers.

### Requirement 10: Super Admin Authentication

**User Story:** As the Super_Admin, I want the Master_Bot to authenticate my identity via environment variable, so that only I can manage tenants.

#### Acceptance Criteria

1. THE application SHALL read the `SUPER_ADMIN_ID` environment variable at startup and use it to identify the Super_Admin.
2. IF the `SUPER_ADMIN_ID` environment variable is not set, THEN THE application SHALL refuse to start the Master_Bot and log an error message.
3. WHEN any user sends a command to the Master_Bot, THE Master_Bot SHALL compare the sender's Telegram user ID against the configured `SUPER_ADMIN_ID` before processing the command.
4. IF the sender's Telegram user ID does not match the `SUPER_ADMIN_ID`, THEN THE Master_Bot SHALL ignore the command silently.
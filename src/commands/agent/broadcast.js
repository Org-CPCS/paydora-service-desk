const { Api, InlineKeyboard } = require("grammy");
const { autoRetry } = require("@grammyjs/auto-retry");
const Customer = require("../../db/models/customer");
const TenantBot = require("../../db/models/tenant-bot");
const { messageQueue } = require("../../relay/message-queue");

// Pending broadcast confirmations: key = `${tenantId}:${fromUserId}`, value = { text, fileId, fileType, timestamp, timer }
const pendingBroadcasts = new Map();

const PENDING_TTL_MS = 5 * 60 * 1000;

/** Drop a pending broadcast and cancel its expiry timer. */
function clearPending(key) {
  const pending = pendingBroadcasts.get(key);
  if (pending && pending.timer) clearTimeout(pending.timer);
  pendingBroadcasts.delete(key);
}

/**
 * /broadcastallusers <text> — initiate a broadcast to all customers of this tenant.
 * Supports: text-only, photo with caption, document with caption.
 */
async function handleBroadcast(ctx, { tenantId, threadId }) {
  const replyOpts = threadId ? { message_thread_id: threadId } : {};
  const rawText = ctx.message.text || ctx.message.caption || "";
  const text = rawText.slice("/broadcastallusers".length).trim();
  const photo = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1] : null;
  const doc = ctx.message.document || null;
  const fileId = photo ? photo.file_id : doc ? doc.file_id : null;
  const fileType = photo ? "photo" : doc ? "document" : null;

  if (!text && !fileId) {
    return ctx.reply("Usage: /broadcastallusers Your message here\n\nYou can also send a photo or file with /broadcastallusers as the caption.", replyOpts);
  }

  const count = await Customer.countDocuments({ tenantId, status: { $ne: "blocked" } });
  if (count === 0) {
    return ctx.reply("No customers to broadcast to.", replyOpts);
  }

  // Store the pending broadcast keyed by tenant + sender
  const key = `${tenantId}:${ctx.from.id}`;
  clearPending(key);
  // Expire after 5 minutes. The timer is kept on the entry so confirm/cancel
  // can cancel it instead of leaving it pending for the full window.
  const timer = setTimeout(() => pendingBroadcasts.delete(key), PENDING_TTL_MS);
  if (typeof timer.unref === "function") timer.unref();
  pendingBroadcasts.set(key, {
    text: text || null,
    fileId,
    fileType,
    timestamp: Date.now(),
    timer,
  });
  console.log(`[SubBot] broadcastallusers: stored pending broadcast key=${key}, text="${(text || "").slice(0, 50)}", fileType=${fileType}, hasFile=${!!fileId}, pendingBroadcasts size=${pendingBroadcasts.size}`);

  const keyboard = new InlineKeyboard()
    .text("✅ Confirm", `broadcast_confirm:${ctx.from.id}`)
    .text("❌ Cancel", `broadcast_cancel:${ctx.from.id}`);

  let preview = "";
  if (fileType === "photo") preview += "📷 [image attached]\n";
  if (fileType === "document") preview += "📎 [file attached]\n";
  if (text) preview += `"${text.length > 200 ? text.slice(0, 200) + "…" : text}"`;

  return ctx.reply(
    `⚠️ This will send a message to ${count} customer${count === 1 ? "" : "s"}.\n\n` +
    `Message preview:\n${preview}\n\n` +
    `Are you sure?`,
    { ...replyOpts, reply_markup: keyboard }
  );
}

/**
 * Handle broadcast_confirm callback query.
 */
async function handleBroadcastConfirm(ctx, { tenantId, bot, botToken }) {
  const callbackUserId = Number(ctx.match[1]);
  console.log(`[SubBot] broadcast_confirm callback received from user ${ctx.from.id}, tenant ${tenantId}`);

  if (ctx.from.id !== callbackUserId) {
    console.log(`[SubBot] broadcast_confirm rejected: sender ${ctx.from.id} !== initiator ${callbackUserId}`);
    return ctx.answerCallbackQuery({ text: "Only the person who initiated the broadcast can confirm.", show_alert: true });
  }

  const key = `${tenantId}:${ctx.from.id}`;
  const pending = pendingBroadcasts.get(key);
  console.log(`[SubBot] broadcast_confirm: key=${key}, pending=${pending ? "found" : "not found"}, pendingBroadcasts size=${pendingBroadcasts.size}`);
  if (!pending) {
    await ctx.editMessageText("⏰ Broadcast expired. Please run the command again.");
    return ctx.answerCallbackQuery();
  }

  clearPending(key);
  await ctx.answerCallbackQuery({ text: "Sending..." });

  const customers = await Customer.find({ tenantId, status: { $ne: "blocked" } });
  console.log(`[SubBot] broadcast_confirm: found ${customers.length} customers to message`);
  await ctx.editMessageText(`📤 Sending to ${customers.length} customer${customers.length === 1 ? "" : "s"}...`);

  const counts = { sent: 0, blocked: 0, unreachable: 0, failed: 0 };
  const webCustomers = customers.filter((c) => c.source === "web");
  const telegramCustomers = customers.filter((c) => c.source !== "web");

  // Web customers go out over the CPCS webhook, which is bot-agnostic.
  await sendWebBroadcast(webCustomers, tenantId, pending, counts);

  // Telegram will only deliver a DM through the exact bot the customer opened
  // the chat with. Routing every customer through whichever bot happened to
  // receive this callback made every customer belonging to a sibling bot fail
  // with "chat not found" — on 2026-08-07 that was 218 of 237 recipients. Group
  // by the bot each customer actually talked to and send through that one.
  await sendTelegramBroadcast(telegramCustomers, { bot, botToken, tenantId }, pending, counts);

  let summary = `✅ Broadcast complete: ${counts.sent} sent`;
  if (counts.blocked > 0) summary += `, ${counts.blocked} blocked`;
  if (counts.unreachable > 0) summary += `, ${counts.unreachable} unreachable`;
  if (counts.failed > 0) summary += `, ${counts.failed} failed`;
  if (counts.unreachable > 0) {
    summary += `\n\nℹ️ "Unreachable" means the customer has no open chat with their assigned bot — usually a stale record.`;
  }
  await ctx.editMessageText(summary);
}

/**
 * Resolve a grammY Api client per bot token, reusing the running bot's own
 * client where possible so we don't build a second one for it.
 * @param {{ bot: object, botToken?: string }} current
 * @returns {(token: string | null) => object}
 */
function makeApiResolver({ bot, botToken }) {
  // `bot.token` is grammY's own accessor; test doubles supply neither, in which
  // case every send falls back to the caller's bot exactly as before.
  const currentToken = botToken || bot.token || null;
  const cache = new Map();

  return (token) => {
    if (!token || !currentToken || token === currentToken) return bot.api;
    let api = cache.get(token);
    if (!api) {
      api = new Api(token);
      // Match createSubBot: absorb 429s rather than failing the recipient.
      api.config.use(autoRetry({ maxRetryAttempts: 5, maxDelaySeconds: 60 }));
      cache.set(token, api);
    }
    return api;
  };
}

/** Bucket a send failure so the summary distinguishes stale data from real errors. */
function recordFailure(err, customer, counts) {
  const msg = (err && err.message) || String(err);
  if (msg.includes("chat not found")) {
    counts.unreachable++;
  } else if (msg.includes("bot was blocked") || msg.includes("403")) {
    counts.blocked++;
  } else {
    counts.failed++;
  }
  console.error(`[SubBot] broadcast failed for ${customer.alias} (${customer.telegramUserId}):`, msg);
}

/**
 * Candidate bot tokens to try for a customer, best guess first.
 *
 * A customer who has messaged us since bot tracking landed carries the exact
 * token, so that is the only candidate worth trying. Records predating it have
 * no token at all (24 of 237 for the tenant that broadcasts most), and for
 * those the reachable bot depends on which one they originally opened — so try
 * every active bot for the tenant rather than assuming the caller's.
 */
function candidateTokens(customer, currentToken, activeTokens) {
  if (customer.lastBotToken) return [customer.lastBotToken];
  const ordered = [currentToken, ...activeTokens.filter((t) => t !== currentToken)].filter(Boolean);
  // With no token information anywhere, a null candidate resolves to the
  // caller's own client — the pre-existing behaviour. Never return an empty
  // list: the send loop would then fall through and throw `undefined`.
  return ordered.length > 0 ? ordered : [null];
}

/**
 * Send to Telegram customers through each one's own bot, paced by the shared
 * message queue so a large broadcast cannot blow the per-bot rate limit.
 */
async function sendTelegramBroadcast(customers, current, pending, counts) {
  if (customers.length === 0) return;
  const apiFor = makeApiResolver(current);
  const currentToken = current.botToken || current.bot.token || null;

  // Only needed to resolve customers with no recorded bot; skip the query when
  // every customer already carries one.
  let activeTokens = [];
  if (customers.some((c) => !c.lastBotToken)) {
    const bots = await TenantBot.find({
      tenantId: current.tenantId,
      status: { $in: ["active", "pending"] },
    }).select("botToken");
    activeTokens = bots.map((b) => b.botToken);
  }

  const sendVia = async (api, c) => {
    if (pending.fileId) {
      const opts = { caption: pending.text || "" };
      if (pending.fileType === "photo") {
        await api.sendPhoto(c.telegramUserId, pending.fileId, opts);
      } else {
        await api.sendDocument(c.telegramUserId, pending.fileId, opts);
      }
    } else {
      await api.sendMessage(c.telegramUserId, pending.text);
    }
  };

  await Promise.all(
    customers.map((c) =>
      messageQueue
        .enqueue(c.telegramUserId, async () => {
          const tokens = candidateTokens(c, currentToken, activeTokens);
          let lastErr;
          for (const token of tokens) {
            try {
              await sendVia(apiFor(token), c);
              return;
            } catch (err) {
              lastErr = err;
              // Only a missing chat is worth retrying elsewhere. A block or a
              // bad request means we found the right bot and it still failed.
              if (!((err && err.message) || "").includes("chat not found")) throw err;
            }
          }
          throw lastErr;
        })
        .then(
          () => {
            counts.sent++;
          },
          (err) => recordFailure(err, c, counts)
        )
    )
  );
}

/** Send to web customers via the CPCS webhook. */
async function sendWebBroadcast(customers, tenantId, pending, counts) {
  if (customers.length === 0) return;

  const webhookUrl = process.env.CHAT_WEBHOOK_URL;
  const webhookSecret = process.env.CHAT_WEBHOOK_SECRET || "";
  if (!webhookUrl) {
    counts.failed += customers.length;
    console.error(`[SubBot] broadcast skipped for ${customers.length} web customer(s): CHAT_WEBHOOK_URL not set`);
    return;
  }

  for (const c of customers) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": webhookSecret,
        },
        body: JSON.stringify({
          tenantId: tenantId.toString(),
          customerAlias: c.alias,
          text: pending.text,
          telegramFileId: pending.fileId || null,
          contentType: pending.fileId ? "image" : "text",
        }),
      });
      if (!res.ok) {
        counts.failed++;
        console.error(`[SubBot] broadcast webhook failed for ${c.alias}: ${res.status}`);
      } else {
        counts.sent++;
        console.log(`[SubBot] broadcast webhook sent for ${c.alias}`);
      }
    } catch (err) {
      counts.failed++;
      console.error(`[SubBot] broadcast webhook error for ${c.alias}:`, err.message);
    }
  }
}

/**
 * Handle broadcast_cancel callback query.
 */
async function handleBroadcastCancel(ctx, { tenantId }) {
  const callbackUserId = Number(ctx.match[1]);
  console.log(`[SubBot] broadcast_cancel callback received from user ${ctx.from.id}, tenant ${tenantId}`);

  if (ctx.from.id !== callbackUserId) {
    return ctx.answerCallbackQuery({ text: "Only the person who initiated the broadcast can cancel.", show_alert: true });
  }

  const key = `${tenantId}:${ctx.from.id}`;
  clearPending(key);
  await ctx.editMessageText("❌ Broadcast cancelled.");
  return ctx.answerCallbackQuery();
}

module.exports = { handleBroadcast, handleBroadcastConfirm, handleBroadcastCancel, pendingBroadcasts };

const { InlineKeyboard } = require("grammy");
const Customer = require("../../db/models/customer");

// Pending broadcast confirmations: key = `${tenantId}:${fromUserId}`, value = { text, fileId, fileType, timestamp }
const pendingBroadcasts = new Map();

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
  pendingBroadcasts.set(key, {
    text: text || null,
    fileId,
    fileType,
    timestamp: Date.now(),
  });
  console.log(`[SubBot] broadcastallusers: stored pending broadcast key=${key}, text="${(text || "").slice(0, 50)}", fileType=${fileType}, hasFile=${!!fileId}, pendingBroadcasts size=${pendingBroadcasts.size}`);

  // Expire after 5 minutes
  setTimeout(() => pendingBroadcasts.delete(key), 5 * 60 * 1000);

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
async function handleBroadcastConfirm(ctx, { tenantId, bot }) {
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

  pendingBroadcasts.delete(key);
  await ctx.answerCallbackQuery({ text: "Sending..." });

  const customers = await Customer.find({ tenantId, status: { $ne: "blocked" } });
  console.log(`[SubBot] broadcast_confirm: found ${customers.length} customers to message`);
  await ctx.editMessageText(`📤 Sending to ${customers.length} customer${customers.length === 1 ? "" : "s"}...`);

  const webhookUrl = process.env.CHAT_WEBHOOK_URL;
  const webhookSecret = process.env.CHAT_WEBHOOK_SECRET || "";

  let sent = 0;
  let blocked = 0;
  let failed = 0;
  for (const c of customers) {
    try {
      console.log(`[SubBot] broadcast: processing ${c.alias}, source=${c.source}, telegramUserId=${c.telegramUserId}`);
      if (c.source === "web") {
        if (!webhookUrl) {
          failed++;
          console.error(`[SubBot] broadcast skipped for web customer ${c.alias}: CHAT_WEBHOOK_URL not set`);
          continue;
        }
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
          failed++;
          console.error(`[SubBot] broadcast webhook failed for ${c.alias}: ${res.status}`);
        } else {
          sent++;
          console.log(`[SubBot] broadcast webhook sent for ${c.alias}`);
        }
      } else {
        if (pending.fileId) {
          if (pending.fileType === "photo") {
            await bot.api.sendPhoto(c.telegramUserId, pending.fileId, {
              caption: pending.text || "",
            });
          } else {
            await bot.api.sendDocument(c.telegramUserId, pending.fileId, {
              caption: pending.text || "",
            });
          }
        } else {
          await bot.api.sendMessage(c.telegramUserId, pending.text);
        }
        sent++;
      }
    } catch (err) {
      if (err.message.includes("403") || err.message.includes("bot was blocked")) {
        blocked++;
      } else {
        failed++;
      }
      console.error(`[SubBot] broadcast failed for ${c.alias} (${c.telegramUserId}):`, err.message);
    }
  }

  let summary = `✅ Broadcast complete: ${sent} sent`;
  if (blocked > 0) summary += `, ${blocked} blocked`;
  if (failed > 0) summary += `, ${failed} failed`;
  await ctx.editMessageText(summary);
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
  pendingBroadcasts.delete(key);
  await ctx.editMessageText("❌ Broadcast cancelled.");
  return ctx.answerCallbackQuery();
}

module.exports = { handleBroadcast, handleBroadcastConfirm, handleBroadcastCancel, pendingBroadcasts };

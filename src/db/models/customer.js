const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
  },
  telegramUserId: { type: Number, required: true },
  firstName: { type: String, default: null },
  lastName: { type: String, default: null },
  username: { type: String, default: null },
  alias: { type: String, required: true },
  threadId: { type: Number, default: null }, // topic message_thread_id
  status: { type: String, enum: ["open", "closed", "blocked"], default: "open" },
  source: { type: String, enum: ["telegram", "web"], default: "telegram" },
  externalUserId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

customerSchema.index({ tenantId: 1, telegramUserId: 1 }, { unique: true });
customerSchema.index({ tenantId: 1, alias: 1 }, { unique: true });
customerSchema.index({ tenantId: 1, threadId: 1 });

module.exports = mongoose.model("Customer", customerSchema);

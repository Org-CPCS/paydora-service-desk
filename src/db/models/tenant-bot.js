const mongoose = require("mongoose");

const tenantBotSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
  },
  botToken: { type: String, required: true, unique: true },
  botUsername: { type: String },
  status: {
    type: String,
    enum: ["active", "inactive", "removed", "pending"],
    default: "active",
  },
  createdAt: { type: Date, default: Date.now },
});

tenantBotSchema.index({ tenantId: 1, botToken: 1 }, { unique: true });

module.exports = mongoose.model("TenantBot", tenantBotSchema);

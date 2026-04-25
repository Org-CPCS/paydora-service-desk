const mongoose = require("mongoose");

const tenantSchema = new mongoose.Schema({
  botToken: { type: String, required: true, unique: true },
  botUsername: { type: String },
  agentGroupId: { type: Number, required: true },
  webhookUrl: { type: String, default: null },
  status: {
    type: String,
    enum: ["active", "inactive", "removed", "pending"],
    default: "active",
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Tenant", tenantSchema);

const mongoose = require("mongoose");

async function connect() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");
}

// Tenant schema — registered bot configurations
const tenantSchema = new mongoose.Schema({
  botToken: { type: String, required: true, unique: true },
  botUsername: { type: String },
  agentGroupId: { type: Number, required: true },
  status: {
    type: String,
    enum: ["active", "inactive", "removed"],
    default: "active",
  },
  createdAt: { type: Date, default: Date.now },
});

const Tenant = mongoose.model("Tenant", tenantSchema);

// Customer schema — maps telegram user to alias + topic (tenant-scoped)
const customerSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
  },
  telegramUserId: { type: Number, required: true },
  alias: { type: String, required: true },
  threadId: { type: Number, default: null }, // topic message_thread_id
  status: { type: String, enum: ["open", "closed"], default: "open" },
  createdAt: { type: Date, default: Date.now },
});

customerSchema.index({ tenantId: 1, telegramUserId: 1 }, { unique: true });
customerSchema.index({ tenantId: 1, alias: 1 }, { unique: true });
customerSchema.index({ tenantId: 1, threadId: 1 });

const Customer = mongoose.model("Customer", customerSchema);

// Counter for generating sequential aliases
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", counterSchema);

async function getNextAlias(tenantId, firstName) {
  const counter = await Counter.findByIdAndUpdate(
    `alias:${tenantId}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const name = firstName || "User";
  return `${name}-${counter.seq}`;
}

// Pre-provisioned empty groups — ready to be assigned to new tenants
const emptyGroupSchema = new mongoose.Schema({
  groupId: { type: Number, required: true, unique: true },
  botToken: { type: String, required: true },
  botUsername: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const EmptyGroup = mongoose.model("EmptyGroup", emptyGroupSchema);

module.exports = { connect, Tenant, Customer, EmptyGroup, getNextAlias };

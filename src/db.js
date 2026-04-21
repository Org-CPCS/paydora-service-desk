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
  webhookUrl: { type: String, default: null },
  status: {
    type: String,
    enum: ["active", "inactive", "removed", "pending"],
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
  createdAt: { type: Date, default: Date.now },
});

const EmptyGroup = mongoose.model("EmptyGroup", emptyGroupSchema);

// Cache of group members — maps username to user ID for @mention resolution
const groupMemberSchema = new mongoose.Schema({
  groupId: { type: Number, required: true },
  userId: { type: Number, required: true },
  username: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
});

groupMemberSchema.index({ groupId: 1, username: 1 }, { unique: true });
groupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true });

const GroupMember = mongoose.model("GroupMember", groupMemberSchema);

module.exports = { connect, Tenant, Customer, EmptyGroup, GroupMember, getNextAlias };

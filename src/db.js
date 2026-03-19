const mongoose = require("mongoose");

async function connect() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");
}

// Customer schema — maps telegram user to alias + topic
const customerSchema = new mongoose.Schema({
  telegramUserId: { type: Number, required: true, unique: true },
  alias: { type: String, required: true, unique: true },
  threadId: { type: Number, default: null }, // topic message_thread_id
  status: { type: String, enum: ["open", "closed"], default: "open" },
  createdAt: { type: Date, default: Date.now },
});

const Customer = mongoose.model("Customer", customerSchema);

// Counter for generating sequential aliases
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", counterSchema);

async function getNextAlias() {
  const counter = await Counter.findByIdAndUpdate(
    "customerAlias",
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `cust-${counter.seq}`;
}

module.exports = { connect, Customer, getNextAlias };

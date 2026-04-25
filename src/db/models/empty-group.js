const mongoose = require("mongoose");

const emptyGroupSchema = new mongoose.Schema({
  groupId: { type: Number, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("EmptyGroup", emptyGroupSchema);

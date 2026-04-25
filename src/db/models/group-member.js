const mongoose = require("mongoose");

const groupMemberSchema = new mongoose.Schema({
  groupId: { type: Number, required: true },
  userId: { type: Number, required: true },
  username: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
});

groupMemberSchema.index({ groupId: 1, username: 1 }, { unique: true });
groupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("GroupMember", groupMemberSchema);

const Counter = require("./models/counter");

async function getNextAlias(tenantId, firstName) {
  const counter = await Counter.findByIdAndUpdate(
    `alias:${tenantId}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const name = firstName || "User";
  return `${name}-${counter.seq}`;
}

module.exports = { getNextAlias };

// Record-shape validation used by the codec when decoding foreign change envelopes.
function validateRecord(r) {
  if (!r || typeof r.id !== "string" || !r.id) throw new Error("invalid record: id");
  if (typeof r.deleted !== "boolean") throw new Error("invalid record: deleted");
  if (!r.deleted && typeof r.text !== "string") throw new Error("invalid record: text");
  if (!r.rev || typeof r.rev.ts !== "number" || typeof r.rev.replica !== "string") throw new Error("invalid record: rev");
  return r;
}
module.exports = { validateRecord };

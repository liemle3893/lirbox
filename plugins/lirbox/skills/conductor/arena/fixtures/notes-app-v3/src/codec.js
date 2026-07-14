// Versioned change-envelope codec. An envelope is what one replica exports for others:
//   { version: 3, replica: <origin id>, clock: <origin clock at export>, records: [...] }
const { validateRecord } = require("./validate");

const VERSION = 3;

function encode(replica) {
  return {
    version: VERSION,
    replica: replica.id,
    clock: replica.clock.now(),
    records: JSON.parse(JSON.stringify(replica.store.records())),
  };
}

function decode(envelope) {
  if (!envelope || envelope.version !== VERSION) throw new Error("unsupported version");
  if (!Array.isArray(envelope.records)) throw new Error("invalid change set");
  for (const r of envelope.records) validateRecord(r);
  return envelope;
}

module.exports = { VERSION, encode, decode };

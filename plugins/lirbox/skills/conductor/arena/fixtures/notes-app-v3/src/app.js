// File-backed entrypoint: load the replica snapshot (if the file exists), run one CLI command,
// save the snapshot back. The replica id is fixed at first use and persists in the snapshot.
const fs = require("fs");
const { Replica } = require("./replica");
const { NoteService } = require("./service");
const { run } = require("./cli");
const { saveSnapshot, loadSnapshot } = require("./snapshot");

function main(argv, file, replicaId = "local") {
  const replica = fs.existsSync(file) ? loadSnapshot(file) : new Replica(replicaId);
  const svc = new NoteService(replica);
  const result = run(argv, svc);
  saveSnapshot(replica, file);
  return result;
}
module.exports = { main };

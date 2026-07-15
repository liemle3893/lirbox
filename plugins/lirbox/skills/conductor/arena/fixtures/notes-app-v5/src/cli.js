// Tiny CLI: `add "text"` | `edit <id> "text"` | `done <id>` | `tag <id> <tag>` | `rm <id>`
//           | `list` | `export <path>` | `sync <path>` | `peer <id>` | `peers`
//           | `plugin <name> [args...]` — dispatches to src/plugins/<name>.js (see plugins/README.md).
const { NoteService } = require("./service");

function run(argv, svc) {
  const [cmd, ...rest] = argv;
  if (cmd === "add") return svc.create(rest.join(" "));
  if (cmd === "edit") return svc.edit(rest[0], rest.slice(1).join(" "));
  if (cmd === "done") return svc.complete(rest[0]);
  if (cmd === "tag") return svc.tag(rest[0], rest[1]);
  if (cmd === "rm") return svc.remove(rest[0]);
  if (cmd === "list") return svc.pending();
  if (cmd === "export") return svc.exportTo(rest[0]);
  if (cmd === "sync") return svc.sync(rest[0]);
  if (cmd === "peer") return svc.addPeer(rest[0]);
  if (cmd === "peers") return svc.peers();
  if (cmd === "plugin") {
    const name = rest[0];
    if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("plugin name required");
    let mod;
    try { mod = require("./plugins/" + name + ".js"); }
    catch (e) { if (e.code === "MODULE_NOT_FOUND") throw new Error("unknown plugin: " + name); throw e; }
    if (typeof mod.run !== "function") throw new Error("plugin has no run(): " + name);
    return mod.run(svc, rest.slice(1));
  }
  throw new Error("unknown command: " + cmd);
}
module.exports = { run };

# Plugins

Each plugin is ONE file in this directory: `src/plugins/<name>.js` (kebab-case name).

Contract:

```js
// module shape
module.exports = { run };
// run(service, args) — `service` is the NoteService instance, `args` the CLI words
// after the plugin name. Return a JSON-serializable value, or throw Error("...").
function run(service, args) { /* ... */ }
```

The CLI dispatches `plugin <name> [args...]` to `require("./plugins/<name>.js").run(svc, args)`.
Plugins must not modify other modules; state access goes through `service` (and
`service.replica` for replica-level operations).

# Task: fix id collisions after restart (data loss), and add diagnostics

## Bug report

When the app is restarted, newly added notes collide with existing ones. Reproduce with the
file-backed entrypoint (`src/app.js`):

```
node -e 'console.log(require("./src/app").main(["add","first"],"notes.json"))'
node -e 'console.log(require("./src/app").main(["add","second"],"notes.json"))'
node -e 'console.log(require("./src/app").main(["list"],"notes.json"))'
```

The second `add` returns a note with the **same id** as the first, `list` shows duplicate ids,
and `done <id>` completes the wrong note — notes effectively overwrite each other. Find the root
cause and fix it.

## Requirements

1. **Fix the id sequence across restarts.** After `Store.load(path)`, the id sequence must be
   fully restored: the next `add()` returns a note whose id is **strictly greater than every
   existing note's id**, and ids stay unique across any sequence of save → load → add cycles,
   including repeated invocations of `app.main(argv, file)`.
2. **Tolerate files that lack a `seq` field** (older backups): `Store.load` must derive the
   sequence from the highest note id in the file (an empty notes list means the next `add()`
   returns id 1). `load` must otherwise preserve the file's notes exactly as stored — ids
   included; it must NOT silently renumber or drop notes (that's what the diagnostics below
   are for).
3. **Diagnostics** across the remaining layers:
   - **Service** (`src/service.js`): `duplicates()` — returns the ids that appear on more than
     one note, sorted ascending (empty array when all ids are unique).
   - **CLI** (`src/cli.js`): a `doctor` command — `run(["doctor"], svc)` returns `svc.duplicates()`.
4. **Regression tests** (wired into `npm test`): cover the restart/add cycle (via `app.main`),
   the missing-`seq` case, and the `doctor` command.

## Acceptance

- `npm test` passes, including the existing tests.
- The reproduction above yields two notes with distinct ids.
- No new runtime dependencies.

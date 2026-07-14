# Task: add import/export (portable backups) to notes-app

Deliver an end-to-end import/export feature that spans every layer of the app (store → service → cli),
with tests. The subtle part is id handling on import: imported notes must be RE-NUMBERED by the
receiving store so they can never collide with existing notes.

## Requirements

1. **Store** (`src/store.js`):
   - `exportNotes()` — returns `{ version: 1, notes }` where `notes` is a **deep copy** of all
     notes (mutating the returned object must not affect the store).
   - `importNotes(data)` — validates then merges:
     - throws `Error("unsupported version")` unless `data.version === 1`;
     - throws `Error("invalid notes")` unless `data.notes` is an array;
     - each imported note is assigned a **new id from the receiving store's own id sequence**
       (import order preserved), keeping its `text` and `done` values — ids carried inside
       `data.notes` are ignored, so imports can never collide with existing notes;
     - returns the array of imported notes (carrying their new ids);
     - after an import, `add()` must keep producing unique ids (no collision with imported or
       pre-existing notes).
2. **Service** (`src/service.js`):
   - `backup(path)` — writes `JSON.stringify(store.exportNotes())` to `path`, returns the number
     of notes exported;
   - `restore(path)` — reads and parses the file at `path`, passes it to `importNotes`, returns
     the number of notes imported.
3. **CLI** (`src/cli.js`): `export <path>` → returns `svc.backup(path)`; `import <path>` →
   returns `svc.restore(path)`.
4. **Tests** (`test/run.js` or a new test file wired into `npm test`): cover the export shape,
   the deep-copy guarantee, id re-numbering on import (including importing into a non-empty
   store), both validation errors, `done`-flag preservation, and the CLI commands.

## Acceptance

- `npm test` passes, including the existing tests (do not break `create`/`complete`/`pending`/`list`).
- All layers are touched; a backup made with `export` restores cleanly with `import` end-to-end.
- No new runtime dependencies.

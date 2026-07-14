# Task: add archiving to notes-app

Deliver an end-to-end feature that spans every layer of the app (store → service → cli), with tests.

## Requirements

1. **Store** (`src/store.js`): notes carry an `archived` boolean (default `false`). Add `archive(id)`
   and `unarchive(id)` methods. `save`/`load` must round-trip the archived flag.
2. **Service** (`src/service.js`): `archive(id)` and `unarchive(id)` delegating to the store (throwing
   on unknown id); `pending()` must now EXCLUDE archived notes (in addition to completed ones);
   `archived()` returning all archived notes.
3. **CLI** (`src/cli.js`): `archive <id>`, `unarchive <id>`, and `archived` commands wired to the service.
4. **Tests** (`test/run.js` or a new test file wired into `npm test`): cover archive/unarchive, pending
   exclusion, `archived()` listing, save/load round-trip of the flag, and the new CLI commands.

## Acceptance

- `npm test` passes, including the existing tests (do not break `create`/`complete`/`pending`/`list`).
- All four layers are touched; the feature is usable end-to-end via the CLI.
- No new runtime dependencies.

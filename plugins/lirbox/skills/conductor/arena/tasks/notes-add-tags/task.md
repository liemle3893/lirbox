# Task: add tagging + stats to notes-app

Deliver an end-to-end feature that spans every layer of the app (store → service → cli), with tests.

## Requirements

1. **Store** (`src/store.js`): notes carry an optional `tags` array (default `[]`). `save`/`load` must
   round-trip tags. Add `addTag(id, tag)` / `removeTag(id, tag)` (no duplicate tags; ignore removing an
   absent tag).
2. **Service** (`src/service.js`): `tag(id, tag)` and `untag(id, tag)` delegating to the store (throwing
   on unknown id); `byTag(tag)` returning all notes carrying that tag; `stats()` returning an object of
   `{ tag: count }` across all notes.
3. **CLI** (`src/cli.js`): `tag <id> <tag>`, `bytag <tag>`, and `stats` commands wired to the service.
4. **Tests** (`test/run.js` or a new test file wired into `npm test`): cover add/remove tag, no-duplicate,
   `byTag`, `stats` counts, save/load round-trip of tags, and the new CLI commands.

## Acceptance

- `npm test` passes, including the existing tests (do not break `create`/`complete`/`pending`/`list`).
- All four layers are touched; the feature is usable end-to-end via the CLI.
- No new runtime dependencies.

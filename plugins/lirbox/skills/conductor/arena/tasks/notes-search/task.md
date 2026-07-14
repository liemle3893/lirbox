# Task: add search to notes-app

Deliver an end-to-end search feature that spans every layer of the app (store → service → cli), with tests.

## Requirements

1. **Store** (`src/store.js`): `search(query)` — returns all notes whose `text` contains `query`
   **case-insensitively**, ordered by ascending `id`. Throws `Error("query required")` when `query`
   is missing or an empty string.
2. **Service** (`src/service.js`): `find(query, opts = {})` with options
   `{ includeDone = false, page = 1, pageSize = 10 }`:
   - filters `store.search(query)` to EXCLUDE completed notes unless `includeDone` is `true`;
   - returns `{ results, total, page }` where `total` is the count of ALL matches after the
     done-filter (across all pages, unaffected by pagination) and `results` is the requested
     page slice (pages are 1-based, `pageSize` items per page);
   - throws `Error("invalid page")` if `page` is less than 1 or not an integer.
3. **CLI** (`src/cli.js`): `search <word...>` — joins the remaining arguments with single spaces
   as the query and returns `svc.find(query).results`.
4. **Tests** (`test/run.js` or a new test file wired into `npm test`): cover case-insensitive
   matching, id ordering, the empty-query error, done-filtering, pagination (`total` vs page
   slicing, the `invalid page` error), and the CLI command.

## Acceptance

- `npm test` passes, including the existing tests (do not break `create`/`complete`/`pending`/`list`).
- All layers are touched; the feature is usable end-to-end via the CLI.
- No new runtime dependencies.

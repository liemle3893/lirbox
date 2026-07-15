# Ship eight independent plugins for the notes platform

This repository is a sync-capable multi-replica notes app. It has a **plugin system**: the CLI
command `plugin <name> [args...]` dispatches to `src/plugins/<name>.js` — see
`src/plugins/README.md` for the exact contract (`module.exports = { run }`,
`run(service, args)` returns a JSON-serializable value or throws `Error`). No plugins ship yet.

Deliver the **eight plugins below**. They are fully independent of each other — each is exactly
one new file `src/plugins/<name>.js`. Do not modify any existing module. `npm test` must stay
green. Every behavior below is asserted exactly as written; "sorted" always means ascending
lexicographic order unless stated otherwise.

Shared vocabulary: a **live** record is one with `deleted: false`; a **tombstone** has
`deleted: true`. `service.replica.store.records()` returns all records (including tombstones),
`service.list()` returns live ones. A record is `{ id, text, done, tags, deleted, rev }`.

## 1. `stats` — store statistics

`plugin stats` (no arguments; any argument → `Error("stats takes no arguments")`).
Returns an object:

- `total` — all records including tombstones; `live` — non-deleted; `deleted` — tombstones;
  `pending` — live with `done: false`; `done` — live with `done: true`.
- `tags` — object mapping tag → number of LIVE records whose `tags` array includes it (a record
  counts once per tag even if the tag appears twice in its array); keys in sorted order.
- `replicas` — object mapping replica id (the id portion before the LAST `-` of each live
  record's `id`) → count of live records; keys sorted.
- `clock` — the current value of `service.replica.clock.now()`.

## 2. `find` — ranked text search

`plugin find <query> [--tag <t>] [--limit <n>] [--offset <n>]` over LIVE records.

- Case-insensitive substring match on `text`. Empty/missing query → `Error("query required")`.
- `--tag t` keeps only records whose `tags` include `t` exactly.
- Order: by the index of the first match in the lowercased text (ascending), ties by `id` sorted.
- `--limit` default 10; `--offset` default 0. Non-integer or negative values →
  `Error("invalid limit")` / `Error("invalid offset")`. Limit greater than 100 →
  `Error("limit too large")`.
- Returns `{ total, items }` — `total` is the match count BEFORE limit/offset; `items` is the
  page, each item `{ id, text, done, tags }`.

## 3. `export-md` — Markdown export

`plugin export-md <path>` (missing path → `Error("path required")`). Writes a Markdown file:

- First line `# Notes`.
- One `## <tag>` section per tag that occurs on live records, sections in sorted tag order;
  under each, every live note carrying that tag as `- [ ] <text>` (or `- [x] <text>` when done),
  notes sorted by id. A note with several tags appears in each of its tags' sections.
- Live notes with NO tags go in a final section `## (untagged)` (always last, present only if
  needed).
- In note text, escape each of `` ` ``, `*`, `_`, `[`, `]`, `\` with a leading backslash.
- Returns the number of DISTINCT live notes written. An empty store writes exactly `# Notes\n`
  and returns 0.

## 4. `dedupe` — merge duplicate notes

`plugin dedupe` (no arguments). Normalization: trim the text, collapse every internal whitespace
run to a single space, lowercase. Live records with equal normalized text form a group.

- For each group with 2+ members: the KEEPER is the member with the lowest id. The keeper's
  `tags` become the sorted, deduplicated union of the whole group's tags; every other member is
  removed via `service.remove(id)` (they become tombstones).
- Returns an array `[{ kept, removed, text }]` — `removed` sorted, `text` the normalized text —
  sorted by `kept`. Groups of one are untouched and unreported.
- Running it again immediately returns `[]` (idempotent). All mutations must go through the
  service/replica so revisions are stamped.

## 5. `import-csv` — CSV import

`plugin import-csv <path>` (missing path → `Error("path required")`).

- The file's first line must be exactly the header `text,tags` → otherwise `Error("bad header")`.
- Records: comma-separated, two fields per row. A field may be double-quoted; inside a quoted
  field `""` is a literal quote and commas/newlines are literal. An unterminated quote or a row
  with a field count other than 2 → `Error("bad row <n>")` where `<n>` is the 1-based line number
  counting the header as line 1.
- `tags` field: semicolon-separated tag list; empty entries are skipped; tags are applied in
  listed order via `service.tag` after creating the note with `service.create(text)`.
- Rows are imported in order. Returns `{ created, ids }` with `ids` in row order. A file with
  only the header returns `{ created: 0, ids: [] }`.

## 6. `lint` — store consistency report

`plugin lint` (no arguments). Checks every record and returns `[{ id, code }]` sorted by id,
then code:

- `E1` — live record whose `text` is empty or whitespace-only.
- `E2` — live record whose `tags` array contains the same value twice.
- `E3` — any record with both `done: true` and `deleted: true`.
- `E4` — any record whose `rev.replica` is neither the local `service.replica.id` nor an id in
  `service.replica.peers.known()`.
- `E5` — any record whose `id` does not match `/^.+-\d+$/`.

A clean store returns `[]`. A record can appear once per violated code.

## 7. `archive-tag` — bulk-complete by tag

`plugin archive-tag <tag>` (missing tag → `Error("tag required")`).

- If NO live record carries the tag → `Error("unknown tag: <tag>")`.
- Every live PENDING record whose `tags` include the tag is completed via
  `service.complete(id)`. Already-done records are untouched and unreported.
- Returns `{ archived }` — the completed ids, sorted. If the tag exists only on done records,
  returns `{ archived: [] }` (no error).

## 8. `snapshot-diff` — compare two store snapshots

`plugin snapshot-diff <pathA> <pathB>` (fewer than two args → `Error("two paths required")`).
Both files are store snapshots as written by `Store.save` (`{ version: 3, records }`); any other
`version` → `Error("unsupported version")`.

- `added` — ids present in B but not A, sorted. `removed` — ids in A but not B, sorted.
- `changed` — ids present in both where any of `text`, `done`, `tags` (order-sensitive), or
  `deleted` differ: `[{ id, fields }]` sorted by id, `fields` the sorted list of differing field
  names among those four. Differences ONLY in `rev` do not count.
- Returns `{ added, removed, changed }`.

## Deliverable

Eight new files under `src/plugins/`, nothing else changed, `npm test` green. Each plugin is
graded through the CLI dispatcher (`plugin <name> ...`) against the behaviors above.

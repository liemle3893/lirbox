# `parts.json` schema

Default location `.test-scope/parts.json`; any file via `--config <path>`. Plain JSON; keys starting
with `_` are comments and are ignored. A config may `"extends": "<path>"` another (path relative to the
extending file): top-level keys override, `packages` and `parts` merge by name.

```json
{
  "base": "main",
  "packages": {
    "server": { "dir": "server", "runner": "vitest", "testGlobs": ["src/**/*.test.ts", "test/**/*.test.ts"],
                "exclude": ["**/*.live.test.ts"], "wrapper": "scripts/heavy.sh" },
    "web":    { "dir": "web", "runner": "vitest" }
  },
  "noTests": ["docs/**", "**/*.md", "deploy/**"],
  "runAll":  ["server/vitest.config.ts", "pnpm-lock.yaml"],
  "graphOnly": { "server": ["test/util/**"] },
  "parts": {
    "db": {
      "description": "Migrations and every domain test that queries the touched tables",
      "paths":  ["server/migrations/**", "!server/migrations/README.md"],
      "tests":  { "server": ["test/migrations/**/*.test.ts", "test/domains/**/*.test.ts"] },
      "checks": ["server:typecheck"]
    }
  }
}
```

## Fields

| Field | Meaning |
|---|---|
| `base` | Branch `select --changed` takes the merge-base with when no base is given (default: `origin/main`, `main`, `master`). |
| `packages` | `name: {dir, runner, testGlobs, exclude?, cmd?, wrapper?, relatedCmd?}`. Omitted: one package `root` at `.`, runner guessed from `package.json` / `pyproject.toml` / `go.mod`. |
| `packages.*.dir` | Package directory relative to the repo root. A file belongs to the package with the longest matching `dir`. Test globs and a part's `tests` are relative to it. |
| `packages.*.runner` | `vitest`, `jest`, `pytest`, `go`, `custom` (uses `relatedCmd` + `cmd`), or `none` (parts only). Anything else: parts only, with a warning. See `adapters.md`. |
| `packages.*.testGlobs` | Which files are test files. Defaults per runner (`**/*.test.*`, `test_*.py`, `*_test.go`). |
| `packages.*.exclude` | Test globs that count for coverage but never run (live/network suites). Never selected, not even by `runAll`. |
| `packages.*.cmd` | Replaces the runner binary prefix (`"pnpm exec vitest"`), or is a full template when it contains `{related}` / `{tests}` / `{files}`. |
| `packages.*.wrapper` | Command prefix for every runner invocation of the package (lock / nice script). A relative first word that exists under the repo root is made absolute. |
| `packages.*.relatedCmd` | `custom` runner only. Run in the package dir with the changed sources appended (or at `{files}`); prints `test` lines, or `source<TAB>test` pairs. |
| `noTests` | Globs (repo-root) for changed files that need no test (docs, deploy, assets). A part hit also covers a file. Without either, a changed file with no related test makes selection exit 3. |
| `runAll` | Globs whose change selects every non-excluded test. Keep short (runner config, DB bootstrap, auth schema, lockfiles). A package manifest triggers run-all only when its dependency fields changed (`package.json` dependency maps, `go.mod` requires; the whole file for `pyproject.toml`, `requirements*.txt`, `Pipfile`, `Cargo.toml`), even if a glob names it. |
| `graphOnly` | `{package: [test globs]}` — test files owned by no part on purpose: the import graph alone reaches them. `coverage` accepts them as owned. |
| `parts.*.paths` | Repo-root source globs whose change requires the part. `!glob` excludes win over any positive glob. |
| `parts.*.tests` | `{package: [test globs]}` relative to each package. Msn-workbook shape accepted: a top-level `"server": [...]` key on the part when `server` is a package. A list instead of a map works only with a single package. |
| `parts.*.checks` | Run once after the tests. `<package>:<script>` runs `pnpm|yarn|npm run <script>` in that package; anything else is a command line run at the repo root. |
| `parts.*.description` | Why the part exists; shown by `select --list` and kept in the OCR `Test parts:` reasoning. |

## Glob syntax

`**` (any directories, `**/` may match none), `*` (within one segment), `?`, `{a,b}` (nesting works
here, but OCR does not support it, see `adapters.md`), leading `!` for exclusions in `paths`. No
character classes. Matching is against repo-root-relative POSIX paths (package-relative for tests).

## Semantics worth knowing

- Several parts may own one file; the union runs.
- A changed test file selects itself and counts as its owning part's.
- Selected tests = import-graph related tests ∪ matched parts' tests ∪ changed test files. Parts never replace the graph.
- Uncovered (exit 3): a changed source with no related test, no matching part and no `noTests` glob; a deleted file with no part hit; a source outside every package with no part.

## `.test-scope/rules.source.json` (optional, OpenCodeReview)

`{ _comment?, include, exclude, testPartsFooter?, rules: [{ path, rule, testParts? }] }`. `rules --write`
emits `.opencodereview/rule.json` with one appended line `Test parts: a,b` per rule: the parts whose `paths`
intersect the rule's `path`. A rule with an explicit `testParts` uses it verbatim (a bare comma list is
validated against the known parts); a rule no part intersects and has no `testParts` is an error.
`rules --check` fails when the file is stale, a part is unknown, or a rule has no parts.

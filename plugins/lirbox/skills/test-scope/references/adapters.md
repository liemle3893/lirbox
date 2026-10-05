# Stack adapters and their limits

One adapter per `packages.*.runner`. Each answers two questions: which test files does the import
graph relate to the changed sources (**resolve**), and what single command runs the selection (**run**).
Changed sources are passed relative to the package dir. Parts are always added on top of the graph.

| Runner | Run command (one per package) | List mode (`select --list`, `replay`) |
|---|---|---|
| `vitest` | `<pm> vitest related --run <every changed source> <part/changed test files>`; with no changed source, `vitest run <files>` | **Resolved at run time** by default: `vitest related` has no list form (`vitest list --filesOnly` ignores `related`). `--resolve` runs `scripts/vitest_related.mjs`, which loads the package's own `vitest/node` and asks `getRelevantTestSpecifications` per source (starts a vitest instance per source; heavy, wrap it). |
| `jest` | `<pm> jest --findRelatedTests <sources> <test files>` | Resolved at run time; `--resolve` runs `jest --listTests --findRelatedTests <sources>` (set level). |
| `pytest` | `python3 -m pytest <test files>` | Resolved: `scripts/py_related.py` (AST reverse-import graph, stdlib only). |
| `go` | `go test <package dirs>` | Resolved: `go list -deps -test -json ./...`, reverse closure over imports, plus test-only importers. |
| `custom` | `cmd` template (`{files}` default) | Resolved via `relatedCmd`; without one every source is uncovered unless a part hits. |
| `none` / unknown | no runner command | Parts only; unknown runner adds a warning. |

`<pm>` is `pnpm exec` when a `pnpm-lock.yaml` is found at or above the package, `yarn` for `yarn.lock`,
else `npx --no-install`; override with `packages.*.cmd`. `wrapper` prefixes every invocation.

## What "resolved at run time" costs

When list mode cannot resolve (vitest/jest without `--resolve`), `select --list` shows the parts' tests
and the sources handed to the runner, and **cannot** report an uncovered source: `vitest related` simply
finds nothing for it, and without `--passWithNoTests` the run fails with "no test files found". Use
`--resolve` when you need the exit-3 guarantee or exact counts before running. `replay` marks such commits
`+` (lower bound: parts only) because resolving N commits would start N runners.

`replay` and `misses` resolve the graph against the **checked-out tree**, not each historical commit;
sources deleted since are skipped. Treat counts for old commits as estimates.

## Limits (what the graph cannot see)

- **vitest/jest**: only the module graph the runner builds. String-keyed links, SQL, config, fixtures, `import(variable)`: parts (`hidden-links.md`).
- **pytest**: static `import` / `from` statements only (relative imports resolved; `src/` and `lib/` layouts understood). Not seen: `importlib` / `__import__` with computed names, entry-point plugins, `conftest` fixtures that load data files. A changed `conftest.py` selects every test below its directory. Namespace packages without `__init__.py` still resolve by path.
- **go**: package granularity; a changed file selects the tests of its package, of every package that transitively imports it, and of packages whose tests import it. Build tags, `go:embed` files, `plugin.Open`, generated code outside `./...` are not seen. Needs a working `go` and module cache.
- **Monorepos**: one package entry per runner root; a file belongs to the deepest `dir` that contains it. A file outside every package selects nothing on its own: give it a part or `noTests`.
- **Dependency edits** run everything (`runAll`), not the graph.

## OpenCodeReview (`rules`)

OCR path globs do **not** support nested braces: write `{a,b}` groups side by side, never `{a,{b,c}}`.
The generator itself expands nesting, but a rule `path` with a nested group will not match in OCR and the
rule silently never fires. `.opencodereview/rule.json` is generated: edit `.test-scope/rules.source.json`
and re-run `rules --write`; CI runs `rules --check`.

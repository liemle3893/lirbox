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

## Coverage (`changecov`) and import chains (`trace`, `hubs`, `graphCuts`)

| Runner | `changecov` runs the selection with | Coverage file | `trace` / `hubs` / `graphCuts` graph |
|---|---|---|---|
| `vitest` | `--coverage.enabled --coverage.provider=v8 --coverage.reporter=json --coverage.include=<changed>` (needs `@vitest/coverage-v8`) | istanbul `coverage-final.json` | esbuild metafile via `scripts/esbuild_graph.mjs`, using the package's own `esbuild` (a vite dependency, usually resolvable); not resolvable -> "not measurable", exit 4 |
| `jest` | `--coverage --coverageReporters=json --collectCoverageFrom=<changed>` | istanbul | same as vitest |
| `pytest` | `--cov=. --cov-report=json:<file>` (needs `pytest-cov`) | coverage.py json | `py_related.py` in `edges` mode (static imports) |
| `go` | `go test -coverprofile=<file> <pkg dirs>` | coverprofile | `go list -deps -test`: nodes are package dirs plus test files |
| `custom` | `packages.*.coverage` (`file`, `format`, optional `cmd` with `{out}`) | any of the four formats, lcov included | none |

No coverage support for a runner = `not measurable` (exit 4), never a pass. Function-level reading
(`changecov`, `mutate`) covers JS/TS, Python and Go sources only; other changed files are listed as
"not measured". Function detection is lexical (strings, comments and regex literals blanked, braces or
indentation matched): a function it misses shows up as "not mutable", a false positive as an
`INCONCLUSIVE` mutant (the run failed without the marker), never as a pass. `mutate` edits the working
tree: it refuses uncommitted target files without `--allow-dirty` and restores through `finally`,
signal handlers and a journal in the git dir that the next run replays; it never overwrites a file
something else changed meanwhile (the original stays in the journal).

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
- **Monorepos**: one package entry per runner root; a file belongs to the deepest `dir` that contains it. A file outside every package selects nothing on its own: give it a part or `noTests`. Workspace dependents: next section.
- **Dependency edits** run everything (`runAll`), not the graph.

## Workspace monorepos (dependents and prebuild)

Detected from `pnpm-workspace.yaml` `packages:`, `package.json` `workspaces` (array or `{packages}`) or
`lerna.json` `packages` (`!` globs exclude). Edges come from `dependencies`, `devDependencies`,
`peerDependencies` and `optionalDependencies` naming another workspace package (`workspace:*`, `workspace:^`,
or a plain version; `npm:`/`file:`/`link:`/git specs are not edges). `"workspace": false` turns it off.

A changed source in package P is also handed to every **transitive** dependent D that has a `packages` entry
and at least one non-excluded test. How D sees P decides what it gets (`select --list` reason in brackets):

| D sees P through | Detected by | D's lookup gets | Prebuild |
|---|---|---|---|
| sources (`via src`) | a `vitest`/`vite`/`jest` config in D naming P and `src` (alias, moduleNameMapper); tsconfig `paths` only when that config uses `vite-tsconfig-paths` / `pathsToModuleNameMapper`; or P's exports/main all point at `.ts` / `src/` | the changed file, relative to D | no |
| build output (`via dist`) | P's exports/main/module point anywhere else | P's runtime entry files (exports leaves except `types`, `main`, `module`): every D test importing P | P is built first |
| cannot tell (`via name scan`) | P has no exports/main, or D's runner has no related lookup (`none`, `custom` without `relatedCmd`) | D's tests whose local import closure imports P, or a package between P and D, by name | yes, if dist |

A dependent no test of which reaches P says so (`warning: dependent D of P ... none selected`); a dependent
without a `packages` entry is a warning in `select` and `UNCONFIGURED` in `coverage`. Dependent tests also
cover P's changed file for the exit-3 rule.

**Prebuild order in `run`:** changed upstreams consumed via dist (dependencies first), then
`packages.*.prebuild`, then `parts.*.prebuild`; all before any tests, one at a time, through the package's
`wrapper`. A failed step marks the packages it guards `not run` and `run` exits 1; P's own tests (sources)
still run. `checks` still run after the tests. Default command per package manager, `{name}` / `{dir}`
substituted, overridable with `workspace.prebuild`: pnpm `pnpm --filter {name} build`, yarn
`yarn workspace {name} build`, npm `npm run build --workspace {name}`, bun `bun run --filter {name} build`.
A package with no `build` script is not built (warning: its dependents test whatever its dist holds).

**Limits.** Entry-level, not file-level: a dist consumer selects every test importing P, not only those
reaching the changed module. A transitive dependent that bundles P into its own dist would need its own
rebuild (not detected). `changecov` and `mutate` do not prebuild, so a dist consumer's tests measure the last
build; judge P's change by P's own tests there. `doctor` warns (`stale-build risk`) for every package whose
dependents see it via dist: a bare runner call there tests a stale build. Prefer a source alias in the
dependents' runner config when the build is slow.

## OpenCodeReview (`rules`)

OCR path globs do **not** support nested braces: write `{a,b}` groups side by side, never `{a,{b,c}}`.
The generator itself expands nesting, but a rule `path` with a nested group will not match in OCR and the
rule silently never fires. `.opencodereview/rule.json` is generated: edit `.test-scope/rules.source.json`
and re-run `rules --write`; CI runs `rules --check`.

# Hidden links — what an import graph cannot see

Walk each class against the repo during `init`, and again in `improve` when a miss has no obvious
cause. For each: the **signal** to grep for, the **consumers** to look for, and what the part
usually contains. Confirm with evidence (`file:line`) before writing a glob; an unconfirmed class
is noise.

| Class | Signal in the diff | Hidden consumers | Usual part content |
|---|---|---|---|
| DB schema | migrations, schema files, ORM models | raw SQL / query builders naming the table or column; generated DB types; seed data | migration tests + every domain test that touches the table (grep the table name) |
| API contract | shared types, OpenAPI/proto, route manifests | generated handlers/clients, fakes/mocks, contract or snapshot tests | typecheck + contract checks + both sides' tests |
| Codegen | generator inputs, templates | generated files (often excluded from review), their importers | regenerate-and-diff check + importers' tests |
| Fixtures / seed | fixture JSON/YAML, seed scripts, exported test data | tests that compare against the fixture, apps that load it at startup | the comparing tests (grep the fixture's ids) |
| String-keyed identifiers | i18n keys, error codes, audit/event names, feature flags, permission names | code and tests comparing the literal string; translation files; dashboards | the asserting tests + key-consistency checks |
| Config / env | config schema, env var names, defaults | `.env*`, compose/k8s manifests, launch scripts, CI env | config tests; flag deploy files for manual smoke (no unit test) |
| Authz model | policy files, relation schemas | permission-matrix tests, seeders of relationships | authz/permission suite |
| Serialized formats | file parsers/writers, wire formats, caches | stored data, eval/golden sets, previews, other services reading the format | golden/eval tests + readers' tests |
| Runtime registration | plugin/tool registries, DI containers, routers built by convention, reflection | anything resolved by name at runtime | the registry's tests + an end-to-end smoke |
| Dynamic imports | `import()`, `require(variable)`, `importlib`, `plugin.Open` | modules loaded by computed path | tests of the loader + the loaded modules |
| Shared test infra | test helpers, global setup, test DB bootstrap, mocks | every test using them (often via config, not import) | usually a run-everything trigger — keep the list short |
| Infra / scripts | Dockerfiles, compose, CI, shell scripts | no unit tests | `noTests` + a named manual/smoke check, never silence |
| Cross-language | a TS type mirrored in Go/Python, a SQL view used by another service | the other language's code | parts spanning both packages |

## Hubs (the opposite problem)

A module imported nearly everywhere (`config`, `db`, `types`, `ids`, a utils barrel) makes the import
graph select almost the whole suite. Options, in order of preference:
1. A **type-only** change is proven by the typechecker; route it to `checks`, not to tests.
2. Split the hub so most importers depend on a stable slice.
3. Accept it as a run-everything trigger and say so — a broad selection that is honest beats a
   narrow one that skips.

## Run-everything triggers that are usually too broad

- Any edit to a package manifest → restrict to dependency fields.
- Any edit to the test runner config → restrict to fields that change which tests or how they run.
- Lockfiles → only when the resolved versions of runtime/test dependencies changed.

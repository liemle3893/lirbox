#!/usr/bin/env node
// Runnable self-check for intake.mjs + hooks/route-guard.sh. Offline, no key, no framework.
//
//   node intake-selfcheck.mjs
//
// Paths are resolved RELATIVE TO THIS FILE on purpose: copy plugins/lirbox/ somewhere, mutate
// the copy, run the copy's self-check, and it exercises the mutated code. That is how the
// mutation table in the report was produced, and it is the only reason a green run here means
// anything — an assertion nothing can turn red is not measuring, it is decorating.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUESTIONS } from './intake.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const INTAKE = join(HERE, 'intake.mjs')
const GUARD = join(HERE, '..', 'hooks', 'route-guard.sh')
const tmp = mkdtempSync(join(tmpdir(), 'intake-selfcheck-'))

// A server that accepts and never answers, so a timeout is a real timeout rather than a
// connection refused that a retry could mask.
const server = createServer(() => {})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const HANGING = `http://127.0.0.1:${server.address().port}/api/v1/systemone`

const results = []
const check = (name, fn) => {
  try { fn(); results.push([name, 'PASS', '']) }
  catch (e) { results.push([name, 'FAIL', e.message.split('\n').slice(0, 3).join(' / ')]) }
}

// --- intake.mjs ------------------------------------------------------------

// Keys come from intake's own QUESTIONS, so renaming one there cannot leave a fixture that
// silently stops matching and passes as a "fallback".
const K = Object.keys(QUESTIONS)
const fixture = (name, { choice, routeConf, done, cap }) => {
  const p = join(tmp, `fx-${name}.json`)
  writeFileSync(p, JSON.stringify({
    model: 'typesafe/jev-1.13-fixture',
    answers: {
      [K[0]]: { type: 'choice', choice, probabilities: { [choice]: routeConf }, confidence: routeConf },
      [K[1]]: { type: 'noul', noul: done },
      [K[2]]: { type: 'noul', noul: cap },
    },
    usage: { input_tokens: 400, output_tokens: 40, cost: 1.4e-5 },
  }))
  return p
}

const TASK = join(tmp, 'task.txt')
writeFileSync(TASK, 'Add a --verbose flag to plugins/lirbox/scripts/orch-lane.sh and cover it with a test.')

const runIntake = (slug, extra, env = {}) => {
  const root = mkdtempSync(join(tmp, 'root-'))
  const r = spawnSync(process.execPath,
    [INTAKE, '--task', TASK, '--run', slug, '--out-root', root, ...extra],
    { encoding: 'utf8', env: { ...process.env, OPENROUTER_API_TOKEN: 'test-token', ...env } })
  let route = null
  try { route = JSON.parse(readFileSync(join(root, '.orchestration', slug, 'route.json'), 'utf8')) }
  catch (e) { route = { _unreadable: e.message } }
  return { status: r.status, stderr: r.stderr, route }
}

// (a) uncertainty may never buy the expensive route.
check('a: low-confidence `lane` downgrades to `inline`', () => {
  const fx = fixture('lane-low', { choice: 'lane', routeConf: 0.4, done: 0.95, cap: 0.02 })
  const { status, route } = runIntake('a-lane-low', ['--fixture', fx])
  assert.equal(status, 0, `expected exit 0, got ${status}`)
  assert.equal(route.route, 'inline', `expected inline, got ${route.route} — ${route.reason}`)
  assert.equal(route.decided_by, 'jev')
  assert.match(route.reason, /downgrades/, `route.json must say WHY: ${route.reason}`)
  // The sibling case: the SAME choice at high confidence must still reach `lane`, or the
  // assertion above would also pass on a router that can only ever say `inline`.
  const hi = fixture('lane-high', { choice: 'lane', routeConf: 0.93, done: 0.95, cap: 0.02 })
  assert.equal(runIntake('a-lane-high', ['--fixture', hi]).route.route, 'lane')
})

// (b) an uncertain refusal is a question, not a verdict.
check('b: low-confidence `reject` becomes `scope`, never `reject`', () => {
  const fx = fixture('reject-low', { choice: 'reject', routeConf: 0.45, done: 0.95, cap: 0.02 })
  const { status, route } = runIntake('b-reject-low', ['--fixture', fx])
  assert.equal(status, 0, `expected exit 0, got ${status}`)
  assert.equal(route.route, 'scope', `expected scope, got ${route.route} — ${route.reason}`)
  assert.notEqual(route.route, 'reject', 'an uncertain reject must never be emitted as reject')
  // Sibling: reject IS reachable, at high confidence only.
  const hi = fixture('reject-high', { choice: 'reject', routeConf: 0.97, done: 0.95, cap: 0.02 })
  assert.equal(runIntake('b-reject-high', ['--fixture', hi]).route.route, 'reject')
})

// (c) intake must never block a human, whatever the API does.
check('c: total Jev failure -> cheapest route, exit 0, decided_by fallback', () => {
  const { status, route } = runIntake('c-dead', ['--timeout-ms', '150'], { JEV_API_URL: HANGING })
  assert.equal(status, 0, `intake must exit 0 even when Jev is dead, got ${status}`)
  assert.equal(route.route, 'inline', `expected the cheapest route, got ${route.route}`)
  assert.equal(route.decided_by, 'fallback', `expected fallback, got ${route.decided_by}`)
  assert.ok(route.reason && route.reason.length > 10, 'a fallback route file must still say why')
  assert.equal(route.confidence[K[0]], 'NOT_MEASURED', 'an unmeasured answer must say so')
})

// --- hooks/route-guard.sh --------------------------------------------------

const START = '${CLAUDE_PLUGIN_ROOT}/scripts/orch-lane.sh start impl --profile builder --run '

/** A throwaway git repo, optionally holding a route.json for `slug`. */
const repoWith = (slug, routeJsonText) => {
  const root = mkdtempSync(join(tmp, 'repo-'))
  spawnSync('git', ['-C', root, 'init', '-q'], { encoding: 'utf8' })
  if (routeJsonText !== null) {
    mkdirSync(join(root, '.orchestration', slug), { recursive: true })
    writeFileSync(join(root, '.orchestration', slug, 'route.json'), routeJsonText)
  }
  return root
}

const hook = (cwd, command) => {
  const r = spawnSync('zsh', [GUARD], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
  })
  return { status: r.status, stderr: r.stderr }
}

const routeFile = (route) => JSON.stringify({ route, reason: 'fixture', decided_by: 'jev' })

// (d) no route at all is the case intake exists for.
check('d: guard refuses `start` with no route.json', () => {
  const root = repoWith('d-run', null)
  const r = hook(root, START + 'd-run')
  assert.equal(r.status, 2, `expected deny (exit 2), got ${r.status}: ${r.stderr}`)
  assert.match(r.stderr, /DENIED/, r.stderr)
  assert.match(r.stderr, /intake\.mjs --task <file> --run d-run/,
    `the denial must name the exact command to get a route: ${r.stderr}`)
})

// (e) a refusal that does not bind is not a refusal.
check('e: guard refuses `start` when the route is `reject`', () => {
  const root = repoWith('e-run', routeFile('reject'))
  const r = hook(root, START + 'e-run')
  assert.equal(r.status, 2, `expected deny (exit 2), got ${r.status}: ${r.stderr}`)
  assert.match(r.stderr, /routed run 'e-run' to 'reject'/, r.stderr)
  // `scope` blocks too, and for a different reason the message has to give.
  const s = hook(repoWith('e-scope', routeFile('scope')), START + 'e-scope')
  assert.equal(s.status, 2, `scope must also deny, got ${s.status}`)
  assert.match(s.stderr, /Restate the task/, s.stderr)
})

// (f) the guard has to let routed work through, or it is just an off switch.
check('f: guard allows `start` when the route is `lane`', () => {
  const root = repoWith('f-run', routeFile('lane'))
  const r = hook(root, START + 'f-run')
  assert.equal(r.status, 0, `expected allow (exit 0), got ${r.status}: ${r.stderr}`)
  assert.doesNotMatch(r.stderr, /DENIED/, `a routed lane must not be denied: ${r.stderr}`)
  // `inline` is a route, not a lane — but it is not this hook's business to relitigate it.
  assert.equal(hook(repoWith('f-inline', routeFile('inline')), START + 'f-inline').status, 0)
})

// (g) a broken hook must never wedge the user's tools — and must never do it silently.
check('g: an internal error fails OPEN and says so on stderr', () => {
  const root = repoWith('g-run', '{ this is not json')
  const r = hook(root, START + 'g-run')
  assert.equal(r.status, 0, `a corrupt route.json must fail open, got exit ${r.status}`)
  assert.match(r.stderr, /PASSING \(fail-open\)/,
    `a silent pass is the known failure mode; stderr must name the reason: ${JSON.stringify(r.stderr)}`)
  // Same for a payload carrying no cwd — nothing to resolve, so nothing to gate.
  const n = spawnSync('zsh', [GUARD], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_input: { command: START + 'g-run' } }),
  })
  assert.equal(n.status, 0, 'a payload with no cwd must fail open')
  assert.match(n.stderr, /PASSING \(fail-open\)/, n.stderr)
})

server.close()
for (const [name, verdict, why] of results) console.log(`${verdict}  ${name}${why ? ` — ${why}` : ''}`)
const failed = results.filter((r) => r[1] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)

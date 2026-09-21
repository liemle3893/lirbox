#!/usr/bin/env node
// Intake. The one function in this factory whose output can be "no".
//
//   node intake.mjs --task <file|-> --run <slug> [--json]
//                   [--model M] [--timeout-ms N] [--fixture <file>]
//
// Every run in this repo has so far begun by ASSUMING the work should happen — which is the
// direct cause of multi-day runs that delivered nothing. A router that cannot reject is not
// intake, it is a dispatcher. So `reject` and `scope` are real outputs here, and route-guard.sh
// is the half that makes them bind.
//
// ONE Jev call, three small typed questions, and the route composed HERE in JS. Jev is never
// asked for the route directly: the composition below is the asymmetry law, and that law is a
// property of what a wrong route COSTS, which is a fact about this repo and not a judgment a
// model should be making.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const HERE = dirname(fileURLToPath(import.meta.url))
// Overridable the same way orch-lane.sh takes TRIAGE_OVERRIDE, and for the same reason: the only
// way to assert "jev died without writing" is to substitute a jev that does exactly that.
const JEV = process.env.INTAKE_JEV_OVERRIDE || join(HERE, 'jev.mjs')
const REPO_ROOT = resolve(HERE, '..', '..', '..')

export const NOT_MEASURED = 'NOT_MEASURED'

// ---------------------------------------------------------------------------
// THE ROUTES, ordered by what being WRONG about them costs.
//
//   inline   wrong -> minutes, recoverable. An edit in this session.
//   lane     wrong -> days, not recoverable. A worktree, a branch, an agent burning tokens.
//   scope    wrong -> one conversation. Blocks the lane door until a human restates the task.
//   reject   wrong -> the work never happens at all.
//
// Two different ladders fall out of that, and conflating them is how this goes wrong:
//
//   ESCALATION  inline < lane      "downgrade to the cheaper route" means lane -> inline.
//   REFUSAL     scope  < reject    an uncertain refusal is a question, not a verdict.
//
// CHEAPEST is `inline` and not `reject`, because `reject` and `scope` both BLOCK the lane door.
// Intake must never wedge a human, so the failure route has to be one they can act on.
// ---------------------------------------------------------------------------
export const CHEAPEST = 'inline'

// Thresholds. HIGH is 0.8 because that is this repo's bar for "confident enough to act on" —
// pick a different number here and it is a second, differently drawn line for the same idea, one
// someone reconciles at 3am. MEDIUM is 0.5 because below an even split the answer carries no
// information at all; it is noise wearing a number.
export const HIGH = 0.8
export const MEDIUM = 0.5

export const QUESTIONS = {
  route: {
    type: 'choice',
    instructions:
      'A task has been proposed for a software repository. The state gives the task text and a ' +
      'few deterministic facts about the repo. Pick the single route this task should take. ' +
      'Judge the task as written — do not assume a charitable version of it exists.',
    criteria: {
      reject:
        'The work should NOT happen. It is already done, it contradicts something the repo ' +
        'deliberately decided, it is speculative with no present need, or it would cost far ' +
        'more than the problem it solves.',
      inline:
        'Small and contained. A person or agent could finish it in one sitting inside the ' +
        'current session — a handful of files, no long-running process, no coordination.',
      lane:
        'Large enough to need its own branch, worktree and a dedicated agent running for hours: ' +
        'many files, several stages, or work that must be independently verified before it lands.',
    },
  },
  done_stateable: {
    type: 'noul',
    instructions:
      'Can "done" for this task be stated right now as a COMMAND plus an EXPECTED VALUE — ' +
      'something a machine could run and compare, such as a test that must pass, an exit code, ' +
      'or a file that must contain a specific string? Answer for the task AS WRITTEN. If the ' +
      'only available finish line is a human looking at it and being satisfied, the answer is no.',
  },
  needs_external_capability: {
    type: 'noul',
    instructions:
      'Does this task require capability BEYOND reading and editing files in this repository — ' +
      'production or database credentials, a live web browser, a device simulator or emulator, ' +
      'or access to a third-party system?',
  },
}

/**
 * A 0..1 confidence for any answer shape.
 *
 * A `choice` reports its own `confidence`. A `noul` does NOT and jev.mjs refuses to invent one —
 * but a noul IS a probability, so its certainty is its distance from an even split. 0.9 and 0.1
 * are equally confident answers to the same question; 0.5 is no answer at all.
 * Returns null when there is nothing to read, which the caller must treat as NOT_MEASURED.
 */
export function confidenceOf(answer) {
  if (!answer || typeof answer !== 'object') return null
  if (answer.type === 'noul') {
    return typeof answer.noul === 'number' ? Math.abs(answer.noul - 0.5) * 2 : null
  }
  return typeof answer.confidence === 'number' ? answer.confidence : null
}

const band = (c) => (c === null ? 'none' : c >= HIGH ? 'high' : c >= MEDIUM ? 'medium' : 'low')

/**
 * The route, composed here rather than asked for.
 *
 * Asymmetric ON PURPOSE. A wrong cheap route costs minutes; a wrong expensive one costs days.
 * So uncertainty may never BUY an expensive run, and it may never buy a refusal either:
 * every downgrade below points at a cheaper cell, and no rule anywhere upgrades on doubt.
 */
export function decideRoute(answers) {
  const route = answers && answers.route
  const done = answers && answers.done_stateable
  const cap = answers && answers.needs_external_capability

  const unusable = (a, type) => !a || typeof a !== 'object' || a.type !== type || confidenceOf(a) === null
  if (unusable(route, 'choice') || unusable(done, 'noul') || unusable(cap, 'noul')) {
    return {
      route: CHEAPEST,
      decided_by: 'fallback',
      reason:
        `an answer was missing or ${NOT_MEASURED}, so nothing was measured; falling back to the ` +
        `cheapest route '${CHEAPEST}' rather than blocking`,
    }
  }

  const routeConf = confidenceOf(route)
  const doneConf = confidenceOf(done)
  const capConf = confidenceOf(cap)

  // A confident NO on "done is stateable" outranks the route choice: neither inline nor lane is
  // meaningful when nobody can say what finishing looks like. Only a CONFIDENT no, because scope
  // blocks the door and doubt may not buy a block.
  if (done.noul < MEDIUM && doneConf >= HIGH) {
    return {
      route: 'scope',
      decided_by: 'jev',
      reason:
        `'done' cannot be stated as a command plus an expected value (noul=${done.noul}, ` +
        `confidence=${doneConf.toFixed(2)}); the task needs scoping before it needs a route`,
    }
  }

  // A confident refusal outranks BOTH gates below it. Needing prod credentials is a reason to
  // scope work that should happen; it was never a reason to re-open work that should not. While
  // the capability gate sat above this block, a task jev refused at 0.95 came out as `scope` and
  // went to the planner to be cut into one slice — which is precisely the softened re-scope the
  // `reject` route exists to refuse. An uncertain refusal still falls through to `scope`: doubt
  // may not buy the one route whose cost is that the work never happens at all.
  if (route.choice === 'reject') {
    if (routeConf >= HIGH) {
      return {
        route: 'reject',
        decided_by: 'jev',
        reason: `rejected at high confidence (${routeConf.toFixed(2)} >= ${HIGH})`,
      }
    }
    return {
      route: 'scope',
      decided_by: 'jev',
      reason:
        `'reject' at ${band(routeConf)} confidence (${routeConf.toFixed(2)} < ${HIGH}); an ` +
        `uncertain refusal is a question for a human, not a verdict`,
    }
  }

  // Same shape, same bar: work needing prod credentials, a browser or a simulator fits neither
  // an in-session edit nor a lane worktree as this repo configures them. A human supplies the
  // capability or restates the task. This still outranks `lane` on purpose — a prod database
  // migration fits no worktree this repo can cut.
  if (cap.noul > MEDIUM && capConf >= HIGH) {
    return {
      route: 'scope',
      decided_by: 'jev',
      reason:
        `needs capability beyond editing files in this repo (noul=${cap.noul}, ` +
        `confidence=${capConf.toFixed(2)}); scope it against what the runner actually has`,
    }
  }

  if (route.choice === 'lane') {
    if (routeConf >= HIGH) {
      return {
        route: 'lane',
        decided_by: 'jev',
        reason: `lane at high confidence (${routeConf.toFixed(2)} >= ${HIGH})`,
      }
    }
    return {
      route: 'inline',
      decided_by: 'jev',
      reason:
        `'lane' at ${band(routeConf)} confidence (${routeConf.toFixed(2)} < ${HIGH}); ` +
        `uncertainty never buys the expensive route, so this downgrades to 'inline'`,
    }
  }

  // `inline` is already the bottom of the escalation ladder — there is nothing to downgrade to,
  // so its confidence changes nothing. Recorded anyway, so the file still says why.
  return {
    route: 'inline',
    decided_by: 'jev',
    reason: `inline at ${band(routeConf)} confidence (${routeConf.toFixed(2)})`,
  }
}

/**
 * Cheap repo facts, deterministically. No LLM, no judgment — just whether the things the task
 * names are actually there, which is the single most common way a task is wrong before it starts.
 */
export function repoFacts(taskText) {
  let repoFiles = null
  const ls = spawnSync('git', ['-C', REPO_ROOT, 'ls-files'], { encoding: 'utf8' })
  if (ls.status === 0) repoFiles = ls.stdout.split('\n').filter(Boolean).length

  // Path-shaped tokens: at least one slash or a known-ish extension, no whitespace.
  const named = [...new Set((taskText.match(/[\w.@~/-]*[\w-]\/[\w.@/-]+|\b[\w.-]+\.\w{1,5}\b/g) || []))]
    .filter((t) => !/^\d+\.\d+$/.test(t)) // version numbers are not paths
    .slice(0, 25)
    .map((path) => ({ path, exists: existsSync(join(REPO_ROOT, path)) || existsSync(path) }))

  return { repo_file_count: repoFiles, files_named_in_task: named }
}

function main() {
  const { values } = parseArgs({
    options: {
      task: { type: 'string' },
      run: { type: 'string' },
      json: { type: 'boolean', default: false },
      model: { type: 'string' },
      'timeout-ms': { type: 'string' },
      fixture: { type: 'string' },
      'out-root': { type: 'string' }, // the repo whose .orchestration/ receives the file; tests only
    },
  })
  for (const req of ['task', 'run']) {
    if (!values[req]) {
      console.error(`intake: missing --${req}`)
      process.exit(2)
    }
  }

  const taskText = values.task === '-' ? readFileSync(0, 'utf8') : readFileSync(values.task, 'utf8')
  const facts = repoFacts(taskText)
  const state = { task: taskText, repo: facts }

  const outRoot = values['out-root'] ? resolve(values['out-root']) : REPO_ROOT
  const runDir = join(outRoot, '.orchestration', values.run)
  mkdirSync(runDir, { recursive: true })

  // One call, shelled out. jev.mjs owns the transport, the caps, the retry and the NOT_MEASURED
  // contract; a second HTTP client here would be a second place for all of that to drift.
  // --fail-open because a dead key must not become a blocked human.
  const scratch = join(runDir, '.jev-raw.json')
  const qFile = join(runDir, '.jev-questions.json')
  writeFileSync(qFile, JSON.stringify(QUESTIONS, null, 2))
  const stateFile = join(runDir, '.jev-state.json')
  writeFileSync(stateFile, JSON.stringify(state, null, 2))

  // The run slug is reused across re-routes, so a scratch file from the LAST call is sitting here.
  // If this call's jev dies before it writes (spawn failure, OOM, a kill), the read below would
  // parse those stale answers, find no `error`, and emit `decided_by: "jev"` for a route nothing
  // measured this time. Deleting it first makes "jev did not write" indistinguishable from
  // "jev is not installed" — both unreadable, both fallback.
  rmSync(scratch, { force: true })

  const args = [JEV, '--state', stateFile, '--questions', qFile, '--out', scratch, '--fail-open']
  if (values.model) args.push('--model', values.model)
  if (values['timeout-ms']) args.push('--timeout-ms', values['timeout-ms'])
  if (values.fixture) args.push('--fixture', values.fixture)
  const jev = spawnSync(process.execPath, args, { encoding: 'utf8' })
  if (jev.stderr) process.stderr.write(jev.stderr)

  let raw = null
  try {
    raw = JSON.parse(readFileSync(scratch, 'utf8'))
  } catch (e) {
    raw = { model: values.model || null, answers: {}, error: `unreadable jev output: ${e.message}` }
  }
  // --fail-open means jev exits 0 for every failure it MEASURED and wrote down. A non-zero exit is
  // therefore jev itself breaking, and whatever is in the file is not this call's measurement.
  if ((jev.error || jev.status !== 0) && !raw.error) {
    raw.error = jev.error
      ? `jev could not be run: ${jev.error.message}`
      : `jev exited ${jev.status}${jev.signal ? ` (signal ${jev.signal})` : ''} without reporting why`
  }

  const decision = decideRoute(raw.answers)
  // A jev-level error means the answers were never measured, whatever they parsed to.
  if (raw.error && decision.decided_by !== 'fallback') {
    decision.decided_by = 'fallback'
    decision.route = CHEAPEST
    decision.reason = `jev reported an error (${raw.error}); falling back to '${CHEAPEST}'`
  }

  const record = {
    run: values.run,
    route: decision.route,
    reason: decision.reason,
    decided_by: decision.decided_by,
    timestamp: new Date().toISOString(),
    model: raw.model || null,
    usage: raw.usage || null,
    cost: raw.usage && typeof raw.usage.cost === 'number' ? raw.usage.cost : NOT_MEASURED,
    thresholds: { high: HIGH, medium: MEDIUM, cheapest: CHEAPEST },
    questions: QUESTIONS,
    answers: raw.answers || {},
    confidence: Object.fromEntries(
      Object.keys(QUESTIONS).map((k) => {
        const c = confidenceOf(raw.answers && raw.answers[k])
        return [k, c === null ? NOT_MEASURED : c]
      }),
    ),
    repo_facts: facts,
    ...(raw.error ? { jev_error: raw.error } : {}),
  }

  const routeFile = join(runDir, 'route.json')
  writeFileSync(routeFile, JSON.stringify(record, null, 2))

  if (values.json) console.log(JSON.stringify(record, null, 2))
  else console.log(`${record.route}\t${values.run}\t(${record.decided_by}) ${record.reason}\n${routeFile}`)

  // Exit 0 always. Intake reports a route; it does not refuse to run.
  process.exit(0)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main()

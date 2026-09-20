#!/usr/bin/env node
// Replay conductor's per-finding confidence scorer against Jev.
//
// Conductor today spawns ONE subagent per finding and keeps the finding when score >= 80
// (skills/conductor/scripts/scaffold-workflow.cjs:445-470). Replay sends ONE Jev call:
// state = the diff, one `score` question per finding.
//
//   node jev-replay.mjs --findings <json> --diff <file> [--threshold 80]
//                       [--model M] [--timeout-ms N] [--fixture <file>]

import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { askJev, echoUsage, reportedCost, NOT_MEASURED } from './jev.mjs'

// ---------------------------------------------------------------------------
// THE LEVEL LADDER — the one place the two scales meet, and the one judgment call here.
//
// Jev's `score` type takes 2..10 level descriptions and answers with a float index into them.
// Conductor's incumbent scale is 0-100 — but its rubric
// (skills/conductor/scripts/prompts/confidence-rubric.txt) only ever defines FIVE anchors:
// 0, 25, 50, 75, 100, each with prose attached. So this is NOT a rescale of a 101-point scale
// into 10 buckets; it is a transcription. The five rubric anchors become the five ladder levels
// verbatim, and the mapping back is exact at every point the incumbent rubric actually defines.
// The incumbent's in-between values (e.g. 63) were never anchored to anything, so nothing is lost.
//
//   level index 0 1 2 3 4   ->   incumbent 0 25 50 75 100
//   threshold 80 therefore sits between index 3 (75) and index 4 (100): a finding is kept only
//   when Jev lands strictly above "highly confident", i.e. index > 3.2.
//
// Stated because a silent off-by-one here is a 25-point shift on a gate: the index is ZERO-BASED.
// A score outside [0, levels.length-1] is reported NOT_MEASURED rather than clamped, so a 1-based
// API would surface loudly instead of skewing every row. Raw Jev indices print next to the mapped
// values for exactly this reason.
// ---------------------------------------------------------------------------
const LEVELS = [
  'Not confident at all. False positive that does not stand up to light scrutiny, or a pre-existing issue.',
  'Somewhat confident. Might be real, might be a false positive; could not verify.',
  'Moderately confident. Verified real, but may be a nitpick or rarely hit in practice.',
  'Highly confident. Double-checked and verified: very likely real, will be hit in practice, directly impacts functionality (or is explicitly required by CLAUDE.md).',
  'Absolutely certain. Double-checked, definitely real, will happen frequently; evidence directly confirms it.',
]

export const LADDER = {
  base: 0,
  levels: LEVELS,
  incumbentAt: LEVELS.map((_, i) => (i / (LEVELS.length - 1)) * 100),
  /** Jev level index -> incumbent 0-100. null when the index is out of contract. */
  toIncumbent(i) {
    if (typeof i !== 'number' || !Number.isFinite(i)) return null
    if (i < this.base || i > this.base + LEVELS.length - 1) return null
    return ((i - this.base) / (LEVELS.length - 1)) * 100
  },
  /** The incumbent 0-100 threshold as a Jev level index, for printing. */
  thresholdIndex(t) {
    return this.base + (t / 100) * (LEVELS.length - 1)
  },
}

const INSTRUCTIONS =
  'Verify ONE code-review finding against the diff in the state. Score how confident you are ' +
  'the finding is REAL and WORTH FIXING. Automatic lowest level: pre-existing issues; ' +
  'linter/typechecker/compiler-catchable; pedantic nitpicks; issues on lines the diff did not ' +
  'modify; intentional changes related to the goal. FINDING (JSON): '

const key = (i) => `f${i}`

function loadFindings(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const findings = Array.isArray(raw) ? raw : raw.findings
  if (!Array.isArray(findings)) throw new Error(`${path}: expected an array or { findings: [...] }`)
  return findings
}

const pad = (s, w) => String(s).padEnd(w)

async function main() {
  const { values } = parseArgs({
    options: {
      findings: { type: 'string' },
      diff: { type: 'string' },
      threshold: { type: 'string', default: '80' },
      model: { type: 'string' },
      'timeout-ms': { type: 'string' },
      fixture: { type: 'string' },
    },
  })
  for (const req of ['findings', 'diff']) {
    if (!values[req]) {
      console.error(`jev-replay: missing --${req}`)
      process.exit(2)
    }
  }
  const threshold = Number(values.threshold)
  const findings = loadFindings(values.findings)
  const diff = readFileSync(values.diff, 'utf8')

  const questions = Object.fromEntries(
    findings.map((f, i) => [
      key(i),
      { type: 'score', instructions: INSTRUCTIONS + JSON.stringify(f), criteria: LEVELS },
    ]),
  )

  console.log('LEVEL LADDER (Jev index -> conductor 0-100)')
  LEVELS.forEach((desc, i) => {
    console.log(`  ${i} -> ${String(LADDER.incumbentAt[i]).padStart(3)}  ${desc}`)
  })
  console.log(`  threshold: keep when incumbent-equivalent >= ${threshold} (Jev index >= ${LADDER.thresholdIndex(threshold)})`)
  console.log('')

  const started = Date.now()
  let res = null
  let err = null
  try {
    res = await askJev({
      state: diff,
      questions,
      ...(values.model ? { model: values.model } : {}),
      ...(values['timeout-ms'] ? { timeoutMs: Number(values['timeout-ms']) } : {}),
      fixture: values.fixture,
    })
  } catch (e) {
    err = e
  }
  const wallMs = Date.now() - started
  if (err) console.log(`JEV CALL FAILED: ${err.message} — every row is ${NOT_MEASURED}`)
  else echoUsage(res.usage, wallMs, 'jev-replay')

  const rows = findings.map((f, i) => {
    const a = res && res.answers ? res.answers[key(i)] : undefined
    const mapped = a && a.type === 'score' ? LADDER.toIncumbent(a.score) : null
    const incumbent = f.confidence ?? f.score ?? null
    const jev = mapped === null ? NOT_MEASURED : mapped
    let verdict
    if (jev === NOT_MEASURED || incumbent === null) verdict = NOT_MEASURED
    else verdict = (incumbent >= threshold) === (mapped >= threshold) ? 'agree' : 'DISAGREE'
    return {
      title: (f.title || '(untitled)').slice(0, 44),
      where: `${f.file || '?'}:${f.line ?? '?'}`,
      incumbent: incumbent === null ? 'NOT MEASURED' : incumbent,
      rawIdx: a && a.type === 'score' ? a.score : NOT_MEASURED,
      jev,
      conf: a && a.confidence !== undefined ? a.confidence : NOT_MEASURED,
      verdict,
    }
  })

  const W = [46, 26, 14, 14, 14, 14]
  console.log(
    pad('FINDING', W[0]) + pad('WHERE', W[1]) + pad('INCUMBENT', W[2]) +
    pad('JEV_IDX', W[3]) + pad('JEV', W[4]) + pad('CONF', W[5]) + 'VERDICT',
  )
  for (const r of rows) {
    console.log(
      pad(r.title, W[0]) + pad(r.where, W[1]) + pad(r.incumbent, W[2]) +
      pad(r.rawIdx, W[3]) + pad(r.jev, W[4]) + pad(r.conf, W[5]) + r.verdict,
    )
  }

  const agree = rows.filter((r) => r.verdict === 'agree').length
  const disagree = rows.filter((r) => r.verdict === 'DISAGREE').length
  const notMeasured = rows.filter((r) => r.verdict === NOT_MEASURED).length
  const cost = reportedCost(res && res.usage)
  console.log('')
  console.log(`findings:      ${rows.length}`)
  console.log(`agreements:    ${agree}`)
  console.log(`disagreements: ${disagree}`)
  console.log(`${NOT_MEASURED}:  ${notMeasured}`)
  console.log(`cost_usd:      ${cost === null ? NOT_MEASURED : cost}   (reported by the API, not computed here)`)
  console.log(`wall_ms:       ${wallMs}`)

  process.exit(err || notMeasured ? 1 : 0)
}

main().catch((e) => {
  console.error(`jev-replay: ${e.stack || e.message}`)
  process.exit(1)
})

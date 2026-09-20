#!/usr/bin/env node
// Typesafe Jev (System One) client, via OpenRouter. Fail-CLOSED by default: any failure writes
// the literal token NOT_MEASURED as the answer value and exits non-zero, so a caller can never
// confuse "scored low" with "did not score". Global fetch only, no dependencies.
//
//   node jev.mjs --state <file|-> --questions <file> --out <file>
//                [--model M] [--timeout-ms N] [--fail-open] [--fixture <file>]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const HERE = dirname(fileURLToPath(import.meta.url))

export const ENDPOINT = process.env.JEV_API_URL || 'https://openrouter.ai/api/v1/systemone'
// Pinned on purpose. A floating alias (`jev-latest`) silently rescales the metric between runs,
// which is exactly why judge.toml pins models too. Override per-call with --model.
export const DEFAULT_MODEL = 'jev-1.13'
export const DEFAULT_TIMEOUT_MS = 10000
export const NOT_MEASURED = 'NOT_MEASURED'

// Documented caps. 64k total per request; 32k for state + the single longest question.
export const CAP_TOTAL_TOKENS = 64000
export const CAP_STATE_PLUS_QUESTION_TOKENS = 32000
// Contract limits worth refusing locally — a local refusal beats a 400.
export const MIN_SCORE_LEVELS = 2
export const MAX_SCORE_LEVELS = 10
export const MAX_CHOICE_OPTIONS = 255

const estTokens = (s) => Math.ceil((typeof s === 'string' ? s : JSON.stringify(s)).length / 4)

/** The API reports its own cost. We never compute one — a local estimate would drift silently. */
export const reportedCost = (usage) =>
  usage && typeof usage.cost === 'number' ? usage.cost : null

/** Reads OPENROUTER_API_TOKEN, falling back to the repo-root .env (gitignored). */
export function apiToken() {
  if (!process.env.OPENROUTER_API_TOKEN) {
    const envFile = join(HERE, '..', '..', '..', '.env')
    if (existsSync(envFile)) {
      try { process.loadEnvFile(envFile) } catch { /* malformed .env is just a missing key */ }
    }
  }
  return process.env.OPENROUTER_API_TOKEN
}

/** Throws a clear refusal (naming the limit and the observed value) if the request cannot fit. */
export function assertBudget(state, questions) {
  const stateTokens = estTokens(state)
  let worst = { key: null, tokens: 0 }
  for (const [key, q] of Object.entries(questions)) {
    const t = estTokens(q)
    if (t > worst.tokens) worst = { key, tokens: t }
  }
  const pair = stateTokens + worst.tokens
  if (pair > CAP_STATE_PLUS_QUESTION_TOKENS) {
    throw new Error(
      `refused before sending: state + longest question is ~${pair} tokens, cap is ` +
      `${CAP_STATE_PLUS_QUESTION_TOKENS} (state ~${stateTokens}, question "${worst.key}" ~${worst.tokens})`,
    )
  }
  const total = stateTokens + estTokens(questions)
  if (total > CAP_TOTAL_TOKENS) {
    throw new Error(
      `refused before sending: whole request is ~${total} tokens, cap is ${CAP_TOTAL_TOKENS} (observed ~${total})`,
    )
  }
  return { stateTokens, longestQuestion: worst, totalTokens: total }
}

/** Throws on a question the API would 400 on. Shape only — never rewrites the caller's question. */
export function assertQuestions(questions) {
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    throw new Error('refused before sending: questions must be a map<string, Question>')
  }
  const entries = Object.entries(questions)
  if (!entries.length) throw new Error('refused before sending: questions map is empty')
  for (const [key, q] of entries) {
    if (!q || typeof q !== 'object') throw new Error(`refused before sending: question "${key}" is not an object`)
    if (!q.type) throw new Error(`refused before sending: question "${key}" has no type`)
    if (!q.instructions) throw new Error(`refused before sending: question "${key}" has no instructions`)
    if (q.type === 'score') {
      if (!Array.isArray(q.criteria)) {
        throw new Error(`refused before sending: score question "${key}" needs criteria as an array of level descriptions`)
      }
      if (q.criteria.length < MIN_SCORE_LEVELS || q.criteria.length > MAX_SCORE_LEVELS) {
        throw new Error(
          `refused before sending: score question "${key}" has ${q.criteria.length} levels, ` +
          `limit is ${MIN_SCORE_LEVELS}..${MAX_SCORE_LEVELS}`,
        )
      }
    } else if (q.type === 'choice') {
      if (!q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria)) {
        throw new Error(`refused before sending: choice question "${key}" needs criteria as a map<optionKey, description|null>`)
      }
      const n = Object.keys(q.criteria).length
      if (n > MAX_CHOICE_OPTIONS) {
        throw new Error(`refused before sending: choice question "${key}" has ${n} options, limit is ${MAX_CHOICE_OPTIONS}`)
      }
    }
  }
}

/**
 * One call. Resolves to the response envelope, or throws. Retries once on 429/5xx or transport
 * error. Shape and budget are checked BEFORE any request leaves — a clear refusal beats a 400,
 * and beats a truncated judgment.
 */
export async function askJev({
  state,
  questions,
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fixture = null,
}) {
  assertQuestions(questions)
  assertBudget(state, questions)

  if (fixture) return JSON.parse(readFileSync(fixture, 'utf8'))

  const token = apiToken()
  if (!token) throw new Error('OPENROUTER_API_TOKEN is not set (looked at the environment and the repo-root .env)')

  const body = JSON.stringify({ model, state, questions })
  let lastErr = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000))
    let res
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError'
      lastErr = new Error(`request failed: ${timedOut ? `timed out after ${timeoutMs}ms` : e.message}`)
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)

    let json
    try {
      json = await res.json()
    } catch (e) {
      throw new Error(`malformed body: ${e.message}`)
    }
    if (!json || typeof json !== 'object' || !json.answers || typeof json.answers !== 'object') {
      throw new Error('malformed body: missing `answers` object')
    }
    return json
  }
  throw lastErr
}

/** Every question key present in `answers`, or the raw NOT_MEASURED token in its place. */
export function fillMissing(questions, answers) {
  const out = {}
  const missing = []
  for (const key of Object.keys(questions)) {
    if (answers && Object.prototype.hasOwnProperty.call(answers, key)) out[key] = answers[key]
    else {
      out[key] = NOT_MEASURED
      missing.push(key)
    }
  }
  return { answers: out, missing }
}

/** usage + elapsed, on stderr, on every call. */
export function echoUsage(usage, elapsedMs, prefix = 'jev') {
  const cost = reportedCost(usage)
  console.error(
    `${prefix}: usage input_tokens=${(usage && usage.input_tokens) ?? '?'} ` +
    `output_tokens=${(usage && usage.output_tokens) ?? '?'} ` +
    `cost=${cost === null ? NOT_MEASURED : cost} elapsed_ms=${elapsedMs}`,
  )
}

function readState(path) {
  const raw = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) // state may be string | object | array
  } catch {
    return raw
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      state: { type: 'string' },
      questions: { type: 'string' },
      out: { type: 'string' },
      model: { type: 'string', default: DEFAULT_MODEL },
      'timeout-ms': { type: 'string', default: String(DEFAULT_TIMEOUT_MS) },
      'fail-open': { type: 'boolean', default: false },
      fixture: { type: 'string' },
    },
  })
  for (const req of ['state', 'questions', 'out']) {
    if (!values[req]) {
      console.error(`jev: missing --${req}`)
      process.exit(2)
    }
  }

  const questions = JSON.parse(readFileSync(values.questions, 'utf8'))
  const failOpen = values['fail-open']

  const bail = (reason) => {
    const { answers } = fillMissing(questions, {})
    writeFileSync(values.out, JSON.stringify({ model: values.model, answers, error: reason }, null, 2))
    console.error(`jev: ${reason}`)
    console.error(`jev: all ${Object.keys(questions).length} answer(s) written as ${NOT_MEASURED}`)
    process.exit(failOpen ? 0 : 1)
  }

  let state
  try {
    state = readState(values.state)
  } catch (e) {
    return bail(`cannot read state: ${e.message}`)
  }

  const started = Date.now()
  let res
  try {
    res = await askJev({
      state,
      questions,
      model: values.model,
      timeoutMs: Number(values['timeout-ms']),
      fixture: values.fixture,
    })
  } catch (e) {
    return bail(e.message)
  }
  const elapsedMs = Date.now() - started

  // Answers are passed through verbatim. A `noul` answer carries no `confidence` field and one
  // is never synthesised here — a fabricated number would read as a measurement.
  const { answers, missing } = fillMissing(questions, res.answers)
  writeFileSync(values.out, JSON.stringify({ ...res, answers }, null, 2))

  echoUsage(res.usage, elapsedMs)
  if (missing.length) {
    console.error(
      `jev: ${missing.length} question(s) absent from answers, written as ${NOT_MEASURED}: ${missing.join(', ')}`,
    )
    process.exit(failOpen ? 0 : 1)
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`jev: ${e.stack || e.message}`)
    process.exit(1)
  })
}

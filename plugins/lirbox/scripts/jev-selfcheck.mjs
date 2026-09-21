#!/usr/bin/env node
// Runnable self-check for jev.mjs — the whole safety contract, offline, no key, no framework.
// A hanging local server stands in for the API so a timeout is a real timeout, and it counts
// requests so "refused before sending" can be asserted rather than assumed.
//
//   node jev-selfcheck.mjs

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const JEV = join(HERE, 'jev.mjs')
const FIXTURES = join(HERE, 'fixtures')
const tmp = mkdtempSync(join(tmpdir(), 'jev-selfcheck-'))

let requests = 0
const server = createServer(() => { requests++ /* never responds */ })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
// A BASE, as TYPESAFE_BASE_URL is: the client appends /v1/systemone itself.
const base = `http://127.0.0.1:${server.address().port}/api`

const QUESTIONS = join(tmp, 'questions.json')
writeFileSync(QUESTIONS, JSON.stringify({
  q1: { type: 'noul', instructions: 'Is the change safe?' },
  q2: { type: 'noul', instructions: 'Is the change tested?' },
}))
const STATE = join(tmp, 'state.txt')
writeFileSync(STATE, 'a small diff')

// TYPESAFE_BASE_URL points the client at the hanging server; TYPESAFE_API_KEY is a placeholder,
// and because it is SET, apiToken() never falls through to the real key in the repo-root .env.
const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [JEV, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TYPESAFE_API_KEY: 'test-token', TYPESAFE_BASE_URL: base, ...env },
  })
  return { status: r.status, stderr: r.stderr, stdout: r.stdout }
}
const outOf = (p) => JSON.parse(readFileSync(p, 'utf8'))
const allNotMeasured = (a) => Object.values(a).every((v) => v === 'NOT_MEASURED')

const results = []
const check = (name, fn) => {
  try { fn(); results.push([name, 'PASS', '']) }
  catch (e) { results.push([name, 'FAIL', e.message.split('\n')[0]]) }
}

// (a) a timeout produces NOT_MEASURED and a non-zero exit.
check('a: timeout -> NOT_MEASURED + non-zero exit', () => {
  const out = join(tmp, 'a.json')
  const r = run(['--state', STATE, '--questions', QUESTIONS, '--out', out, '--timeout-ms', '150'])
  assert.notEqual(r.status, 0, `expected non-zero exit, got ${r.status}`)
  assert.match(r.stderr, /timed out after 150ms/, `stderr did not report the timeout: ${r.stderr}`)
  const a = outOf(out).answers
  assert.equal(Object.keys(a).length, 2)
  assert.ok(allNotMeasured(a), `expected all NOT_MEASURED, got ${JSON.stringify(a)}`)
})

// (b) --fail-open produces the same NOT_MEASURED values, but exit 0.
check('b: --fail-open -> NOT_MEASURED + exit 0', () => {
  const out = join(tmp, 'b.json')
  const r = run(['--state', STATE, '--questions', QUESTIONS, '--out', out, '--timeout-ms', '150', '--fail-open'])
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`)
  assert.ok(allNotMeasured(outOf(out).answers), 'expected all NOT_MEASURED')
})

// (c) an oversized state is refused BEFORE any request is made.
check('c: oversized state refused, zero requests sent', () => {
  const out = join(tmp, 'c.json')
  const big = join(tmp, 'big.txt')
  writeFileSync(big, 'x'.repeat(200000)) // ~50k tokens at chars/4, over the 32k pair cap
  const before = requests
  const r = run(['--state', big, '--questions', QUESTIONS, '--out', out])
  assert.notEqual(r.status, 0, `expected non-zero exit, got ${r.status}`)
  assert.match(r.stderr, /refused before sending/, `stderr did not report the refusal: ${r.stderr}`)
  assert.match(r.stderr, /cap is 32000/, `refusal did not name the limit: ${r.stderr}`)
  assert.ok(allNotMeasured(outOf(out).answers), 'expected all NOT_MEASURED')
  assert.equal(requests - before, 0, `expected 0 requests, server saw ${requests - before}`)
})

// (d) a noul answer is passed through verbatim — no `confidence` is ever synthesised for it.
check('d: noul answer carries no fabricated confidence', () => {
  const out = join(tmp, 'd.json')
  const r = run(['--state', STATE, '--questions', QUESTIONS, '--out', out,
    '--fixture', join(FIXTURES, 'jev-noul-response.json')])
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`)
  const a = outOf(out).answers
  for (const k of ['q1', 'q2']) {
    assert.equal(a[k].type, 'noul')
    assert.equal(typeof a[k].noul, 'number', `${k}.noul should be the 0..1 value`)
    assert.ok(
      !Object.prototype.hasOwnProperty.call(a[k], 'confidence'),
      `${k} gained a confidence field the API never sent: ${JSON.stringify(a[k])}`,
    )
  }
  assert.match(r.stderr, /cost=0\.000017598/, `API-reported cost not echoed: ${r.stderr}`)
})

// (e) a question absent from `answers` is NOT_MEASURED and still fails closed.
check('e: missing answer -> NOT_MEASURED + non-zero exit', () => {
  const out = join(tmp, 'e.json')
  const questions = join(tmp, 'q5.json')
  writeFileSync(questions, JSON.stringify(Object.fromEntries(
    [0, 1, 2, 3, 4].map((i) => [`f${i}`, { type: 'score', instructions: 'x', criteria: ['lo', 'hi'] }]),
  )))
  const r = run(['--state', STATE, '--questions', questions, '--out', out,
    '--fixture', join(FIXTURES, 'jev-response.json')])
  const a = outOf(out).answers
  assert.equal(a.f0.score, 4, 'fixture answer f0 did not survive')
  assert.equal(a.f4, 'NOT_MEASURED', `f4 is absent from the fixture, expected NOT_MEASURED, got ${JSON.stringify(a.f4)}`)
  assert.notEqual(r.status, 0, 'a missing answer must fail closed')
})

// (f) an out-of-contract score ladder is refused locally, before any request.
check('f: 11-level score ladder refused, zero requests sent', () => {
  const out = join(tmp, 'f.json')
  const questions = join(tmp, 'q11.json')
  writeFileSync(questions, JSON.stringify({
    big: { type: 'score', instructions: 'x', criteria: Array.from({ length: 11 }, (_, i) => `L${i}`) },
  }))
  const before = requests
  const r = run(['--state', STATE, '--questions', questions, '--out', out])
  assert.notEqual(r.status, 0, `expected non-zero exit, got ${r.status}`)
  assert.match(r.stderr, /has 11 levels, limit is 2\.\.10/, `refusal did not name the limit: ${r.stderr}`)
  assert.ok(allNotMeasured(outOf(out).answers), 'expected all NOT_MEASURED')
  assert.equal(requests - before, 0, `expected 0 requests, server saw ${requests - before}`)
})

// (g) the env contract is TypeSafe's own, not one invented here. The SDKs read TYPESAFE_API_KEY
// and TYPESAFE_BASE_URL, and the base URL is a BASE — the client appends /v1/systemone.
// https://openrouter.ai/docs/guides/community/typesafe-sdk
// Run against a COPY of jev.mjs in an empty temp tree, so the repo-root .env (which holds a real
// key) can never answer on the module's behalf and make an unset variable look set.
check('g: TYPESAFE_API_KEY / TYPESAFE_BASE_URL, and nothing invented', () => {
  const root = mkdtempSync(join(tmpdir(), 'jev-env-'))
  const dir = join(root, 'plugins', 'lirbox', 'scripts')
  mkdirSync(dir, { recursive: true })
  copyFileSync(JEV, join(dir, 'jev.mjs'))
  const probe = (env) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
      !/^(TYPESAFE_|OPENROUTER_API_TOKEN$|JEV_API_URL$)/.test(k)))
    const r = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(join(dir, 'jev.mjs')).href)});` +
      `console.log(JSON.stringify({ token: m.apiToken() ?? null, endpoint: m.ENDPOINT }))`],
      { encoding: 'utf8', env: { ...clean, ...env } })
    assert.equal(r.status, 0, `probe failed to run: ${r.stderr}`)
    return JSON.parse(r.stdout)
  }
  assert.equal(probe({ TYPESAFE_API_KEY: 'k1' }).token, 'k1', 'TYPESAFE_API_KEY is not read')
  assert.equal(probe({}).endpoint, 'https://openrouter.ai/api/v1/systemone', 'default endpoint wrong')
  assert.equal(probe({ TYPESAFE_BASE_URL: 'http://x.test/api/' }).endpoint, 'http://x.test/api/v1/systemone',
    'TYPESAFE_BASE_URL must be a BASE with /v1/systemone appended (and a trailing slash tolerated)')
  // The invented names are gone, not aliased: a key under the old name must not authenticate.
  assert.equal(probe({ OPENROUTER_API_TOKEN: 'old' }).token, null, 'the invented OPENROUTER_API_TOKEN still authenticates')
  assert.equal(probe({ JEV_API_URL: 'http://old.test' }).endpoint, 'https://openrouter.ai/api/v1/systemone',
    'the invented JEV_API_URL still redirects requests')
  // The .env fallback reads the same standard name.
  writeFileSync(join(root, '.env'), 'TYPESAFE_API_KEY=from-dotenv\n')
  assert.equal(probe({}).token, 'from-dotenv', 'the repo-root .env fallback does not read TYPESAFE_API_KEY')
})

server.close()
for (const [name, verdict, why] of results) console.log(`${verdict}  ${name}${why ? ` — ${why}` : ''}`)
const failed = results.filter((r) => r[1] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)

// ACCEPTANCE-CHECK (RED on baseline) — concern id: richer-propose-failure-feedback.
//
// CONCERN: the propose agent receives only a thin ledger digest `{g, change, metric, kept}` with no
// failure REASON (gate-fail vs metric-regression vs surface-violation), so it can re-propose the
// spirit of an already-failed idea. FIX: record a structured discard-reason per experiment in the
// LEDGER ENTRY *and* surface it in the propose digest.
//
// This check asserts on the SOURCE STRING the generator emits (generate('x')) — the loop body is
// config-independent, so any slug yields identical source. Mirrors scripts/test-optimize.cjs style.
// RED today: neither the ledger.push entry nor the ledgerDigest map carries a reason field.
//
// Run one-at-a-time by the whetstone loop (NOT by run.mjs). Exit 0 ONLY when resolved.
//   node plugins/lirbox/skills/prospector/evals/checks/richer-propose-failure-feedback.check.mjs
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', 'scripts', 'scaffold-optimize.cjs');
const { generate } = require(GEN);

let failures = 0;
const fail = (m) => { console.error(`FAIL ${m}`); failures++; };
const pass = (m) => console.log(`PASS ${m}`);
const ok = (cond, m) => { if (cond) { pass(m); return true; } fail(m); return false; };

const src = generate('x');

// Tolerant matcher for a reason field: any key whose name contains "reason" (reason / discardReason /
// reasonCode …), as either `name:` or a bare shorthand `name`. Scoped to a captured object body so a
// reason mention elsewhere in the source can't satisfy it.
const hasReasonKey = (objBody) =>
  /[\w]*reason[\w]*\s*:/i.test(objBody) ||           // `reason: ...` / `discardReason: ...`
  /(?:^|[{,]\s*)[\w]*reason[\w]*\s*(?=[,}])/i.test(objBody); // bare shorthand `, reason }` / `, reason,`

// ---------------------------------------------------------------------------
// ASSERT 1 — the LEDGER ENTRY the conductor pushes carries a reason on discard.
// Today: ledger.push({ g, change, metric: …, gate: gateStr, kept: keep, sha: …, sec, tokens }) — no reason → RED.
// The fix must persist a STRUCTURED reason into the ledger entry (not only the revert prompt text).
// ---------------------------------------------------------------------------
const pushMatch = src.match(/ledger\.push\(\s*\{([\s\S]*?)\}\s*\)/);
if (!ok(!!pushMatch, 'found a ledger.push({ … }) entry in the generated loop')) {
  // Shape moved entirely — cannot confirm the fix; fail loudly rather than falsely green.
} else {
  ok(hasReasonKey(pushMatch[1]),
    'ledger.push entry includes a structured reason field (gate-fail vs metric-regression vs surface-violation)');
}

// ---------------------------------------------------------------------------
// ASSERT 2 — the propose digest surfaces the reason.
// Today: ledger.map((e) => ({ g: e.g, change: e.change, metric: e.metric, kept: e.kept })) — no reason → RED.
// ---------------------------------------------------------------------------
const digestMatch = src.match(/ledgerDigest\s*=\s*JSON\.stringify\(\s*ledger\.map\(\(e\)\s*=>\s*\(\{([\s\S]*?)\}\)\s*\)\s*\)/);
if (!ok(!!digestMatch, 'found the ledgerDigest = ledger.map((e) => ({ … })) projection')) {
  // Shape moved entirely — cannot confirm the fix; fail loudly rather than falsely green.
} else {
  ok(hasReasonKey(digestMatch[1]),
    'ledgerDigest projection includes the reason so the propose agent sees WHY past experiments were discarded');
}

// Sanity: the digest is actually fed into the propose prompt (so surfacing it has effect).
ok(/\$\{ledgerDigest\}/.test(src), 'ledgerDigest is interpolated into the propose prompt');

if (failures) {
  console.error(`\nricher-propose-failure-feedback: RED — ${failures} assertion(s) failed (concern unresolved)`);
  process.exit(1);
}
console.log('\nricher-propose-failure-feedback: GREEN — discard reason recorded in the ledger AND surfaced to propose');

#!/bin/bash
# Reference solution for plan-check__goal-coverage.
#
# Proves the grader is satisfiable and that test.sh agrees with instruction.md. The finding it must
# reach: every DoD criterion is checkable and none of them measures the goal. The goal is
# end-to-end checkout responsiveness against ~2s; the DoD measures two Go microbenchmarks plus
# tests and lint. Both benchmarks can improve 40% with checkout still at 4s.
set -uo pipefail

SKILL=/root/.claude/skills/plan-check
TPL=$SKILL/assets/template.html
OUT=/app/plan-check-checkout-latency.html
[ -f "$TPL" ] || { echo "solve.sh: template not found at $TPL" >&2; exit 1; }

node - "$TPL" "$OUT" <<'NODE'
const fs = require('node:fs');
const [tpl, out] = process.argv.slice(2);
let html = fs.readFileSync(tpl, 'utf8');

const row = (attrs, q, s, prop, ev, detail, conf) =>
  `      <tr class="claim"${attrs} data-quadrant="${q}" data-status="${s}">
        <td>${prop}</td>
        <td><span class="tag q-${q}">${q}</span></td>
        <td><span class="s-${s}">${s}</span>${detail}</td>
        <td>${ev}</td>
        <td>${conf}</td>
      </tr>`;

const rows = [
  // THE mandatory goal-coverage row. Names both halves of the mismatch — the benchmarks the DoD
  // actually measures, and the end-to-end 2s threshold the goal is about.
  row(
    ' data-goal-coverage="true"',
    'unknown-known',
    'UNSTATED-ASSUMPTION',
    'If every DoD criterion were met, would the goal be achieved? <strong>No.</strong> The goal is ' +
      'end-to-end checkout responsiveness against a ~2s confirm-button threshold. Every DoD criterion ' +
      'measures something else: <code>BenchmarkTaxLookup</code> and <code>BenchmarkReserve</code> are ' +
      'microbenchmarks of two functions, plus tests and lint. Both benchmarks can improve 40%, the ' +
      'suite can be green, and checkout can still take 4s — nothing here would notice.',
    'plan.md Goal ("more than ~2s to respond") vs Definition of done (two Benchmark* targets, tests, lint) — no end-to-end measurement anywhere',
    ' <span class="fix">fix: needs-decision</span> — to clear: add a DoD criterion measuring confirm-button latency at peak against the 2s threshold.',
    'high'
  ),
  row(
    '',
    'known-unknown',
    'UNVERIFIED',
    'Tax lookup and inventory reservation are actually the dominant contributors to checkout latency. ' +
      'The plan optimises both without stating what share of the ~4s they account for.',
    'plan.md names no profile or trace; needs: a latency breakdown of the checkout path at peak',
    '',
    'medium'
  ),
].join('\n');

html = html.replace(/^\s*<tr class="claim"[\s\S]*?<\/tr>\s*$/m, rows);

const dod = {
  criteria: [
    {
      id: 'end-to-end-latency',
      text: 'Confirm-button response time at peak is under 2s (p95), measured end to end — the criterion the plan\'s own DoD is missing.',
      tier: 'checkable',
      check: 'scripts/bench-checkout.sh --p95 --max-ms 2000',
    },
    { id: 'suite-green', text: 'go test ./internal/checkout/... is green.', tier: 'checkable', check: 'go test ./internal/checkout/...' },
    { id: 'attribution', text: 'The optimised paths are shown to be the dominant latency contributors.', tier: 'judged' },
  ],
};

const fill = {
  PLAN_TITLE: 'Checkout Latency — Implementation Plan',
  PLAN_CLASS: 'code',
  DATE: '2026-08-03',
  PLAN_GOAL:
    'Stop customers abandoning checkout because the payment step feels slow — abandonment climbs ' +
    'sharply once the confirm button takes more than ~2s to respond, and we are past that at peak.',
  VERDICT: 'GO-WITH-CONDITIONS',
  VERDICT_SUMMARY:
    'Both optimisations are sound in isolation, but the plan cannot tell you whether it worked. Its ' +
    'definition of done measures two microbenchmarks and never the user-visible latency the goal is about.',
  CONDITION_1:
    'Add a DoD criterion that measures confirm-button latency end to end at peak against the 2s ' +
    'threshold, and a latency breakdown showing tax lookup and reservation are the dominant contributors.',
};

html = html.replace(
  /<script type="application\/json" id="dod">[\s\S]*?<\/script>/,
  `<script type="application/json" id="dod">${JSON.stringify(dod)}</script>`
);
for (const [k, v] of Object.entries(fill)) html = html.split(`{{${k}}}`).join(v);
html = html.replace(/\{\{[A-Z_0-9]+\}\}/g, '—');

fs.writeFileSync(out, html);
console.log(`wrote ${out}`);
NODE

node "$SKILL/assets/validate.mjs" "$OUT"

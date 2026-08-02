// ACCEPTANCE CHECK — a resume must be able to hand the retried phase information the failed run did
// not have, and that channel must reach EVERY dispatch shape.
//
// Concern (feedback/conductor.jsonl -> hints-injected). Persisting why a run failed is useless if
// the retry cannot receive the answer: without an input channel the resumed phase is regenerated
// byte-identically and walks into the same wall. `args.hints` — a { <phase title>: text } map — is
// that channel, injected into the phase's worker prompts under a fenced PRIOR-RUN CONTEXT header.
//
// Structural contract (the fixer reads this check as the spec):
//   * `args.hints[<phase title>]` reaches the workers of that phase in ALL THREE dispatch shapes:
//     the level fan-out, the single-item branch (items.length === 1), and --no-plan-fanout's serial
//     worker. A hint that only reaches the fan-out silently does nothing on the other two, which is
//     the quietest possible failure for a feature whose entire job is carrying information forward.
//   * gate workers receive it too — a convergence stall is re-entered through a gate, not the plan.
//   * injection is CONDITIONAL: with no hint for a phase, nothing is added to its prompts. The
//     generator's per-scaffold token cost was cut ~42% in #51; an unconditional block would hand
//     part of that back on every happy-path run, where hints are always empty.
//
// Baseline: RED. There is no HINTS binding at all, so assertions 1-4 fail. Assertion 5 (the
// conditional/no-cost control) passes on baseline and only goes RED under an unconditional
// implementation — it is the guard against "fixing" this by always emitting the header.
//
// RED-for-the-right-reason: assertions 0 and 5 stay GREEN on baseline, so a RED verdict is the
// MISSING channel, not generator breakage.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generate, parses, runBody } from './body-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..');
const GEN = process.env.GEN_OVERRIDE || resolve(REPO, 'plugins/lirbox/skills/conductor/scripts/scaffold-workflow.cjs');
const TMP = mkdtempSync(join(tmpdir(), 'hints-check-'));

const PHASE = 'Implement';
const SENTINEL = 'HINT-SENTINEL-9f3a';
const promptsFile = join(TMP, 'prompts.json');
writeFileSync(promptsFile, JSON.stringify({ [PHASE]: 'Do the work.' }));

const TWO = [
  { id: 'i1', title: 'first', prompt: 'do first', dependsOn: [] },
  { id: 'i2', title: 'second', prompt: 'do second', dependsOn: [] },
];
const ONE = [{ id: 'i1', title: 'only', prompt: 'do only', dependsOn: [] }];

const results = [];
const ok = (pass, msg) => { results.push({ pass, msg }); console.log(`${pass ? 'PASS' : 'FAIL'} ${msg}`); };

// Phase titles declared in the emitted meta — hints are keyed by these.
const phaseTitles = (src) => {
  const m = src.match(/export const meta = \{[\s\S]*?\n\}/);
  return m ? [...m[0].matchAll(/\{ title: '([^']+)' \}/g)].map((x) => x[1]) : [];
};

// Dispatch a scaffold with a hint for every declared phase; return the prompts each phase saw.
async function promptsFor(label, argv, items) {
  const gen = generate({ gen: GEN, repo: REPO, tmp: TMP, name: `hints-${label}`, argv });
  if (gen.code !== 0 || !parses(gen.file)) return { ok: false, byPhase: {}, titles: [] };
  const src = readFileSync(gen.file, 'utf8');
  const titles = phaseTitles(src);
  const hints = Object.fromEntries(titles.map((t) => [t, `${SENTINEL}::${t}`]));
  const run = await runBody(src, ({ label: l, base }) => (/^plan:/.test(l) ? { ...base, items } : undefined), { hints });
  return { ok: true, calls: run.calls, titles, src };
}

// Deliberately label-scoped, not phase-scoped: the planner runs in the same phase as the item
// workers, so a phase-wide assertion would go green on an implementation that fed the hint ONLY to
// the planner and never to the worker that does the work.
const carries = (r, labelRe, phase) =>
  (r.calls || []).some((c) => labelRe.test(c.label) && String(c.prompt).includes(`${SENTINEL}::${phase}`));

const fanout = await promptsFor('fanout', ['--phases', PHASE, '--prompts-file', promptsFile], TWO);
const single = await promptsFor('single', ['--phases', PHASE, '--prompts-file', promptsFile], ONE);
const serial = await promptsFor('serial', ['--phases', PHASE, '--no-plan-fanout', '--prompts-file', promptsFile], TWO);
const gated = await promptsFor('gated', ['--phases', PHASE, '--enforce-code', '--prompts-file', promptsFile], TWO);

ok(fanout.ok && single.ok && serial.ok && gated.ok,
  '0. all four scaffolds generate and parse');

ok(carries(fanout, /^implement:i\d+$/, PHASE),
  '1. level fan-out: the phase hint reaches the ITEM workers (not merely the planner)');

ok(carries(single, /^implement$/, PHASE),
  '2. single-item branch (items.length === 1): the phase hint reaches the worker');

ok(carries(serial, /^implement$/, PHASE),
  '3. --no-plan-fanout: the phase hint reaches the serial worker');

const gatePhase = (gated.titles || []).find((t) => /gate/i.test(t));
ok(!!gatePhase && carries(gated, /^codegate:r\d+$/, gatePhase),
  `4. gate workers receive their phase hint (${gatePhase || 'no gate phase found'})`);

// 5. No hint for a phase => nothing added. Guards against an unconditional header that costs tokens
//    on every happy-path run.
const genPlain = generate({ gen: GEN, repo: REPO, tmp: TMP, name: 'hints-none', argv: ['--phases', PHASE, '--prompts-file', promptsFile] });
const plain = await runBody(readFileSync(genPlain.file, 'utf8'),
  ({ label, base }) => (/^plan:/.test(label) ? { ...base, items: TWO } : undefined), {});
ok(!plain.calls.some((c) => /PRIOR-RUN CONTEXT/i.test(c.prompt) || c.prompt.includes(SENTINEL)),
  '5. with no hints, no PRIOR-RUN CONTEXT block is emitted (injection is conditional)');

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — a resumed run has no way to `
    + `receive what the failed run learned, so gathered information cannot reach the retried phase.`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${results.length} hint-channel assertions passed.`);
process.exit(0);

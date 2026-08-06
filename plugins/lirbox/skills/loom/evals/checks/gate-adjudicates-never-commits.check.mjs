// CHECK — a `gate` node must ADJUDICATE, never repair. The shipped delivery/lite seeds told
// Review to "Fix every Critical and High finding, keep the build green, and commit", so the
// gate fixed the work itself and then reported passed=true. Its own failing back-edge
// (Review --passed:false--> Implement) became unreachable: the only way to take it was to
// FAIL at fixing, never to DECIDE the work was wrong. Measured across four real runs — the
// back-edge fired 0/3 with that prompt and 1/1 after swapping it for an adjudicate-only one,
// same graph, same edges, same goal, same model. A gate that repairs is a second implementer
// wearing a gate's label, and it silently disarms the one behaviour loom has over conductor.
//
// This is a PROSE invariant, so it is matched with regexes rather than structure. Negated
// forms ("do not fix", "never commit") are stripped BEFORE the mutation scan, so a prompt
// that forbids mutation is not flagged for naming it.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS = resolve(HERE, '..', '..', 'scripts', 'seeds');

// Mutation hatch for scripts/prove-checks.mjs: it copies the skill tree, mutates ONE seed in
// the copy, and points this variable at it. Without the hatch this check cannot be
// mutation-proven, and an unproven check is not known to be measuring anything.
const OVERRIDE = process.env.LOOM_SEED_OVERRIDE || '';
const seedFile = (profile) =>
  (OVERRIDE && OVERRIDE.endsWith(`${profile}.json`)) ? OVERRIDE : join(SEEDS, `${profile}.json`);

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// "do not fix", "don't commit", "never edit the files" — a prohibition, not an instruction.
const NEGATED = /\b(?:do not|do NOT|don't|never)\s+(?:\w+\s+){0,3}?(?:fix|commit|edit|modify|repair|change)\b/gi;
// An instruction to mutate the work under review.
const MUTATES = /\b(?:commit|fix every|fix all|repair|make the change)\b/i;
// An explicit statement that this node measures rather than mutates.
const ADJUDICATES = /(?:measure only|adjudicate only|do not fix|adjudicate and (?:reject|report)|change nothing|you are a gate)/i;

let gates = 0;
for (const profile of ['lite', 'delivery']) {
  const seed = JSON.parse(readFileSync(seedFile(profile), 'utf8'));

  for (const node of seed.nodes) {
    if (node.kind !== 'gate') continue;
    gates++;
    const prompt = String(node.prompt || '');
    const scanned = prompt.replace(NEGATED, ' ');

    ok(!MUTATES.test(scanned),
      `${profile}/${node.id}: prompt does not instruct the gate to mutate the work`);
    ok(ADJUDICATES.test(prompt),
      `${profile}/${node.id}: prompt states the node adjudicates rather than fixes`);
  }
}

// A check that scanned nothing proves nothing.
ok(gates >= 3, `scanned every gate in both seeds (found ${gates}, expected >= 3)`);

if (bad) { console.error(`\ngate-adjudicates-never-commits: ${bad} failed`); process.exit(1); }
console.log('gate-adjudicates-never-commits: ok');

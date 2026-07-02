// FLOOR (characterization) — conductor's load-bearing rules must remain DOCUMENTED.
//
// The bloat concern is fixed by RELOCATING prose into references/ (progressive disclosure),
// NOT by deleting meaning. This floor pins that distinction: it asserts each load-bearing
// invariant / public-API token still appears SOMEWHERE under the skill dir — SKILL.md OR any
// references/*.md. So:
//   - moving a section into references/  → token still in the corpus → floor GREEN  (legit fix)
//   - deleting the section outright      → token gone from corpus     → floor RED    (reverted)
// It is relocation-agnostic on purpose; it does not care WHICH file holds the content, only
// that the skill still teaches it. PASSES on baseline.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');             // .../skills/conductor

// Corpus = SKILL.md + every references/*.md (relocation target). Lowercased for case tolerance.
let corpus = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
try {
  const refDir = join(SKILL_DIR, 'references');
  for (const f of readdirSync(refDir).filter((f) => f.endsWith('.md')).sort()) {
    corpus += '\n' + readFileSync(join(refDir, f), 'utf8');
  }
} catch { /* no references/ dir yet — SKILL.md alone is the corpus */ }
corpus = corpus.toLowerCase();

// Load-bearing anchors: invariants a reader depends on + public CLI surface of the generator.
// Each MUST survive any legitimate refactor; losing one is meaning-loss, not concision.
const ANCHORS = [
  // two-layer purity + durable state
  'no filesystem', 'math.random', 'checkpoint', 'state.json',
  // shared-worktree isolation
  'worktree', '.worktrees',
  // resume protocol + integrity guard
  'phasesdone', 'contiguous',
  // non-destructive default
  'auto-merge',
  // triage / decline overkill
  'decline', 'triage',
  // generator is source-of-truth; regenerate, never hand-edit
  '--force', 'hand-edit',
  // idempotency / at-least-once semantics
  'idempotent', 'at-least-once',
  // parallel() gotcha
  'filter(boolean)',
  // durable != unattended
  'unattended',
  // public generator flags (the skill's API — dropping docs for one is a real regression)
  '--enforce-code', '--enforce-tests', '--enforce-docs', '--cycle',
  '--profile delivery', '--profile lite', '--model-mode',
  // writeup / delivery artifacts
  'docs/changes', 'implementation-notes',
  // TDD cycle stages
  'pathgap', 'reverify',
];

let failures = 0;
for (const a of ANCHORS) {
  if (corpus.includes(a)) {
    console.log(`PASS floor: anchor documented — "${a}"`);
  } else {
    console.error(`FAIL floor: load-bearing anchor missing from skill corpus — "${a}" (deleted, not relocated?)`);
    failures++;
  }
}

if (failures) { console.error(`\n02-content-anchors: ${failures} load-bearing anchor(s) lost`); process.exit(1); }
console.log(`02-content-anchors: ok (${ANCHORS.length} anchors documented)`);

// Shared harness for the dod-gate checks: a throwaway git repo per scenario, the gate run as a
// subprocess inside it. DOD_GATE_OVERRIDE points at the dod-gate.mjs under test (set by
// prove-checks for mutation-testing).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = process.env.DOD_GATE_OVERRIDE || join(here, '..', '..', '..', 'scripts', 'dod-gate.mjs');

export function repo() {
  const d = mkdtempSync(join(tmpdir(), 'dodgate-'));
  spawnSync('git', ['init', '-q'], { cwd: d });
  return d;
}

export function run(cwd, args, input) {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd, input, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

export const freeze = (cwd, slug, criteria, by = 'main') =>
  run(cwd, ['freeze', '--run', slug, '--dod', '-', '--by', by], JSON.stringify({ criteria }));

export const GOOD_SUMMARY = '---\ntitle: t\ndate: 2026-01-01\nbranch: b\n---\nWhat changed and why.\n';

export function docs(cwd, slug, { summary = GOOD_SUMMARY, notes = 'decided X over Y\n' } = {}) {
  const d = join(cwd, 'docs', 'changes', slug);
  mkdirSync(d, { recursive: true });
  if (summary !== null) writeFileSync(join(d, 'summary.md'), summary);
  if (notes !== null) writeFileSync(join(d, 'implementation-notes.md'), notes);
}

export function checker(name) {
  const failures = [];
  return {
    expect(why, got, want) { if (got !== want) failures.push(`${why} (wanted ${want}, got ${got})`); },
    ok(why, cond) { if (!cond) failures.push(why); },
    done() {
      if (failures.length) {
        console.error(`RED ${name}:\n  - ` + failures.join('\n  - '));
        process.exit(1);
      }
      console.log(`GREEN ${name}`);
    },
  };
}

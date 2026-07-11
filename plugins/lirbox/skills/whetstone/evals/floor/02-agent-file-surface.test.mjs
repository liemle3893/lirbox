// ACCEPTANCE CHECK (RED on baseline) — scaffold-readiness.cjs must accept an agent FILE surface.
//
// Concern (feedback/whetstone.jsonl → agent-file-surface): whetstone's surface is a skill
// DIRECTORY (init mode seeds <skillPath>/evals/ and requires <skillPath>/SKILL.md), so
// single-file plugin agents (plugins/lirbox/agents/<name>.md) cannot enter the whetstone
// lifecycle. Expected fix: when --skill-path points at a plugins/<plugin>/agents/<name>.md FILE,
// treat editable = that one file, seed a readiness layout FOR THE AGENT (an evals/checks-style
// location tied to the agent name — NOT under the .md path, a file can't be a dir) plus the
// empty backlog feedback/<name>.jsonl.
//
// Discriminating command (run in a synthetic temp repo, never the real one):
//   node <repo>/plugins/lirbox/skills/whetstone/scripts/scaffold-readiness.cjs \
//     --name lirbox-web-verifier --skill-path plugins/lirbox/agents/lirbox-web-verifier.md
//
//   - baseline: the script rejects the non-directory path ("no SKILL.md at
//     plugins/lirbox/agents/lirbox-web-verifier.md/SKILL.md") → exit 1 → assertion (1) fails (RED)
//   - after the fix: exit 0 + feedback/lirbox-web-verifier.jsonl (empty) + an existing
//     evals/checks location tied to the agent + nothing under <agent>.md/evals → GREEN
//
// Deterministic: no network, no timestamps asserted. Runs the REAL script against a temp fixture
// repo (mkdtemp) and cleans it up in a finally block.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, isAbsolute, sep } from 'node:path';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  statSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));               // .../whetstone/evals/checks
const SKILL_DIR = resolve(HERE, '..', '..');                        // .../skills/whetstone
const SCRIPT = resolve(SKILL_DIR, 'scripts', 'scaffold-readiness.cjs');

const AGENT = 'lirbox-web-verifier';
const AGENT_REL = join('plugins', 'lirbox', 'agents', `${AGENT}.md`);

let bad = 0;
function ok(cond, msg) {
  if (cond) console.log(`PASS  ${msg}`);
  else { console.error(`FAIL  ${msg}`); bad++; }
}

// ---- fixture repo (temp, never the real repo) -------------------------------
const repo = mkdtempSync(join(tmpdir(), 'whetstone-agent-file-surface-'));
try {
  const agentAbs = join(repo, AGENT_REL);
  mkdirSync(dirname(agentAbs), { recursive: true });
  writeFileSync(agentAbs, [
    '---',
    `name: ${AGENT}`,
    'description: Synthetic agent fixture — verifies web claims before they ship.',
    '---',
    '',
    'You verify web-facing claims. Tiny synthetic body for the fixture.',
    '',
  ].join('\n'));

  // ---- run the REAL script with cwd = temp repo -----------------------------
  let stdout = '';
  let code = 0;
  try {
    stdout = execFileSync(
      'node',
      [SCRIPT, '--name', AGENT, '--skill-path', AGENT_REL],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : 1;
    stdout = String(e.stdout || '');
    const stderr = String(e.stderr || '');
    if (stderr.trim()) console.error(`--- script stderr ---\n${stderr.trim()}\n---------------------`);
  }
  if (stdout.trim()) console.log(`--- script stdout ---\n${stdout.trim()}\n---------------------`);

  // (1) exit code 0 — the agent-file surface is accepted, not rejected.
  ok(code === 0, `(1) exit 0 for --skill-path ${AGENT_REL} (got exit ${code})`);

  // (2) an EMPTY backlog feedback/lirbox-web-verifier.jsonl was created in the temp repo.
  const backlog = join(repo, 'feedback', `${AGENT}.jsonl`);
  const backlogExists = existsSync(backlog) && statSync(backlog).isFile();
  const backlogEmpty = backlogExists &&
    readFileSync(backlog, 'utf8').split('\n').every((l) => l.trim() === '');
  ok(backlogExists, `(2) backlog file feedback/${AGENT}.jsonl exists`);
  ok(backlogEmpty, `(2) backlog feedback/${AGENT}.jsonl is empty (no items)`);

  // (3) a readiness layout FOR THE AGENT was seeded: an evals/checks-style location tied to the
  // agent that exists on disk. Accept any plausible layout: the two fixed candidates, or any path
  // the script PRINTED (e.g. "wrote <path>" lines) containing both the agent name and "evals".
  const candidates = new Set([
    join('plugins', 'lirbox', 'agents', 'evals', AGENT),
    join('plugins', 'lirbox', 'agents', `${AGENT}.evals`),
  ]);
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*(?:wrote|skip \(exists\))\s+(\S+)/);
    if (m) candidates.add(m[1]);
    else {
      // also accept bare printed paths on other lines (e.g. an "editable/locked" summary)
      for (const tok of line.split(/\s+/)) {
        if (tok.includes(AGENT) && tok.includes('evals')) candidates.add(tok);
      }
    }
  }
  const badDirPrefix = AGENT_REL + sep;                             // <agent>.md/... is illegal
  const evalsHits = [...candidates].filter((p) => {
    if (!p.includes(AGENT) || !p.includes('evals')) return false;
    if (p.includes(badDirPrefix)) return false;                     // never under the .md "dir"
    const abs = isAbsolute(p) ? p : join(repo, p);
    if (!abs.startsWith(repo)) return false;                        // must live in the temp repo
    return existsSync(abs);                                         // the path ITSELF must exist
  });
  ok(evalsHits.length > 0,
    `(3) an evals/checks location tied to "${AGENT}" was seeded and exists on disk` +
    (evalsHits.length ? ` (${evalsHits[0]})` : ''));

  // (4) it did NOT scaffold the skill-directory layout under the agent FILE path.
  const impossible = join(repo, AGENT_REL, 'evals');                // a file can't be a dir
  const printedUnderMd = stdout.includes(badDirPrefix);
  ok(!existsSync(impossible) && !printedUnderMd,
    `(4) nothing scaffolded (or printed) under ${AGENT_REL}${sep}evals — a file is not a dir`);
  const agentStillFile = existsSync(agentAbs) && statSync(agentAbs).isFile();
  ok(agentStillFile, `(4) ${AGENT_REL} is still a plain file after the run`);

  if (bad) {
    console.error(`\nagent-file-surface: RED — ${bad} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nagent-file-surface: GREEN — agent FILE surfaces are whetstone-ready.');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

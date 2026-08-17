#!/usr/bin/env node
// Frozen check: the recovery contract can tell a STOPPED lane from a wedged one.
//
// The invariant, in one line: flat tokens and flat cost describe two different
// states with two different remedies, and the contract has to carry a probe that
// actually separates them.
//
// Why it exists. A `T` process is alive and holding all its memory, but the
// kernel will not schedule it and it resumes on SIGCONT alone — SIGINT is not
// delivered until it does. The recovery table read only tokens and cost, so a
// stopped lane classified as `wedged`, took `ctrl+c` forever, and got written off
// as `dead` with its worktree and its work intact. The previous contract went
// further and *banned* the process-state check ("no subprocess"), on the correct
// observation that herdr exposes no pid — which removed the only signal that
// separates the two.
//
// This does not assert wording. It extracts every `ps` probe the recovery section
// offers, stops a process that looks exactly like a lane harness, and requires
// one of those probes to find it. A probe that stops measuring fails here.
//
// LANES_SKILL_OVERRIDE points at the SKILL.md under test (set by prove-checks).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillPath = process.env.LANES_SKILL_OVERRIDE
  || join(here, '..', '..', 'SKILL.md');
const skill = readFileSync(skillPath, 'utf8');

const fail = (m) => { throw new Error(m); };

// -- the recovery section ----------------------------------------------------
const start = skill.indexOf('### 6. Recover a lane');
if (start === -1) fail('SKILL.md has no "### 6. Recover a lane" section — the recovery contract is gone');
const rest = skill.slice(start + 1);
const end = rest.indexOf('\n### ');
const section = end === -1 ? rest : rest.slice(0, end);

// The remedy is the half a probe cannot prove: freeing a stopped process is
// SIGCONT and nothing else. The recovery table has to carry a row for the `T`
// state, and that row's move has to be CONT — a row that detects the state and
// still answers ctrl+c has not been fixed.
const rows = section.split('\n').filter((l) => l.trim().startsWith('|'));
const stopRow = rows.find((r) => /(^|[^A-Za-z])`?T`?([^A-Za-z]|$)/.test(r.split('|')[1] || ''));
if (!stopRow) {
  fail('the recovery table has no row for a process in state `T` — a stopped lane is read as a wedge, takes ctrl+c forever, and is written off as dead with its work intact');
}
if (!/CONT/.test(stopRow)) {
  fail(`the stopped row names no CONT remedy — ctrl+c cannot land on a stopped process, so this row frees nothing:\n  ${stopRow.trim()}`);
}

// -- every ps probe the section offers ---------------------------------------
const probes = [...section.matchAll(/```[a-z]*\n([\s\S]*?)```/g)]
  .map((m) => m[1].trim())
  .filter((b) => /^ps\s/.test(b));
if (!probes.length) {
  fail('the recovery section carries no runnable `ps` probe — process state is the only signal that separates a stop from a wedge, and tokens/cost do not');
}

// -- a fixture that looks like a lane harness, stopped ------------------------
const box = mkdtempSync(join(tmpdir(), 'lanes-stopped-'));
const fake = join(box, 'opencode');
writeFileSync(fake, '#!/bin/sh\nsleep 300\n');
chmodSync(fake, 0o755);

const cleanup = (pid) => {
  if (pid) { try { process.kill(pid, 'SIGCONT'); } catch {} try { process.kill(pid, 'SIGKILL'); } catch {} }
  rmSync(box, { recursive: true, force: true });
};

const child = spawn(fake, ['--agent', 'probe', '--model', 'probe'], { stdio: 'ignore' });
const pid = child.pid;
child.on('error', () => {});

const argvOf = (p) => {
  try { return execFileSync('ps', ['-o', 'command=', '-p', String(p)], { encoding: 'utf8' }); }
  catch { return ''; }
};
const statOf = (p) => {
  try { return execFileSync('ps', ['-o', 'stat=', '-p', String(p)], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

// argv only matches once the exec has landed; stopping before that leaves the
// fixture named after the shell and the whole run proves nothing.
const deadline = Date.now() + 10_000;
while (!argvOf(pid).includes('opencode --agent') && Date.now() < deadline) { /* spin */ }
if (!argvOf(pid).includes('opencode --agent')) {
  cleanup(pid);
  fail('harness rot: the fixture never showed a lane-shaped argv, so nothing was measured');
}

try { process.kill(pid, 'SIGSTOP'); } catch (e) { cleanup(pid); fail(`harness rot: could not stop the fixture (${e.message})`); }
const stopDeadline = Date.now() + 10_000;
while (!statOf(pid).startsWith('T') && Date.now() < stopDeadline) { /* spin */ }
if (!statOf(pid).startsWith('T')) {
  cleanup(pid);
  fail(`harness rot: the fixture did not reach T (stat=${statOf(pid)}), so nothing was measured`);
}

// -- does any documented probe find it? --------------------------------------
let found = null;
for (const probe of probes) {
  let out = '';
  try { out = execFileSync('sh', ['-c', probe], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { out = (e.stdout || ''); }   // grep/awk exit 1 on no match
  if (out.split('\n').some((l) => l.trim().startsWith(String(pid)))) { found = probe; break; }
}

cleanup(pid);

if (!found) {
  fail(`no probe in the recovery section detected a stopped lane harness (pid ${pid}, stat T). The section offered:\n  ${probes.join('\n  ')}`);
}

console.log('stopped-is-not-wedged: OK');

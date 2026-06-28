// ACCEPTANCE-CHECK (whetstone item: effort-think) — RED on baseline, GREEN after the fix.
//
// Concern: in --model-mode auto, think-class agent() calls should also carry effort: 'high';
// mechanical/work phases must NOT get an effort opt. Asserts a think phase (CodeGate) carries
// effort: 'high' and a mechanical phase (PR) does not, in a generated auto delivery script.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', 'scripts', 'scaffold-workflow.cjs');
const out = join(mkdtempSync(join(tmpdir(), 'wschk-eff-')), 'wf.js');

execFileSync('node', [GEN, '--name', 'g', '--out', out, '--force', '--phases', 'Implement', '--profile', 'delivery', '--model-mode', 'auto'], { stdio: 'pipe' });
const src = readFileSync(out, 'utf8');

let ok = true;
if (!/phase: 'CodeGate',[^\n]*effort: 'high'/.test(src)) { console.error("FAIL: CodeGate (think-class) lacks effort: 'high' in auto mode"); ok = false; }
if (!/phase: 'RED',[^\n]*effort: 'high'/.test(src)) { console.error("FAIL: RED (think-class) lacks effort: 'high' in auto mode"); ok = false; }
if (/phase: 'PR',[^\n]*effort:/.test(src)) { console.error('FAIL: PR (mechanical) must not carry an effort opt'); ok = false; }
if (/phase: 'Implement',[^\n]*effort:/.test(src)) { console.error('FAIL: work phase must not carry an effort opt'); ok = false; }

if (!ok) process.exit(1);
console.log("PASS: think phases carry effort: 'high'; mechanical/work phases do not");

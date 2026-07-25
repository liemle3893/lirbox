// ACCEPTANCE-CHECK (whetstone item: model-mode-auto-by-default) — RED on baseline, GREEN after the fix.
//
// Concern: --model-mode's default is backwards. `auto` (tier workers by phase class) is what we
// want on essentially every run but must be opted into, so real runs silently inherit the session
// model everywhere. Flip it: `auto` is the DEFAULT; the old no-model-opt behavior becomes
// `--model-mode inherit`; the literal `default` hard-errors pointing at `inherit`; and the
// --model-think/--model-work guard inverts (valid with no flag, rejected under `inherit`).
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', 'scripts', 'scaffold-workflow.cjs');
const dir = mkdtempSync(join(tmpdir(), 'wschk-mmauto-'));

// Generate into a fresh file; returns { exit, stderr, src } (src '' when generation failed).
function gen(tag, extra) {
  const out = join(dir, tag + '.js');
  try {
    execFileSync('node', [GEN, '--name', 'g', '--out', out, '--force', ...extra], { stdio: 'pipe' });
  } catch (e) {
    return { exit: typeof e.status === 'number' ? e.status : 1, stderr: String(e.stderr || ''), src: '' };
  }
  return { exit: 0, stderr: '', src: readFileSync(out, 'utf8') };
}

const DELIVERY = ['--phases', 'Implement', '--profile', 'delivery', '--no-dod'];
let ok = true;
const fail = (m) => { console.error('FAIL: ' + m); ok = false; };

// (a) NO --model-mode flag → auto is the default, so the tiered opts must be emitted.
const noFlag = gen('noflag', DELIVERY);
if (noFlag.exit !== 0) {
  fail(`generating with no --model-mode flag exited ${noFlag.exit}\n${noFlag.stderr}`);
} else {
  const s = noFlag.src;
  if (!/phase: phaseTitle, model: 'haiku'/.test(s)) fail("default: checkpoint worker not tiered to haiku");
  if (!/phase: 'Setup', model: 'haiku'/.test(s)) fail("default: Setup not tiered to haiku");
  if (!/phase: 'Verify', model: 'haiku'/.test(s)) fail("default: Verify not tiered to haiku");
  if (!/phase: 'RED',[^\n]*model: 'opus',[^\n]*effort: 'high'/.test(s)) fail("default: RED not tiered to the think model with effort: 'high'");
  if (!/phase: 'CodeGate',[^\n]*model: 'opus',[^\n]*effort: 'high'/.test(s)) fail("default: CodeGate not tiered to the think model with effort: 'high'");
  if (!/phase: 'Implement',[^\n]*model: 'sonnet'/.test(s)) fail("default: the work phase not tiered to the work model");
  if (/phase: 'Implement',[^\n]*effort:/.test(s)) fail('default: the work phase must not carry an effort opt');
}

// (b) --model-mode inherit → the byte-cost-free mode: no model:/effort: opt anywhere.
const inherit = gen('inherit', [...DELIVERY, '--model-mode', 'inherit']);
if (inherit.exit !== 0) {
  fail(`--model-mode inherit exited ${inherit.exit}; it must be a valid mode\n${inherit.stderr}`);
} else {
  if (/\bmodel: '/.test(inherit.src)) fail('--model-mode inherit emitted a model: opt; it must emit none');
  if (/\beffort: '/.test(inherit.src)) fail('--model-mode inherit emitted an effort: opt; it must emit none');
}

// (c) The literal `default` must hard-error and point at `inherit` (the word no longer names the default).
const legacy = gen('legacy', [...DELIVERY, '--model-mode', 'default']);
if (legacy.exit === 0) fail('--model-mode default was accepted; it must exit non-zero now that auto is the default');
else if (!/inherit/.test(legacy.stderr)) fail('--model-mode default errored but its stderr does not name `inherit`:\n' + legacy.stderr);

// (d) The tuning-flag guard inverts: valid with no mode flag, rejected under `inherit`.
if (gen('tune-noflag', [...DELIVERY, '--model-think', 'fable']).exit !== 0) {
  fail('--model-think with no --model-mode flag was rejected; auto is the default, so it must be accepted');
}
if (gen('tune-inherit', [...DELIVERY, '--model-mode', 'inherit', '--model-think', 'fable']).exit === 0) {
  fail('--model-think under --model-mode inherit was silently accepted; it must error');
}
if (gen('tune-inherit-w', [...DELIVERY, '--model-mode', 'inherit', '--model-work', 'fable']).exit === 0) {
  fail('--model-work under --model-mode inherit was silently accepted; it must error');
}

if (!ok) process.exit(1);
console.log('PASS: auto is the default model mode; inherit is byte-cost-free; `default` hard-errors; the tuning guard is inverted');

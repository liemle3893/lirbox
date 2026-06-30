// FLOOR (behavior characterization) — scrub.cjs redacts PII/secrets and leaves clean prose intact.
// This is the load-bearing behavior test the floor pins. Locked (evals/**): the whetstone fixer may
// NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');
const SCRUB = join(SKILL_DIR, 'scripts', 'scrub.cjs');

const scrub = (text) => execFileSync('node', [SCRUB], { input: text, encoding: 'utf8' });

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS scrub: ${m}`); } else { console.error(`FAIL scrub: ${m}`); bad++; } };

// 1. Redaction of each PII/secret class.
const dirty = scrub(
  'ran in /Users/alice/Documents/secret-proj; ping alice@acme.com or 10.20.30.40; ' +
  'see https://internal.acme.com/a/b; token ghp_ABCDEFGHIJKLMNOPQRST1234'
);
ok(!/alice/.test(dirty) && !/\/Users/.test(dirty), 'home path + username redacted');
ok(!/acme\.com/.test(dirty) && !/@/.test(dirty), 'email + URL host redacted');
ok(!/10\.20\.30\.40/.test(dirty), 'IPv4 redacted');
ok(!/ghp_/.test(dirty), 'token redacted');

// 2. No over-redaction of clean prose.
const clean = 'The flowchart skill mislabeled node 3 so the diagram looked wrong. Expected escaped labels.';
ok(scrub(clean).trim() === clean.trim(), 'clean prose passes through unchanged');

if (bad) { console.error(`\n01-scrub: ${bad} assertion(s) failed`); process.exit(1); }
console.log('01-scrub: ok');

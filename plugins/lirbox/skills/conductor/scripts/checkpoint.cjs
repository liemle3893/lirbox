#!/usr/bin/env node
// Writes the durable state file. The checkpoint WORKER runs this; it does not
// author the file.
//
// The conductor is pure JS with no `fs` — that rule is load-bearing and stays —
// so the payload has to travel through a worker to reach disk. What did not have
// to travel with it was the mechanism: a heredoc into a temp file, a `node -e`
// one-liner doing a startedAt-preserving merge, an unlink, and a second `node -e`
// to re-parse. Four steps of bookkeeping in a prompt, every one of them a place a
// language model can deviate, for a payload that was already machine-generated.
//
// The payload still arrives from the conductor. Everything done to it is here.
//
//   node checkpoint.cjs --state <path>   < payload.json
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const die = (m) => { console.error(`checkpoint: ${m}`); process.exit(1); };
let state = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--state') { state = argv[++i]; }
  else die(`unexpected argument: ${argv[i]}`);
}
if (!state) die('usage: checkpoint.cjs --state <path>   (payload JSON on stdin)');

let raw;
try { raw = fs.readFileSync(0, 'utf8'); } catch { die('could not read the payload from stdin'); }
if (!raw.trim()) die('empty payload on stdin — nothing to persist');

let next;
try { next = JSON.parse(raw); } catch (e) { die(`payload is not valid JSON: ${e.message}`); }
if (!next || typeof next !== 'object' || Array.isArray(next)) die('payload must be a JSON object');

// startedAt belongs to the RUN, not to this write: a resume that reset it would
// make every elapsed figure the age of the last checkpoint instead.
let prev = {};
try { prev = JSON.parse(fs.readFileSync(state, 'utf8')); } catch { /* first write */ }
const now = new Date().toISOString();
next.startedAt = prev.startedAt || now;
next.updatedAt = now;

fs.mkdirSync(path.dirname(state), { recursive: true });
// Write-then-rename: a checkpoint interrupted mid-write used to leave truncated
// JSON where the resume protocol looks for its state, which reads as a corrupt
// run rather than an interrupted one.
const tmp = `${state}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
JSON.parse(fs.readFileSync(tmp, 'utf8'));      // it parses before it is the state file
fs.renameSync(tmp, state);
console.log(`OK ${state} phasesDone=${(next.phasesDone || []).length} status=${next.status || '?'}`);

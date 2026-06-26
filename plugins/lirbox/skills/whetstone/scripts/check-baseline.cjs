#!/usr/bin/env node
// Discrimination gate: a legitimate acceptance-check must FAIL on the unmodified baseline
// (fail-before / pass-after). Run from a clean baseline worktree. Exit 0 iff the check fails there.
const { execSync } = require('child_process');
const cmd = process.argv.slice(2).join(' ');
if (!cmd) { console.error('usage: check-baseline.cjs <acceptance-check command>'); process.exit(2); }
let passed;
try { execSync(cmd, { stdio: 'ignore' }); passed = true; } catch { passed = false; }
if (passed) { console.error('NON-DISCRIMINATING: check passes on the baseline — it proves nothing. Reject/strengthen it.'); process.exit(1); }
console.log('DISCRIMINATING: check fails on baseline as required.'); process.exit(0);

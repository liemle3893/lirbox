#!/usr/bin/env node
// Frozen check: a judged criterion is met only by a verdict from somebody other than the run's
// implementor, carrying evidence, recorded THIS round.
//
// This is the verifier the posts keep: one subagent that sees the result, not the build history.
// Its value is independence, so the gate refuses a verdict from the implementor, refuses one with
// no evidence, refuses a verdict on a checkable criterion (its command decides it), treats a
// missing verdict as unmet, and consumes verdicts per round — after a fix, a ruling on the code
// before the fix is a ruling on code that no longer exists.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { checker, docs, freeze, repo, run } from './lib/gate-harness.mjs';

const c = checker('judged-needs-independent-verdict');
const cwd = repo();
const verdict = (slug, id, by, evidence = 'read the diff') =>
  run(cwd, ['verdict', '--run', slug, '--id', id, '--met', 'yes', '--evidence', evidence, '--by', by]).code;
const gate = (slug) => run(cwd, ['gate', '--run', slug]).code;

// Run j: one judged criterion, one checkable that is met.
docs(cwd, 'j');
freeze(cwd, 'j', [
  { id: 'ux', tier: 'judged', text: 'error message names the bad field' },
  { id: 't', tier: 'checkable', text: 'met', check: 'true' },
]);
c.expect('a judged criterion with no verdict passed the gate', gate('j'), 1);
c.expect('the implementor recorded a verdict on its own work', verdict('j', 'ux', 'main'), 2);
c.expect('a verdict with blank evidence was recorded', verdict('j', 'ux', 'lirbox-verifier', ' '), 2);
c.expect('a verdict on a checkable criterion was recorded', verdict('j', 't', 'lirbox-verifier'), 2);
c.expect('an independent verdict with evidence was refused', verdict('j', 'ux', 'lirbox-verifier'), 0);
c.expect('an independently judged, fully met run did not pass', gate('j'), 0);

// Run k: the verdict from round 1 must not carry into round 2 after the code changed.
docs(cwd, 'k');
freeze(cwd, 'k', [
  { id: 'ux', tier: 'judged', text: 'error message names the bad field' },
  { id: 'fixed', tier: 'checkable', text: 'the fix exists', check: 'test -f fixed' },
]);
verdict('k', 'ux', 'lirbox-verifier');
c.expect('round 1 passed with the fix missing', gate('k'), 1);
writeFileSync(join(cwd, 'fixed'), '');
c.expect('round 2 reused round 1\'s verdict on code that has since changed', gate('k'), 1);

c.done();

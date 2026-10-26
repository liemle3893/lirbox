#!/usr/bin/env node
// Frozen check: a DoD is frozen once and never edited, and it has no cap on its size.
//
// The old conductor baked its criteria into the generated script, so nothing in the loop could
// loosen them. The single-loop rebuild keeps them in a file the loop can reach — so the gate has to
// notice an edit (hash), refuse a re-freeze, and refuse a checkable criterion with no command (a
// wish, not a check). And the owner's explicit rule: no limit on the number of criteria — a cap is
// how a ticket's acceptance criteria get silently dropped to fit.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, docs, freeze, repo, run } from './lib/gate-harness.mjs';

const c = checker('dod-frozen');
const cwd = repo();
docs(cwd, 'a');

c.expect('a valid DoD did not freeze', freeze(cwd, 'a', [{ id: 't', tier: 'checkable', text: 'fails', check: 'false' }]).code, 0);
c.expect('a second freeze of the same run was accepted', freeze(cwd, 'a', [{ id: 't', tier: 'checkable', text: 'x', check: 'true' }]).code, 2);

// Loosen the frozen check by hand: `false` -> `true`. Obeying the edit would pass the gate.
const f = join(cwd, '.orchestration', 'a', 'dod.json');
const dod = JSON.parse(readFileSync(f, 'utf8'));
dod.criteria[0].check = 'true';
writeFileSync(f, JSON.stringify(dod));
c.expect('an edited DoD was obeyed instead of refused', run(cwd, ['gate', '--run', 'a']).code, 2);

c.expect('a checkable criterion with no command froze',
  freeze(cwd, 'b', [{ id: 't', tier: 'checkable', text: 'no check' }]).code, 2);

const many = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, tier: 'judged', text: `criterion ${i}` }));
c.expect('a 40-criterion DoD was refused — the DoD has no cap', freeze(cwd, 'c', many).code, 0);

c.done();

#!/usr/bin/env node
// Frozen check: the gate gives a run three rounds, then escalates and stays escalated.
//
// The budget is what made the old conductor stop instead of burning a day on the same wall. It
// lives in the script, not the loop's memory, so a fourth `gate` call must not buy a fourth round.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, docs, freeze, repo, run } from './lib/gate-harness.mjs';

const c = checker('gate-budget-three-rounds');
const cwd = repo();
docs(cwd, 'r');
freeze(cwd, 'r', [{ id: 't', tier: 'checkable', text: 'never met', check: 'false' }]);

const codes = [1, 2, 3, 4].map(() => run(cwd, ['gate', '--run', 'r']).code);
c.expect('round 1 of an unmet run did not report "rounds left"', codes[0], 1);
c.expect('round 2 of an unmet run did not report "rounds left"', codes[1], 1);
c.expect('round 3 of an unmet run did not escalate', codes[2], 3);
c.expect('a gate call after escalation did not stay escalated', codes[3], 3);

const state = JSON.parse(readFileSync(join(cwd, '.orchestration', 'r', 'gate.json'), 'utf8'));
c.expect('an escalated run recorded more than three rounds', state.rounds.length, 3);
c.expect('gate.json does not say escalated', state.status, 'escalated');

c.done();

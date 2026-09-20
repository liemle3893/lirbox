#!/usr/bin/env node
/* node --test scripts/test-transitions.mjs  — every illegal pair is SHOWN refused, not asserted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, TABLE, check } from './transition.mjs';

const OK = { evidence: [{ kind: 'verification', produced_by: 'verifier' }], implementor: 'impl', history: ['verified'] };

test('every illegal pair in the matrix is refused, and printed', () => {
  let legal = 0, refused = 0;
  for (const from of STATES) for (const to of STATES) {
    const r = check(from, to, OK);
    if (TABLE[from].includes(to)) { assert.equal(r.ok, true, `${from} -> ${to} should be legal: ${r.why}`); legal++; continue; }
    assert.equal(r.ok, false, `${from} -> ${to} was ACCEPTED and must not be`);
    console.log(`REFUSED  ${from} -> ${to}  ::  ${r.why}`);
    refused++;
  }
  console.log(`\n${legal} legal, ${refused} illegal refused, ${STATES.length ** 2} pairs`);
  assert.equal(legal + refused, STATES.length ** 2);
});

test('unknown states are refused', () => {
  assert.equal(check('reported', 'done', OK).ok, false);
  assert.equal(check('Done', 'verified', OK).ok, false);
});

test('reported -> verified: same agent name on both sides is refused', () => {
  const r = check('reported', 'verified', { lane: 'fix', implementor: 'lane-fix', evidence: [{ kind: 'verification', produced_by: 'lane-fix' }] });
  assert.equal(r.ok, false);
  assert.match(r.why, /same name/);
  console.log(`REFUSED  ${r.why}`);
});

test('reported -> verified: no verification artifact at all is refused', () => {
  const r = check('reported', 'verified', { lane: 'merge', implementor: 'lane-merge', evidence: [{ kind: 'report', produced_by: 'lane-merge' }] });
  assert.equal(r.ok, false);
  assert.match(r.why, /never become verified/);
});

test('reported -> verified: a different agent name passes', () => {
  assert.equal(check('reported', 'verified', { lane: 'fix', implementor: 'lane-fix', evidence: [{ kind: 'verification', produced_by: 'lane-fix-verify' }] }).ok, true);
});

test('durable -> published without verified in history is refused', () => {
  const r = check('durable', 'published', { lane: 'merge', history: ['planned', 'dispatched', 'reported', 'durable'] });
  assert.equal(r.ok, false);
  assert.match(r.why, /durable \(committed\) is not verified/);
  console.log(`REFUSED  ${r.why}`);
});

test('durable -> published with verified in history passes', () => {
  assert.equal(check('durable', 'published', { lane: 'fix', history: ['dispatched', 'reported', 'verified', 'durable'] }).ok, true);
});

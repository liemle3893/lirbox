import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, ts, write } from './_fixture.mjs';

const SOURCE = {
  _comment: 'src',
  include: ['tests/**/*.test.js'],
  exclude: ['**/node_modules/**'],
  testPartsFooter: 'Add parts with evidence.',
  rules: [
    { path: 'src/schema.sql', rule: 'SCHEMA.' },
    { path: '{src/a.js,tools/**}', rule: 'A.' },
    { path: '**/*', rule: 'Normal review.', testParts: 'decided by select --list' },
  ],
};

test('rules --write appends exactly one Test parts line per rule; --check is clean, then stale', () => {
  const { dir } = makeRepo();
  write(dir, '.test-scope/rules.source.json', SOURCE);
  assert.equal(ts(dir, ['rules', '--check']).code, 1, 'missing rule.json is not current');
  const w = ts(dir, ['rules', '--write']);
  assert.equal(w.code, 0, w.stderr);
  const out = JSON.parse(fs.readFileSync(path.join(dir, '.opencodereview/rule.json'), 'utf8'));
  assert.equal(out.rules.length, 3);
  for (const r of out.rules) assert.equal((r.rule.match(/^Test parts: /gm) || []).length, 1);
  assert.match(out.rules[0].rule, /Test parts: db$/);
  assert.match(out.rules[1].rule, /Test parts: a-extra,core$/);
  assert.match(out.rules[2].rule, /Test parts: decided by select --list$/);
  assert.match(out.rules[0].rule, /Add parts with evidence\.\nTest parts: db$/);
  assert.equal(ts(dir, ['rules', '--check']).code, 0);

  // a part changes its paths: the committed rule.json no longer matches what would be generated
  const parts = JSON.parse(fs.readFileSync(path.join(dir, '.test-scope/parts.json'), 'utf8'));
  parts.parts.db.paths.push('src/a.js');
  write(dir, '.test-scope/parts.json', parts);
  const stale = ts(dir, ['rules', '--check']);
  assert.equal(stale.code, 1);
  assert.match(stale.stderr, /stale/);
  assert.equal(ts(dir, ['rules', '--write']).code, 0);
  assert.equal(ts(dir, ['rules', '--check']).code, 0);
});

test('rules --check fails on an unknown part named in testParts, and on a rule no part intersects', () => {
  const { dir } = makeRepo();
  write(dir, '.test-scope/rules.source.json', { ...SOURCE, rules: [{ path: 'src/a.js', rule: 'A.', testParts: 'db,ghost' }] });
  const r = ts(dir, ['rules', '--check']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown part ghost/);
  write(dir, '.test-scope/rules.source.json', { ...SOURCE, rules: [{ path: 'nothing/here.txt', rule: 'N.' }] });
  const r2 = ts(dir, ['rules', '--check']);
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /no part's paths intersect/);
});

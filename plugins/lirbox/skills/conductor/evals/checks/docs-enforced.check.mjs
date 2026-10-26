#!/usr/bin/env node
// Frozen check: a run whose criteria are all met still does not pass without its docs — a
// docs/changes/<slug>/summary.md with frontmatter AND a body, and the promoted implementation
// notes — and a pass writes the scorecard (docs/changes/<slug>/dod.json) itself.
//
// Document enforcement was half of what made the old conductor's full flow worth its cost. A gate
// that checks the code and forgets the record lets the record be the thing skipped under pressure.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, docs, freeze, repo, run } from './lib/gate-harness.mjs';

const c = checker('docs-enforced');
const cwd = repo();
const met = [{ id: 't', tier: 'checkable', text: 'always met', check: 'true' }];
const gate = (slug) => run(cwd, ['gate', '--run', slug]).code;

freeze(cwd, 'none', met);
c.expect('a run with no docs passed', gate('none'), 1);

freeze(cwd, 'nofm', met);
docs(cwd, 'nofm', { summary: 'no frontmatter here\n' });
c.expect('a summary with no frontmatter passed', gate('nofm'), 1);

freeze(cwd, 'nobody', met);
docs(cwd, 'nobody', { summary: '---\ntitle: t\n---\n\n' });
c.expect('a summary with frontmatter and no body passed', gate('nobody'), 1);

freeze(cwd, 'nonotes', met);
docs(cwd, 'nonotes', { notes: '  \n' });
c.expect('empty promoted implementation notes passed', gate('nonotes'), 1);

freeze(cwd, 'ok', met);
docs(cwd, 'ok');
c.expect('a run with met criteria and complete docs did not pass', gate('ok'), 0);
const card = join(cwd, 'docs', 'changes', 'ok', 'dod.json');
c.ok('a pass did not write the docs/changes scorecard', existsSync(card));
if (existsSync(card)) {
  const s = JSON.parse(readFileSync(card, 'utf8'));
  c.ok('the scorecard does not carry each criterion\'s verdict and evidence',
    s.criteria?.[0]?.met === true && /exit 0/.test(s.criteria?.[0]?.evidence || ''));
}

c.done();

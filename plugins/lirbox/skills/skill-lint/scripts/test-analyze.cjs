#!/usr/bin/env node
/*
 * Regression net for analyze.cjs. Drives the pure analyzeSkill() over hand-built fixtures
 * (clean / book / bad-tags / bad-desc / refs / hygiene / evals) and asserts the right findings fire — and, just as
 * important, that a clean skill stays clean (no false positives on placeholders / code / prose).
 * Also runs the analyzer over the REAL marketplace to confirm it does not crash.
 */
const path = require('path');
const { execFileSync } = require('child_process');
const { analyzeSkill, tagBalance, longProseRatio, sections, splitFrontmatter } = require('./analyze.cjs');

let failures = 0;
const ok = (cond, msg) => cond ? console.log(`PASS ${msg}`) : (console.error(`FAIL ${msg}`), failures++);
const has = (r, check, sev) => r.findings.some((f) => f.check === check && (!sev || f.severity === sev));

const fm = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\n---\n`;
const para = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

// --- fixture 1: a clean, concise, well-formed skill -> zero findings --------
{
  const src = fm('tidy', 'Use when the user wants a concise thing done. Triggers on "do the thing".') +
    `# Tidy\n\n<rules>\nKeep it short.\n</rules>\n\n` +
    `Reference \`skills/<name>/SKILL.md\` and \`agents/<name>.md\` inline.\n\n` +
    `- step one\n- step two\n\n\`\`\`js\nconst x = 1 // <fake> tag inside code must be ignored\n\`\`\`\n`;
  const r = analyzeSkill({ name: 'tidy', src });
  ok(r.findings.length === 0, `clean skill has no findings (got ${JSON.stringify(r.findings.map((f) => f.check + ':' + f.severity))})`);
  ok(r.metrics.tagOk, 'clean skill: tags balanced (<rules> pair) and <name> placeholders ignored');
}

// --- fixture 2: a book (over the line budget, dense prose, no references) ---
{
  const list = Array.from({ length: 15 }, (_, i) => `- item ${i}`).join('\n');
  const bookBody = Array.from({ length: 8 }, (_, i) => `## Section ${i}\n\n${para(200)}\n\n${list}`).join('\n\n');
  const src = fm('tome', 'Use when you need a lot. Triggers on everything.') + `# Tome\n\n${bookBody}\n`;
  const r = analyzeSkill({ name: 'tome', src });
  ok(has(r, 'book', 'flag') && /body lines \(>100\)/.test(r.findings.find((f) => f.check === 'book').msg), 'book: >100-line skill flagged by lines');
  ok(r.findings.some((f) => f.check === 'book' && /candidate to extract/.test(f.msg)), 'book: names a section to extract');
  ok(r.findings.some((f) => f.check === 'book' && /no references/i.test(f.msg)), 'book: notes missing references/ dir');
  ok(has(r, 'book', 'warn') && r.findings.some((f) => /prose paragraphs/.test(f.msg)), 'book: dense-prose ratio warned');
  // adding references/ suppresses the "no references" nudge in the flag msg
  const r2 = analyzeSkill({ name: 'tome', src, refFiles: [{ name: 'x.md', lines: 40 }] });
  ok(!r2.findings.some((f) => f.check === 'book' && /no references/i.test(f.msg)), 'book: references/ dir suppresses the missing-dir note');
}

// --- fixture 2b: the line budget is lines, not words, and 100 is allowed ----
{
  const body = (n) => Array.from({ length: n }, (_, i) => `- line ${i}`).join('\n') + '\n';
  const at = analyzeSkill({ name: 'edge', src: fm('edge', 'Use when testing. Triggers on edge.') + body(100) });
  const over = analyzeSkill({ name: 'edge', src: fm('edge', 'Use when testing. Triggers on edge.') + body(101) });
  ok(!has(at, 'book') && at.metrics.lines === 100, 'book: exactly 100 body lines is within budget');
  ok(has(over, 'book', 'flag'), 'book: 101 body lines flagged');
  const wide = (n, w) => fm('wide', 'Use when testing. Triggers on wide.') + Array.from({ length: n }, () => 'x'.repeat(w)).join('\n') + '\n';
  ok(!has(analyzeSkill({ name: 'wide', src: wide(50, 400) }), 'book'), 'book: 20,000 chars (~5000 tokens) is within budget');
  const wider = analyzeSkill({ name: 'wide', src: wide(50, 400) + 'xxxx\n' });
  ok(has(wider, 'book', 'flag') && /~5001 tokens \(>5000/.test(wider.findings[0].msg) && !/body lines/.test(wider.findings[0].msg), 'book: ~5001 tokens in 51 lines flagged on tokens alone');
  const wordy = analyzeSkill({ name: 'wordy', src: fm('wordy', 'Use when testing. Triggers on wordy.') + `- ${para(700)}\n` });
  ok(!has(wordy, 'book'), 'book: a 700-word, 1-line skill is not judged on words');
}

// --- fixture 2c: a tagged block ends the section above it --------------------
{
  const src = fm('tagged', 'Use when testing. Triggers on tagged.') +
    `<routes>\n### small\nfew words\n</routes>\n\n<big-block>\n${para(300)}\n</big-block>\n`;
  const secs = sections(splitFrontmatter(src).body);
  ok(secs.find((x) => x.title === 'small').words === 2, 'sections: a heading is not credited with the tagged block after it');
}

// --- fixture 3: unbalanced XML tags ----------------------------------------
{
  const src = fm('taggy', 'Use when testing tags. Triggers on tags.') +
    `# Taggy\n\n<HARD-GATE>\nnever closed\n\n<phase>a</phase>\n\n</OTHER>\n`;
  const r = analyzeSkill({ name: 'taggy', src });
  ok(r.findings.some((f) => f.check === 'tags' && /HARD-GATE.*never closed/.test(f.msg)), 'tags: unclosed <HARD-GATE> flagged');
  ok(r.findings.some((f) => f.check === 'tags' && /OTHER.*no open/.test(f.msg)), 'tags: stray </OTHER> flagged');
  ok(!r.findings.some((f) => /phase/.test(f.msg)), 'tags: balanced <phase> pair not flagged');
}

// --- fixture 4: big skill with no structural tags + bad description ---------
{
  const src = fm('flat', 'I do things for you.') + `# Flat\n\n${para(900)}\n`;
  const r = analyzeSkill({ name: 'flat', src });
  ok(has(r, 'tags', 'note'), 'tags: 900-word tagless skill gets the "add tags" nudge');
  ok(r.findings.some((f) => f.check === 'desc' && /third person/.test(f.msg)), 'desc: first-person description warned');
  ok(r.findings.some((f) => f.check === 'desc' && /when.*cue/i.test(f.msg)), 'desc: missing when/trigger cue noted');
  const userOnly = analyzeSkill({ name: 'flat', src: '---\nname: flat\ndescription: Files an issue.\ndisable-model-invocation: true\n---\nbody\n' });
  ok(!userOnly.findings.some((f) => /when.*cue/i.test(f.msg)), 'desc: a user-invoked-only skill needs no trigger cue');
}

// --- fixture 5: oversized inline flowchart ---------------------------------
{
  const flow = '```dot\n' + Array.from({ length: 50 }, (_, i) => `n${i} -> n${i + 1};`).join('\n') + '\n```';
  const src = fm('drawy', 'Use when drawing. Triggers on draw.') + `# Drawy\n\n${flow}\n`;
  const r = analyzeSkill({ name: 'drawy', src });
  ok(r.findings.some((f) => f.check === 'flow' && /dot block is 50 lines/.test(f.msg)), 'flow: 50-line inline dot flagged');
}

// --- fixture 6: frontmatter limits (best practices) -------------------------
{
  const d = 'Use when testing. Triggers on meta.';
  const msgs = (n, desc = d, dir = n, extra = '') => analyzeSkill({ name: dir, src: fm(n, desc).replace(/\n---\n$/, `\n${extra}---\n`) + 'body\n' }).findings
    .filter((f) => f.check === 'desc' && f.severity === 'flag').map((f) => f.msg).join(' | ');
  ok(/chars \(>64\)/.test(msgs('a'.repeat(65))), 'desc: 65-char name flagged');
  ok(!msgs('a'.repeat(64)), 'desc: 64-char name allowed');
  ok(/lowercase letters/.test(msgs('Bad_Name')), 'desc: uppercase/underscore name flagged');
  ok(/reserved word/.test(msgs('claude-tools')), 'desc: reserved word in name flagged');
  ok(/1025 chars \(>1024\)/.test(msgs('ok', 'Use when ' + 'x'.repeat(1016))), 'desc: 1025-char description flagged');
  ok(/XML tag/.test(msgs('ok', 'Use when asked about <topic>.')), 'desc: XML tag in description flagged');
  ok(/hyphen/.test(msgs('-lead')) && /hyphen/.test(msgs('trail-')) && /hyphen/.test(msgs('dou--ble')), 'desc: leading/trailing/double hyphen flagged');
  ok(/does not match its directory/.test(msgs('ok', d, 'other')), 'desc: name/directory mismatch flagged');
  ok(/compatibility is 501 chars/.test(msgs('ok', d, 'ok', `compatibility: ${'c'.repeat(501)}\n`)), 'desc: 501-char compatibility flagged');
  ok(!msgs('ok', d, 'ok', `compatibility: ${'c'.repeat(500)}\n`), 'desc: 500-char compatibility allowed');
}

// --- fixture 7: references (best practices) ---------------------------------
{
  const src = fm('reffy', 'Use when testing refs. Triggers on refs.') + 'See [a](references/a.md).\n';
  const long = (head) => head + Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n');
  const run = (refs) => analyzeSkill({ name: 'reffy', src, refFiles: refs.map(([name, s]) => ({ name, src: s, lines: s.split('\n').length })) });
  ok(run([['a.md', 'Details: see [b](b.md).\n']]).findings.some((f) => f.check === 'refs' && /one level deep/.test(f.msg)), 'refs: nested .md link warned');
  ok(!has(run([['a.md', 'See [docs](https://x.dev/a.md) and [here](#top).\n']]), 'refs'), 'refs: http and anchor links are not nesting');
  ok(run([['big.md', long('# Big\n')]]).findings.some((f) => f.check === 'refs' && /table of contents/.test(f.msg)), 'refs: 150-line reference with no TOC warned');
  ok(!has(run([['big.md', long('# Big\n\n## Contents\n- a\n- b\n\n')]]), 'refs'), 'refs: a "Contents" heading satisfies the TOC rule');
  ok(!has(run([['big.md', long('# Big\n- [A](#a)\n- [B](#b)\n- [C](#c)\n')]]), 'refs'), 'refs: three anchor links satisfy the TOC rule');
  ok(!has(run([['big.md', long('# Big\n').split('\n').slice(0, 100).join('\n')]]), 'refs'), 'refs: a 100-line reference needs no TOC');
}

// --- fixture 8: hygiene + evals (best practices) ----------------------------
{
  const base = fm('hyg', 'Use when testing. Triggers on hygiene.');
  const win = analyzeSkill({ name: 'hyg', src: base + 'Run `scripts\\helper.py` first.\n' });
  ok(win.findings.some((f) => f.check === 'hygiene' && /Windows-style/.test(f.msg)), 'hygiene: backslash path warned');
  const time = analyzeSkill({ name: 'hyg', src: base + 'If you are doing this before August 2025, use the old API.\n' });
  ok(time.findings.some((f) => f.check === 'hygiene' && f.severity === 'note'), 'hygiene: time-sensitive wording noted');
  ok(!has(analyzeSkill({ name: 'hyg', src: base + 'Escape it as \\n in a string.\n' }), 'hygiene'), 'hygiene: a bare escape is not a path');
  ok(has(analyzeSkill({ name: 'hyg', src: base, evalCount: 2 }), 'evals', 'note'), 'evals: two evaluations noted');
  ok(!has(analyzeSkill({ name: 'hyg', src: base, evalCount: 3 }), 'evals'), 'evals: three evaluations are enough');
}

// --- unit: helpers ----------------------------------------------------------
{
  const b = tagBalance('<A>x</A> <B>y');
  ok(b.count === 3 && b.problems.length === 1 && /B.*never closed/.test(b.problems[0]), 'unit: tagBalance counts + reports the open <B>');
  ok(tagBalance('<name> <skill> <file>').count === 0, 'unit: lowercase placeholders are not structural tags');
  const pr = longProseRatio(`## h\n\n- a\n- b\n\n${'w '.repeat(120)}`);
  ok(pr.ratio > 0.5, 'unit: a 120-word paragraph dominates the prose ratio');
}

// --- smoke: run the real CLI over the marketplace without crashing ----------
try {
  const out = execFileSync('node', [path.join(__dirname, 'analyze.cjs')], { encoding: 'utf8' });
  ok(/SKILL-LINT — \d+ skill/.test(out) && /FINDINGS/.test(out), 'smoke: CLI runs over the real marketplace and prints a report');
} catch (e) {
  ok(false, `smoke: CLI crashed — ${e.message.split('\n')[0]}`);
}

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log('\nAll skill-lint checks passed.');

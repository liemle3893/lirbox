#!/usr/bin/env node
/*
 * Regression net for analyze.cjs. Drives the pure analyzeSkill() over hand-built fixtures
 * (clean / book / bad-tags / bad-desc) and asserts the right findings fire — and, just as
 * important, that a clean skill stays clean (no false positives on placeholders / code / prose).
 * Also runs the analyzer over the REAL marketplace to confirm it does not crash.
 */
const path = require('path');
const { execFileSync } = require('child_process');
const { analyzeSkill, tagBalance, longProseRatio } = require('./analyze.cjs');

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

// --- fixture 2: a book (long + dense prose, no references) ------------------
{
  const bookBody = Array.from({ length: 8 }, (_, i) => `## Section ${i}\n\n${para(200)}`).join('\n\n');
  const src = fm('tome', 'Use when you need a lot. Triggers on everything.') + `# Tome\n\n${bookBody}\n`;
  const r = analyzeSkill({ name: 'tome', src });
  ok(has(r, 'book', 'flag'), 'book: >1200-word skill flagged');
  ok(r.findings.some((f) => f.check === 'book' && /candidate to extract/.test(f.msg)), 'book: names a section to extract');
  ok(r.findings.some((f) => f.check === 'book' && /no references/i.test(f.msg)), 'book: notes missing references/ dir');
  ok(has(r, 'book', 'warn') && r.findings.some((f) => /prose paragraphs/.test(f.msg)), 'book: dense-prose ratio warned');
  // adding references/ suppresses the "no references" nudge in the flag msg
  const r2 = analyzeSkill({ name: 'tome', src, refFiles: [{ name: 'x.md', lines: 40 }] });
  ok(!r2.findings.some((f) => f.check === 'book' && /no references/i.test(f.msg)), 'book: references/ dir suppresses the missing-dir note');
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
}

// --- fixture 5: oversized inline flowchart + oversized reference ------------
{
  const flow = '```dot\n' + Array.from({ length: 50 }, (_, i) => `n${i} -> n${i + 1};`).join('\n') + '\n```';
  const src = fm('drawy', 'Use when drawing. Triggers on draw.') + `# Drawy\n\n${flow}\n`;
  const r = analyzeSkill({ name: 'drawy', src, refFiles: [{ name: 'big.md', lines: 800 }] });
  ok(r.findings.some((f) => f.check === 'flow' && /dot block is 50 lines/.test(f.msg)), 'flow: 50-line inline dot flagged');
  ok(r.findings.some((f) => f.check === 'flow' && /big\.md is 800 lines/.test(f.msg)), 'flow: 800-line reference flagged');
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

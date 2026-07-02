#!/usr/bin/env node
/*
 * skill-lint — analyze lirbox SKILL.md files for bloat and structure hygiene.
 *
 * Four deterministic checks (each finding tagged flag ● / warn ◐ / note ○):
 *   1. book    — body word count (frontmatter + fenced code excluded), graduated thresholds,
 *                plus a long-prose ratio; a flagged skill is told which section to extract.
 *   2. tags    — structural XML tags must be balanced/closed & non-empty; big skills with ZERO
 *                structural tags get an "add XML tags" nudge (Anthropic best practice).
 *   3. desc    — frontmatter name+description present, third-person, carries a when/trigger cue.
 *   4. flow    — oversized inline dot/mermaid blocks, and references/*.md over REF_LINES.
 *
 * Pure fns are exported for test-analyze.cjs; the CLI at the bottom scans the marketplace.
 * Plain Node (this is NOT a conductor-family loop script — fs is allowed here).
 */
const fs = require('fs');
const path = require('path');

const T = {
  WORDS_WARN: 500,      // over this → warn
  WORDS_FLAG: 1200,     // over this → flag (a "book")
  LONG_PARA: 80,        // a paragraph over this many words counts as "long prose"
  PROSE_RATIO: 0.5,     // >50% of body words in long prose paragraphs → reads like a book
  BIG_FOR_TAGS: 800,    // below this, zero structural tags is fine
  FLOW_LINES: 40,       // inline dot/mermaid block larger than this → flag
  REF_LINES: 500,       // a references/*.md over this many lines → split
};

const SEV = { flag: '●', warn: '◐', note: '○' };

// --- text helpers ----------------------------------------------------------
function splitFrontmatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  return m ? { fm: m[1], body: src.slice(m[0].length) } : { fm: '', body: src };
}

// Strip fenced code blocks; return the code-free body plus each fence's {lang, lines}.
function stripFenced(body) {
  const fences = [];
  const stripped = body.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, info, code) => {
    fences.push({ lang: info.trim().toLowerCase(), lines: code.split('\n').length - 1 });
    return '\n';
  });
  return { stripped, fences };
}

const stripInline = (t) => t.replace(/`[^`]*`/g, ' ');
const wordCount = (t) => (t.trim().match(/\S+/g) || []).length;

// A paragraph is "prose" when fewer than half its lines start with a structural marker
// (heading, list, quote, table, tag, fence). Long prose = a prose paragraph over LONG_PARA words.
const STRUCT_LINE = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\||<\/?[A-Za-z]|```|:{3}|\t)/;
function longProseRatio(codeFreeBody) {
  const total = wordCount(stripInline(codeFreeBody));
  if (!total) return { ratio: 0, longWords: 0, total: 0 };
  let longWords = 0;
  for (const para of codeFreeBody.split(/\n\s*\n/)) {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const structural = lines.filter((l) => STRUCT_LINE.test(l)).length;
    if (structural >= lines.length / 2) continue; // mostly structural, not prose
    const w = wordCount(stripInline(para));
    if (w > T.LONG_PARA) longWords += w;
  }
  return { ratio: longWords / total, longWords, total };
}

// Biggest H2/H3 section by word count — the extraction candidate named in a book finding.
function sections(body) {
  const out = [];
  const re = /^(#{2,3})\s+(.+)$/gm;
  let m, prev = null;
  while ((m = re.exec(body))) {
    if (prev) prev.end = m.index;
    prev = { title: m[2].trim().replace(/`/g, ''), start: re.lastIndex };
    out.push(prev);
  }
  if (prev) prev.end = body.length;
  for (const s of out) s.words = wordCount(stripInline(body.slice(s.start, s.end)));
  return out.sort((a, b) => b.words - a.words);
}

// Structural tags only: name is UPPER/CamelCase, hyphenated, OR appears as a real open/close
// pair. Lowercase single-word placeholders (<name>, <skill>, <file>) are ignored.
function tagBalance(codeFreeBody) {
  const re = /<(\/?)([A-Za-z][\w-]*)((?:\s[^>]*)?)(\/?)>/g;
  const raw = [];
  let m;
  while ((m = re.exec(codeFreeBody))) {
    raw.push({ close: m[1] === '/', name: m[2], selfClose: m[4] === '/', idx: m.index });
  }
  const closedNames = new Set(raw.filter((t) => t.close).map((t) => t.name));
  const structural = (name) => /[A-Z]/.test(name) || name.includes('-') || closedNames.has(name);
  const opens = {}, count = { total: 0 };
  const problems = [];
  for (const t of raw) {
    if (t.selfClose || !structural(t.name)) continue;
    count.total++;
    if (t.close) {
      if ((opens[t.name] || 0) > 0) opens[t.name]--;
      else problems.push(`closing </${t.name}> with no open`);
    } else {
      opens[t.name] = (opens[t.name] || 0) + 1;
    }
  }
  for (const [name, n] of Object.entries(opens)) {
    if (n > 0) problems.push(`<${name}> opened ${n}× but never closed`);
  }
  return { count: count.total, problems };
}

// --- the analyzer ----------------------------------------------------------
function analyzeSkill({ name, src, refFiles = [] }) {
  const findings = [];
  const add = (severity, check, msg) => findings.push({ severity, check, msg });

  const { fm, body } = splitFrontmatter(src);
  const { stripped, fences } = stripFenced(body);
  const words = wordCount(stripInline(stripped));
  const prose = longProseRatio(stripped);
  const tags = tagBalance(stripInline(stripped));
  const hasRefs = refFiles.length > 0;

  // 1. book bloat
  if (words > T.WORDS_FLAG) {
    const big = sections(body)[0];
    const where = big && big.words > 150 ? ` Biggest section "${big.title}" (${big.words} w) is a candidate to extract.` : '';
    const ref = hasRefs ? '' : ' No references/ dir — move detail there via progressive disclosure.';
    add('flag', 'book', `${words} words (>${T.WORDS_FLAG}). Reads like a book.${where}${ref}`);
  } else if (words > T.WORDS_WARN) {
    add('warn', 'book', `${words} words (>${T.WORDS_WARN}). Trim toward <${T.WORDS_WARN}.`);
  }
  if (words > T.WORDS_WARN && prose.ratio > T.PROSE_RATIO) {
    add('warn', 'book', `${Math.round(prose.ratio * 100)}% of words sit in long (>${T.LONG_PARA}w) prose paragraphs — break into lists/tags/tables.`);
  }

  // 2. XML-tag hygiene
  for (const p of tags.problems) add('flag', 'tags', `unbalanced tag: ${p}`);
  if (words > T.BIG_FOR_TAGS && tags.count === 0) {
    add('note', 'tags', `${words}-word skill with zero structural XML tags — consider tags to delimit gates/examples/rules.`);
  }

  // 3. description / trigger quality
  const nameM = /^name:\s*(.+)$/m.exec(fm);
  const descM = /^description:\s*(.+)$/m.exec(fm);
  if (!nameM) add('flag', 'desc', 'frontmatter has no name:');
  if (!descM) {
    add('flag', 'desc', 'frontmatter has no description: (the sole trigger signal)');
  } else {
    const desc = descM[1].trim().replace(/^["']|["']$/g, '');
    if (/^(I |We |You |My |Our )/.test(desc)) add('warn', 'desc', 'description is first/second person — write it in the third person.');
    if (!/\b(when|whenever|trigger|use this|use when|used to)\b/i.test(desc)) {
      add('note', 'desc', 'description states no explicit "when/Triggers" cue — the model uses this to decide invocation.');
    }
  }

  // 4. flowchart / reference misuse
  for (const f of fences) {
    if ((f.lang === 'dot' || f.lang === 'mermaid') && f.lines > T.FLOW_LINES) {
      add('warn', 'flow', `inline ${f.lang} block is ${f.lines} lines (>${T.FLOW_LINES}) — trim or move; flowcharts only for non-obvious decisions.`);
    }
  }
  for (const r of refFiles) {
    if (r.lines > T.REF_LINES) add('warn', 'flow', `reference ${r.name} is ${r.lines} lines (>${T.REF_LINES}) — split it.`);
  }

  return {
    name,
    metrics: { words, proseRatio: prose.ratio, tags: tags.count, tagOk: tags.problems.length === 0, hasRefs },
    findings,
  };
}

// --- CLI -------------------------------------------------------------------
function repoRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, '.claude-plugin', 'marketplace.json'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

function readRefs(skillDir) {
  const rd = path.join(skillDir, 'references');
  if (!fs.existsSync(rd)) return [];
  return fs.readdirSync(rd)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f, lines: fs.readFileSync(path.join(rd, f), 'utf8').split('\n').length }));
}

function discover(root) {
  const base = path.join(root, 'plugins', 'lirbox', 'skills');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base)
    .map((n) => path.join(base, n, 'SKILL.md'))
    .filter((p) => fs.existsSync(p));
}

function severityRank(f) { return { flag: 0, warn: 1, note: 2 }[f.severity]; }

function main(argv) {
  const args = argv.slice(2);
  const strict = args.includes('--strict');
  const json = args.includes('--json');
  const paths = args.filter((a) => !a.startsWith('--'));
  const root = repoRoot(__dirname) || process.cwd();
  const files = paths.length
    ? paths.map((p) => (p.endsWith('.md') ? p : path.join(p, 'SKILL.md')))
    : discover(root);

  const results = files.map((f) => {
    const skillDir = path.dirname(f);
    return analyzeSkill({
      name: path.basename(skillDir),
      src: fs.readFileSync(f, 'utf8'),
      refFiles: readRefs(skillDir),
    });
  });

  if (json) { console.log(JSON.stringify(results, null, 2)); return 0; }

  // table
  const pct = (r) => `${Math.round(r * 100)}%`;
  console.log(`\nSKILL-LINT — ${results.length} skill(s)\n`);
  console.log('  skill'.padEnd(24) + 'words'.padStart(6) + 'prose'.padStart(7) + 'tags'.padStart(6) + '  findings');
  for (const r of [...results].sort((a, b) => b.metrics.words - a.metrics.words)) {
    const worst = r.findings.length ? SEV[[...r.findings].sort((a, b) => severityRank(a) - severityRank(b))[0].severity] : '✓';
    const tagCell = r.metrics.tags + (r.metrics.tagOk ? '' : '!');
    console.log(
      ('  ' + r.name).padEnd(24) +
      String(r.metrics.words).padStart(6) +
      pct(r.metrics.proseRatio).padStart(7) +
      String(tagCell).padStart(6) +
      `  ${worst}${r.findings.length ? ' ' + r.findings.length : ' clean'}`,
    );
  }

  const all = results.flatMap((r) => r.findings.map((f) => ({ ...f, skill: r.name })))
    .sort((a, b) => severityRank(a) - severityRank(b));
  console.log(`\nFINDINGS (${all.length}), most severe first`);
  if (!all.length) console.log('  none — all skills clean.');
  for (const f of all) console.log(`  ${SEV[f.severity]} [${f.check}] ${f.skill} — ${f.msg}`);
  console.log('');

  const flags = all.filter((f) => f.severity === 'flag').length;
  return strict && flags ? 1 : 0;
}

module.exports = { analyzeSkill, splitFrontmatter, stripFenced, longProseRatio, tagBalance, sections, T };

if (require.main === module) process.exit(main(process.argv));

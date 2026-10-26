#!/usr/bin/env node
/*
 * skill-lint — analyze lirbox SKILL.md files for bloat and structure hygiene.
 *
 * Deterministic checks (each finding tagged flag ● / warn ◐ / note ○). The rules that come from
 * Anthropic's skill-authoring best practices are marked [bp]:
 *   1. book    — SKILL.md body (frontmatter excluded) over LINES_MAX lines or ~TOKENS_MAX tokens;
 *                a flagged skill is told which section to extract. Plus a long-prose ratio. [bp: the
 *                guide says <500 lines, the agentskills.io spec <5000 tokens; this repo caps lines at
 *                100.] Words are reported, never judged.
 *   2. tags    — structural XML tags must be balanced/closed & non-empty; big skills with ZERO
 *                structural tags get an "add XML tags" nudge.
 *   3. desc    — frontmatter name+description present, third-person, carries a when/trigger cue;
 *                [bp] name ≤64 chars of [a-z0-9-], no leading/trailing/double hyphen, matches its
 *                directory, no reserved words, no XML; description ≤1024 chars, no XML; compatibility
 *                ≤500 chars.
 *   4. flow    — oversized inline dot/mermaid blocks.
 *   5. refs    — [bp] references one level deep (a reference file links to no other .md), and a
 *                reference over REF_TOC_LINES opens with a table of contents.
 *   6. hygiene — [bp] no Windows-style paths; time-sensitive wording ("before August 2025") noted.
 *   7. evals   — [bp] fewer than EVALS_MIN evaluations noted (floor tests + checks + harbor tasks).
 *
 * Pure fns are exported for test-analyze.cjs; the CLI at the bottom scans the marketplace.
 * Plain Node (this is NOT a conductor-family loop script — fs is allowed here).
 */
const fs = require('fs');
const path = require('path');

const T = {
  // The guide's limit is 500 body lines "for optimal performance"; 100 is this repo's own, stricter
  // cap — past it, SKILL.md is doing a reference file's job. One threshold, so no warn tier.
  LINES_MAX: 100,
  // [bp] agentskills.io: "Instructions (< 5000 tokens recommended)". A line cap alone is dodged by
  // long lines; tokens are the actual cost. Estimated, not counted — an exact count needs the API.
  TOKENS_MAX: 5000,
  CHARS_PER_TOKEN: 4,   // the usual English estimate; backtick-dense markdown runs nearer 3.5
  LONG_PARA: 80,        // a paragraph over this many words counts as "long prose"
  PROSE_RATIO: 0.5,     // >50% of body words in long prose paragraphs → reads like a book
  BIG_FOR_TAGS: 800,    // below this, zero structural tags is fine
  FLOW_LINES: 40,       // inline dot/mermaid block larger than this → flag
  REF_TOC_LINES: 100,   // [bp] a reference longer than this needs a table of contents up top
  TOC_WINDOW: 30,       // ...within its first this-many lines, so a `head` preview still shows it
  NAME_MAX: 64,         // [bp] frontmatter name length
  COMPAT_MAX: 500,      // [bp] optional frontmatter compatibility length
  DESC_MAX: 1024,       // [bp] frontmatter description length
  EVALS_MIN: 3,         // [bp] "at least three evaluations"
};

const RESERVED = /anthropic|claude/;
const XML_TAG = /<\/?[A-Za-z][\w-]*(?:\s[^>]*)?\/?>/;
// [bp] A backslash-separated path ending in a file extension: `scripts\helper.py`.
const WIN_PATH = /(?:^|[\s`'"(])(?:[\w.-]+\\)+[\w.-]+\.[A-Za-z]{1,5}\b/;
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const TIME_SENSITIVE = new RegExp(`\\b(?:before|after|until|as of)\\s+(?:(?:${MONTHS})\\s+)?\\d{4}\\b`, 'i');
// A table of contents: a "Contents" heading, or three list lines that link to anchors.
const TOC = /^#{1,6}\s+(?:table of )?contents\b/im;
const TOC_LINKS = /^\s*[-*]\s+\[[^\]]+\]\(#/gm;
// A relative link to another markdown file (not http, not an anchor).
const MD_LINK = /\]\((?!https?:|#)[^)\s]+\.md(?:#[^)]*)?\)/;

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
// A structural tag on its own line (`<gated-run>`, `</routes>`) also ends a section, so a heading
// inside one tagged block is never credited with the whole block that follows it.
function sections(body) {
  const out = [];
  const re = /^(?:(#{2,3})\s+(.+)|<\/?[A-Za-z][\w-]*>\s*)$/gm;
  let m, prev = null;
  while ((m = re.exec(body))) {
    if (prev) { prev.end = m.index; prev = null; }
    if (!m[1]) continue;
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
function analyzeSkill({ name, src, refFiles = [], evalCount }) {
  const findings = [];
  const add = (severity, check, msg) => findings.push({ severity, check, msg });

  const { fm, body } = splitFrontmatter(src);
  const { stripped, fences } = stripFenced(body);
  const words = wordCount(stripInline(stripped));
  const bodyLines = body.replace(/\n+$/, '').split('\n');
  const lines = bodyLines.length;
  const chars = bodyLines.reduce((n, l) => n + l.length, 0);
  const overLines = lines > T.LINES_MAX;
  const tokens = Math.ceil(chars / T.CHARS_PER_TOKEN);
  const overTokens = tokens > T.TOKENS_MAX;
  const prose = longProseRatio(stripped);
  const tags = tagBalance(stripInline(stripped));
  const hasRefs = refFiles.length > 0;

  // 1. book bloat
  if (overLines || overTokens) {
    const big = sections(body)[0];
    const where = big && big.words > 150 ? ` Biggest section "${big.title}" (${big.words} w) is a candidate to extract.` : '';
    const ref = hasRefs ? '' : ' No references/ dir — move detail there via progressive disclosure.';
    const size = [overLines && `${lines} body lines (>${T.LINES_MAX})`, overTokens && `~${tokens} tokens (>${T.TOKENS_MAX}, est. chars/${T.CHARS_PER_TOKEN})`]
      .filter(Boolean).join(', ');
    add('flag', 'book', `${size}. Reads like a book.${where}${ref}`);
  }
  if ((overLines || overTokens) && prose.ratio > T.PROSE_RATIO) {
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
  else {
    const n = nameM[1].trim().replace(/^["']|["']$/g, '');
    if (n.length > T.NAME_MAX) add('flag', 'desc', `name is ${n.length} chars (>${T.NAME_MAX}).`);
    if (!/^[a-z0-9-]+$/.test(n)) add('flag', 'desc', `name "${n}" must be lowercase letters, numbers and hyphens only.`);
    if (/^-|-$|--/.test(n)) add('flag', 'desc', `name "${n}" starts or ends with a hyphen, or has "--".`);
    if (n !== name) add('flag', 'desc', `name "${n}" does not match its directory "${name}".`);
    if (RESERVED.test(n)) add('flag', 'desc', `name "${n}" contains a reserved word (anthropic, claude).`);
  }
  if (!descM) {
    add('flag', 'desc', 'frontmatter has no description: (the sole trigger signal)');
  } else {
    const desc = descM[1].trim().replace(/^["']|["']$/g, '');
    const compat = /^compatibility:\s*(.+)$/m.exec(fm);
    if (compat && compat[1].trim().length > T.COMPAT_MAX) add('flag', 'desc', `compatibility is ${compat[1].trim().length} chars (>${T.COMPAT_MAX}).`);
    if (desc.length > T.DESC_MAX) add('flag', 'desc', `description is ${desc.length} chars (>${T.DESC_MAX}).`);
    if (XML_TAG.test(desc)) add('flag', 'desc', 'description contains an XML tag.');
    if (/^(I |We |You |My |Our )/.test(desc)) add('warn', 'desc', 'description is first/second person — write it in the third person.');
    // A skill the model can never invoke is never chosen from its description, so a missing cue costs nothing.
    const userOnly = /^disable-model-invocation:\s*true\s*$/m.test(fm);
    if (!userOnly && !/\b(when|whenever|trigger|use this|use when|used to)\b/i.test(desc)) {
      add('note', 'desc', 'description states no explicit "when/Triggers" cue — the model uses this to decide invocation.');
    }
  }

  // 4. flowchart / reference misuse
  for (const f of fences) {
    if ((f.lang === 'dot' || f.lang === 'mermaid') && f.lines > T.FLOW_LINES) {
      add('warn', 'flow', `inline ${f.lang} block is ${f.lines} lines (>${T.FLOW_LINES}) — trim or move; flowcharts only for non-obvious decisions.`);
    }
  }

  // 5. references: one level deep, and a long one carries a table of contents. Size alone is not
  // a finding — the guide says a reference costs nothing until it is read.
  for (const r of refFiles) {
    if (r.src === undefined) continue;
    if (MD_LINK.test(stripFenced(r.src).stripped)) {
      add('warn', 'refs', `reference ${r.name} links to another .md — keep references one level deep from SKILL.md.`);
    }
    const head = r.src.split('\n').slice(0, T.TOC_WINDOW).join('\n');
    if (r.lines > T.REF_TOC_LINES && !TOC.test(head) && (head.match(TOC_LINKS) || []).length < 3) {
      add('warn', 'refs', `reference ${r.name} is ${r.lines} lines with no table of contents in its first ${T.TOC_WINDOW} lines.`);
    }
  }

  // 6. hygiene
  if (WIN_PATH.test(body)) add('warn', 'hygiene', 'Windows-style path (backslashes) — use forward slashes.');
  if (TIME_SENSITIVE.test(stripped)) {
    add('note', 'hygiene', `time-sensitive wording ("${stripped.match(TIME_SENSITIVE)[0]}") — it will go stale; move it to an "old patterns" note.`);
  }

  // 7. evaluations — unknown (undefined) when the caller did not count them
  if (evalCount !== undefined && evalCount < T.EVALS_MIN) {
    add('note', 'evals', `${evalCount} evaluation(s) (<${T.EVALS_MIN}) across evals/floor, evals/checks and harbor/tasks.`);
  }

  return {
    name,
    metrics: { lines, tokens, words, proseRatio: prose.ratio, tags: tags.count, tagOk: tags.problems.length === 0, hasRefs },
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
    .map((f) => {
      const src = fs.readFileSync(path.join(rd, f), 'utf8');
      return { name: f, lines: src.split('\n').length, src };
    });
}

function countEvals(skillDir) {
  const n = (d, re) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => re.test(f)).length : 0);
  return n(path.join(skillDir, 'evals', 'floor'), /\.test\.mjs$/) +
    n(path.join(skillDir, 'evals', 'checks'), /\.check\.mjs$/) +
    n(path.join(skillDir, 'harbor', 'tasks'), /^[^.]/);
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
      evalCount: countEvals(skillDir),
    });
  });

  if (json) { console.log(JSON.stringify(results, null, 2)); return 0; }

  // table
  const pct = (r) => `${Math.round(r * 100)}%`;
  console.log(`\nSKILL-LINT — ${results.length} skill(s)\n`);
  console.log('  skill'.padEnd(24) + 'lines'.padStart(6) + '~tokens'.padStart(8) + 'words'.padStart(7) + 'prose'.padStart(7) + 'tags'.padStart(6) + '  findings');
  for (const r of [...results].sort((a, b) => b.metrics.lines - a.metrics.lines)) {
    const worst = r.findings.length ? SEV[[...r.findings].sort((a, b) => severityRank(a) - severityRank(b))[0].severity] : '✓';
    const tagCell = r.metrics.tags + (r.metrics.tagOk ? '' : '!');
    console.log(
      ('  ' + r.name).padEnd(24) +
      String(r.metrics.lines).padStart(6) +
      String(r.metrics.tokens).padStart(8) +
      String(r.metrics.words).padStart(7) +
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

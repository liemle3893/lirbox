#!/usr/bin/env node
// prose-lint.mjs — zero-dependency, offline, deterministic Markdown prose linter.
//
// In the spirit of flowchart's assets/validate.mjs: imports ONLY node:* builtins — no npm install,
// no network. Scans every *.md under <path> and enforces a small set of DEFAULT checks, each of which
// is a real defect regardless of what the content says (the design's filtering principle). Prints a
// per-file violation report and exits 0 when clean, non-zero when any file has a violation.
//
// CLI:
//   node prose-lint.mjs <path> [--anchors] [--flesch <min>] [--dupe-words] [--frontmatter-keys k1,k2]
//
// DEFAULT checks (always on — every failure is an unambiguous defect):
//   (1) heading levels do not skip (h1 -> h3 with no intervening h2)
//   (2) LOCAL relative file-link targets resolve on disk (renderer-independent)
//   (3) fenced code blocks are balanced (triple-backtick fence delimiters come in pairs)
//   (4) no placeholder markers (TODO, TBD, FIXME, "lorem ipsum", empty links [text]())
//   (5) frontmatter parses as valid YAML WHEN PRESENT (absence is not a violation)
//
// OPT-IN checks (OFF by default — checkable but the threshold is a judgment call):
//   --anchors                heading-anchor resolution via a pinned GitHub-style slugger
//   --flesch <min>           Flesch reading-ease lower bound
//   --dupe-words             duplicate consecutive words ("the the")
//   --frontmatter-keys k1,k2 required frontmatter keys
//
// Deliberately NOT implemented (needs a dictionary/config/network -> non-deterministic): spelling,
// prose-style rules, and external HTTP link checking.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

// ---------------------------------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { path: null, anchors: false, flesch: null, dupeWords: false, frontmatterKeys: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--anchors') opts.anchors = true;
    else if (a === '--dupe-words') opts.dupeWords = true;
    else if (a === '--flesch') { opts.flesch = Number(argv[++i]); }
    else if (a === '--frontmatter-keys') { opts.frontmatterKeys = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a.startsWith('--')) { /* unknown flag: ignore for forward-compat */ }
    else if (opts.path === null) opts.path = a;
  }
  return opts;
}

// ---------------------------------------------------------------------------------------------------
// File discovery — every *.md under <path> (recursive). A file path is scanned as itself.
// ---------------------------------------------------------------------------------------------------
function collectMarkdown(target) {
  const out = [];
  const st = statSync(target);
  if (st.isFile()) { if (target.endsWith('.md')) out.push(target); return out; }
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue; // skip dotfiles/dot-dirs
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  };
  walk(target);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Frontmatter split — YAML block is delimited by a leading `---` and a closing `---`/`...`.
// Returns { fmLines, closed, bodyStart } where bodyStart is the 0-based body line index.
// ---------------------------------------------------------------------------------------------------
function splitFrontmatter(lines) {
  if (lines.length === 0 || lines[0].trim() !== '---') return { fmLines: null, closed: true, bodyStart: 0 };
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '---' || t === '...') return { fmLines: lines.slice(1, i), closed: true, bodyStart: i + 1 };
  }
  return { fmLines: lines.slice(1), closed: false, bodyStart: lines.length };
}

// Minimal YAML *validity* check (not a full parser). Flags the unambiguous malformed cases:
//   - a non-blank, non-comment line that is neither a list item nor a `key: value` mapping entry;
//   - a quoted scalar value that opens a quote it never closes.
// A plain scalar (no leading quote) is never faulted for stray quotes/apostrophes (filtering principle).
function badQuotedScalar(v) {
  if (v.startsWith('"')) return !(v.length >= 2 && v.endsWith('"'));
  if (v.startsWith("'")) return !(v.length >= 2 && v.endsWith("'"));
  return false;
}
function checkFrontmatterYaml(fmLines, closed) {
  const errors = [];
  if (!closed) { errors.push('frontmatter block is never closed (missing terminating `---`)'); return errors; }
  for (const raw of fmLines) {
    const line = raw.replace(/\t/g, '    ');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (trimmed === '-' || /^-\s+/.test(trimmed)) continue;          // sequence item
    const m = trimmed.match(/^[^:\s][^:]*:(\s.*|)$/);                 // mapping entry `key:` or `key: value`
    if (!m) { errors.push(`frontmatter is not valid YAML (line: "${trimmed}")`); continue; }
    const value = trimmed.slice(trimmed.indexOf(':') + 1).trim();
    if (badQuotedScalar(value)) errors.push(`frontmatter has an unterminated quoted value (line: "${trimmed}")`);
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------------
// Per-file lint
// ---------------------------------------------------------------------------------------------------
const PLACEHOLDER_WORDS = [/\bTODO\b/i, /\bTBD\b/i, /\bFIXME\b/i, /lorem ipsum/i];
const EMPTY_LINK = /\[[^\]]*\]\(\s*\)/;                 // [text]()  — placeholder link
const LINK = /(!?)\[[^\]]*\]\(\s*([^)\s]+?)\s*\)/g;     // [text](target) / ![alt](target)
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;      // http:, https:, mailto:, //host, #anchor

function isFenceDelimiter(line) { return /^\s*(```|~~~)/.test(line); }

function lintFile(file, opts) {
  const violations = [];
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const fileDir = dirname(file);

  // (5) frontmatter YAML when present
  const { fmLines, closed, bodyStart } = splitFrontmatter(lines);
  if (fmLines !== null) {
    for (const e of checkFrontmatterYaml(fmLines, closed)) violations.push(e);
    // opt-in: required frontmatter keys
    if (opts.frontmatterKeys && closed) {
      const present = new Set();
      for (const raw of fmLines) { const m = raw.trim().match(/^([^:\s][^:]*):/); if (m) present.add(m[1].trim()); }
      for (const k of opts.frontmatterKeys) if (!present.has(k)) violations.push(`frontmatter is missing required key "${k}"`);
    }
  }

  // (3) fence balance — count delimiters across the whole body.
  let fenceCount = 0;
  for (let i = bodyStart; i < lines.length; i++) if (isFenceDelimiter(lines[i])) fenceCount++;
  if (fenceCount % 2 !== 0) violations.push(`unbalanced code fence (${fenceCount} fence delimiter(s) — an opened block is never closed)`);

  // Body scan (skip content inside code fences for structural checks).
  let inFence = false;
  let prevHeadingLevel = 0;
  const headingSlugs = [];
  const anchorRefs = [];       // { line, raw, fragment, targetFile|null }
  let wordCorpus = [];

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (isFenceDelimiter(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    // (1) heading skip
    const hm = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (hm) {
      const level = hm[1].length;
      if (prevHeadingLevel > 0 && level > prevHeadingLevel + 1) {
        violations.push(`heading level skips from h${prevHeadingLevel} to h${level} (line ${lineNo}: "${hm[2].trim()}")`);
      }
      prevHeadingLevel = level;
      headingSlugs.push(slugify(hm[2]));
    }

    // (4) placeholder markers
    for (const re of PLACEHOLDER_WORDS) if (re.test(line)) violations.push(`placeholder marker ${re.source.replace(/\\b/g, '')} (line ${lineNo})`);
    if (EMPTY_LINK.test(line)) violations.push(`empty placeholder link [text]() (line ${lineNo})`);

    // (2) local file-link resolution  +  collect anchor refs for opt-in --anchors
    LINK.lastIndex = 0;
    let m;
    while ((m = LINK.exec(line)) !== null) {
      const rawTarget = m[2];
      if (!rawTarget || rawTarget.startsWith('#') === false && EXTERNAL.test(rawTarget)) {
        // external (http/mailto/protocol-relative) — out of scope by design
      }
      const hashIdx = rawTarget.indexOf('#');
      const pathPart = hashIdx === -1 ? rawTarget : rawTarget.slice(0, hashIdx);
      const fragment = hashIdx === -1 ? null : rawTarget.slice(hashIdx + 1);
      const isExternal = EXTERNAL.test(rawTarget) && !rawTarget.startsWith('#');
      if (!isExternal && pathPart && !pathPart.startsWith('/')) {
        const resolved = resolve(fileDir, pathPart);
        if (!existsSync(resolved)) violations.push(`dead local link "${rawTarget}" (line ${lineNo}) — target not found on disk`);
        else if (opts.anchors && fragment) anchorRefs.push({ lineNo, rawTarget, fragment, targetFile: resolved });
      } else if (opts.anchors && rawTarget.startsWith('#')) {
        anchorRefs.push({ lineNo, rawTarget, fragment: rawTarget.slice(1), targetFile: null });
      }
    }

    if (opts.dupeWords) {
      const dup = line.match(/\b(\w+)\s+\1\b/i);
      if (dup) violations.push(`duplicate consecutive word "${dup[1]}" (line ${lineNo})`);
    }
    if (opts.flesch !== null) wordCorpus.push(line);
  }

  // opt-in: --anchors (pinned GitHub-style slugger; see slugify).
  if (opts.anchors) {
    for (const ref of anchorRefs) {
      const targetSlugs = ref.targetFile === null ? headingSlugs : slugsOf(ref.targetFile);
      if (!targetSlugs.includes(slugify(ref.fragment))) {
        violations.push(`unresolved heading anchor "${ref.rawTarget}" (line ${ref.lineNo})`);
      }
    }
  }

  // opt-in: --flesch
  if (opts.flesch !== null && Number.isFinite(opts.flesch)) {
    const score = fleschReadingEase(wordCorpus.join(' '));
    if (score !== null && score < opts.flesch) violations.push(`Flesch reading-ease ${score.toFixed(1)} is below the required minimum ${opts.flesch}`);
  }

  return violations;
}

// GitHub-style slugger (documented, pinned): lowercase, strip non-word chars (keep hyphens),
// collapse whitespace to single hyphens.
function slugify(text) {
  return String(text).trim().toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}
function slugsOf(file) {
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const out = [];
    for (const l of lines) { const hm = l.match(/^#{1,6}\s+(.+?)\s*#*\s*$/); if (hm) out.push(slugify(hm[1])); }
    return out;
  } catch { return []; }
}

// Approximate Flesch reading-ease (opt-in only). Returns null on empty/degenerate input.
function fleschReadingEase(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = (text.match(/[.!?]+/g) || []).length || 1;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  if (words.length === 0) return null;
  return 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
}
function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

// ---------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.path) {
    console.error('usage: node prose-lint.mjs <path> [--anchors] [--flesch <min>] [--dupe-words] [--frontmatter-keys k1,k2]');
    process.exit(2);
  }
  const target = resolve(opts.path);
  if (!existsSync(target)) { console.error(`prose-lint: path not found: ${opts.path}`); process.exit(2); }

  const files = collectMarkdown(target);
  let totalViolations = 0;
  for (const file of files.sort()) {
    const violations = lintFile(file, opts);
    if (violations.length) {
      totalViolations += violations.length;
      const rel = relative(process.cwd(), file) || file;
      console.error(`\n${rel}`);
      for (const v of violations) console.error(`  - ${v}`);
    }
  }

  if (totalViolations > 0) {
    console.error(`\nprose-lint: FAIL — ${totalViolations} violation(s) across ${files.length} file(s).`);
    process.exit(1);
  }
  console.log(`prose-lint: OK — ${files.length} file(s) scanned, no violations.`);
  process.exit(0);
}

main();

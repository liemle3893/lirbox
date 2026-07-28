// CHECK — the restricted-layer scan must stay scoped AND keep its teeth, and the emitted
// conductor must contain no LIVE template-literal interpolation (the invariant that
// licenses blanking template literals whole).
// Locked (evals/**): improvement loops may NEVER edit this file.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');
const core = await import(join(SCRIPTS, 'graph-core.mjs'));

// ONE tokenizer — a VERBATIM COPY of `codeOnly` in scripts/test-loom.cjs.
//
// DO NOT hand-write this from memory or from an older draft. It was extracted mechanically
// at authoring time (a one-off script sliced scripts/test-loom.cjs between the `codeOnly`
// declaration and its first `return out;`, byte for byte) and pasted here unedited, renaming
// only the binding to `conductorBody`. The current tokenizer handles REGEX LITERALS and
// tracks `prev` to tell a regex from a division — an earlier version did neither and had
// three false negatives. A copy made from an older draft freezes the weaker scan and this
// check goes green while the real one regresses.
//
// The drift assertion at the bottom of this file is what makes that mechanical rather than
// a promise. It is the point of the copy, not a formality: an earlier "must stay identical"
// comment-only convention let the two diverge (4253 chars vs 1304) before anything noticed.
const conductorBody = (src) => {
    let out = '';
    let i = 0;
    const n = src.length;
    const stack = [{ mode: 'code', depth: 0, interp: false }];
    let prev = '';   // last significant char emitted in code mode — decides regex vs divide

    while (i < n) {
      const top = stack[stack.length - 1];
      const c = src[i], c2 = src[i + 1];

      if (top.mode === 'tmpl') {
        if (c === '\\') { i += 2; continue; }                 // escaped char in template text
        if (c === '`') { stack.pop(); out += '""'; prev = '"'; i++; continue; }
        if (c === '$' && c2 === '{') {                         // live interpolation -> code
          stack.push({ mode: 'code', depth: 0, interp: true });
          out += ' '; prev = ''; i += 2; continue;
        }
        i++; continue;                                         // literal text -> dropped
      }

      if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && c2 === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2; continue;
      }
      // Regex literal. Without this, a regex containing `}`, a backtick, or a quote is
      // read as code and derails the mode stack — `/}/` inside an interpolation popped it
      // early, and a backtick inside a regex opened a phantom template — hiding every
      // forbidden primitive after it. All three were real FALSE NEGATIVES.
      // A `/` opens a regex only in expression position; otherwise it is division.
      // The body is DATA (it cannot execute), so it is blanked — the point is only that
      // its contents must not be mistaken for a string, template, or closing brace.
      //
      // KNOWN LIMITATION, deliberately not fixed. The expression-position test keys off
      // PUNCTUATION in `prev`, not keywords. So `return /foo+/;` reads the `/` as
      // division; if the regex body then ends in a trigger-set character (a trailing `+`
      // is enough) the real closing `/` is taken as opening a new regex, and same-line
      // code after it is swallowed. Contained to one line by the newline bail below.
      //
      // Do not "fix" this by adding keywords to the trigger set — that was measured and
      // it trades one false negative for another: a keyword regex matches `o.return / 2`
      // (the `.` counts as a word boundary), so division after a property named `return`
      // then gets eaten instead, and `return /a[/` stays broken regardless. Making this
      // correct needs a real JS lexer, not a bigger heuristic.
      //
      // Accepted because: no regex literal exists anywhere in graph-core.mjs or the
      // generator; the blast radius is one physical line; and this scan guards a rule
      // (no fs/Date.now in the conductor layer) that the restricted runtime would fail
      // loudly on anyway. If regex literals ever enter the scanned sources, revisit with
      // a real lexer rather than another heuristic.
      if (c === '/' && (prev === '' || '=(,:[!&|?{};+-*%~^<>'.includes(prev))) {
        i++;
        let inClass = false;
        while (i < n) {
          const d = src[i];
          if (d === '\\') { i += 2; continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { i++; break; }
          else if (d === '\n') break;        // unterminated — bail, don't swallow the file
          i++;
        }
        while (i < n && /[gimsuyd]/.test(src[i])) i++;         // flags
        out += '""'; prev = '"';
        continue;
      }
      if (c === "'" || c === '"') {
        const q = c; i++;
        while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
        i++; out += '""'; prev = '"'; continue;
      }
      if (c === '`') { stack.push({ mode: 'tmpl' }); i++; continue; }
      if (top.interp) {
        if (c === '{') { top.depth++; out += c; prev = c; i++; continue; }
        if (c === '}') {
          if (top.depth === 0) { stack.pop(); out += ' '; prev = ''; i++; continue; }
          top.depth--; out += c; prev = c; i++; continue;
        }
      }
      out += c;
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    return out;
};

const FORBIDDEN = [
  ['require(', /\brequire\s*\(/], ['Date.now', /\bDate\.now\s*\(/],
  ['new Date', /\bnew Date\b/], ['Math.random', /\bMath\.random\s*\(/],
  ['crypto', /\bcrypto\b/], ['fs.', /\bfs\s*\./],
];

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// Node prompts deliberately name forbidden primitives as PROSE — must not false-positive.
const g = {
  name: 's', goal: 's', start: 'S', terminal: 'D',
  nodes: [{ id: 'S', kind: 'work', prompt: 'Do not use fs. or Date.now() or crypto here.' },
          { id: 'G', kind: 'gate', locked: true, prompt: 'Judge. Math.random() in prose.' },
          { id: 'D', kind: 'terminal' }],
  edges: [{ from: 'S', to: 'G', when: 'always' },
          { from: 'G', to: 'D', when: { field: 'passed', eq: true }, locked: true },
          { from: 'G', to: 'S', when: { field: 'passed', eq: false }, locked: true }],
  invariants: { mustCross: ['G'], visitCaps: { '*': 3 }, nodeBudget: 20 },
};
g.invariants.lockedHash = core.lockedFingerprint(g);
const tmp = mkdtempSync(join(tmpdir(), 'loom-scan-'));
const gf = join(tmp, 'g.json'), out = join(tmp, 's.js');
writeFileSync(gf, JSON.stringify(g));
execFileSync('node', [join(SCRIPTS, 'scaffold-loom.cjs'), '--name', 's',
  '--graph', gf, '--out', out, '--force'], { stdio: 'pipe' });
const src = readFileSync(out, 'utf8');

ok(!FORBIDDEN.some(([, re]) => re.test(conductorBody(src))),
  'no false positive on prose in comments and node prompts');
ok(FORBIDDEN.every(([, re]) => !re.test(conductorBody(
  '// see the `unclosed markdown code span\nconst bad = `real: ${1}`'))),
  'a stray backtick in a comment does not shift template parity (control: no forbidden code)');

for (const [label, code] of [
  ['Date.now', 'const t = Date.now()'], ['Math.random', 'const r = Math.random()'],
  ['require', 'const x = require("fs")'], ['fs.', 'fs.writeFileSync(a, b)'],
  ['new Date', 'const d = new Date()'], ['crypto', 'const h = crypto.createHash("sha256")'],
]) {
  const tampered = conductorBody(src.replace('const NAME =', code + '\nconst NAME ='));
  ok(FORBIDDEN.some(([, re]) => re.test(tampered)), `scan still catches injected ${label}`);
}

// The three shapes that defeated earlier approaches must all be CAUGHT.
ok(FORBIDDEN.some(([, re]) => re.test(conductorBody('const x = `${f({a: Date.now()})}`'))),
  'nested-brace interpolation is scanned');
ok(FORBIDDEN.some(([, re]) => re.test(conductorBody(
  '// stray ` tick\nconst bad = `real: ${Date.now()}`'))),
  'stray backtick in a comment cannot hide a live interpolation');
// And an escaped placeholder named crypto must NOT false-positive.
ok(!FORBIDDEN.some(([, re]) => re.test(conductorBody('const p = `\\${crypto}`'))),
  'escaped placeholder named crypto stays clean');

// ---- DRIFT: this file's tokenizer must BE the net's tokenizer, not resemble it ----
// "Must stay identical" enforced by a comment is enforced by nothing — the Task 8 lesson.
// Extract both bodies and compare them textually.
const netSrc = readFileSync(join(SCRIPTS, 'test-loom.cjs'), 'utf8');
const body = (src, decl) => {
  const i = src.indexOf(decl);
  if (i < 0) return null;
  const j = src.indexOf('return out;', i);
  return j < 0 ? null : src.slice(i + decl.length, j).replace(/\s+/g, ' ').trim();
};
const netTok = body(netSrc, 'const codeOnly = (src) => {');
const ownTok = body(readFileSync(fileURLToPath(import.meta.url), 'utf8'),
  'const conductorBody = (src) => {');
ok(netTok !== null, 'found codeOnly in scripts/test-loom.cjs');
ok(ownTok !== null, 'found conductorBody in this check');
ok(netTok !== null && ownTok !== null && netTok === ownTok,
  'this check\'s tokenizer is textually identical to the net\'s codeOnly '
  + '(if this fails, one was changed without the other — sync them, do not delete this test)');

if (bad) { console.error(`\npurity-scan-has-teeth: ${bad} failed`); process.exit(1); }
console.log('purity-scan-has-teeth: ok');

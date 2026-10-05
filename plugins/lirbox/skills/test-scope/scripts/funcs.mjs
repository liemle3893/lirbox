// Function finder + function-entry mutation text for JS/TS, Python and Go. No dependencies, no parser:
// strings/comments/regex literals are blanked, then braces (indentation for Python) are matched.
// It is a heuristic: a miss shows up as "not mutable", a false positive as an inconclusive mutant, never as a pass.

export const langOf = (file) => (/\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/.test(file) ? 'js' : file.endsWith('.py') ? 'py' : file.endsWith('.go') ? 'go' : null);

// ───────────── blanking ─────────────
/** Same-length copy of `text` with comments, string/template contents and regex literals replaced by spaces. */
export function blank(text, lang) {
  const n = text.length;
  const out = text.split('');
  const wipe = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  const strEnd = (j) => {
    const q = text[j];
    if (lang === 'py' && text.startsWith(q.repeat(3), j)) {
      const t = q.repeat(3);
      let k = j + 3;
      while (k < n) { if (text[k] === '\\') { k += 2; continue; } if (text.startsWith(t, k)) return k + 3; k++; }
      return n;
    }
    let k = j + 1;
    while (k < n) {
      if (text[k] === '\\') { k += 2; continue; }
      if (text[k] === q) return k + 1;
      if (text[k] === '\n') return k; // unterminated: stop at the line end (JSX text, stray apostrophe)
      k++;
    }
    return n;
  };
  const skipExpr = (j) => {
    let depth = 1;
    while (j < n && depth > 0) {
      const c = text[j];
      if (c === '`') { j = tplEnd(j); continue; }
      if (c === '"' || c === "'") { j = strEnd(j); continue; }
      if (c === '{') depth++; else if (c === '}') depth--;
      j++;
    }
    return j;
  };
  const tplEnd = (i) => {
    let j = i + 1;
    while (j < n) {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '`') return j + 1;
      if (text[j] === '$' && text[j + 1] === '{') { j = skipExpr(j + 2); continue; }
      j++;
    }
    return n;
  };
  const regexOk = (i) => {
    let k = i - 1;
    while (k >= 0 && /[ \t]/.test(text[k])) k--;
    if (k < 0) return true;
    if ('(,=:[!&|?{};+-*%<>~^\n'.includes(text[k])) return true;
    return /(?:^|[^\w$])(return|typeof|case|delete|void|throw|in|of|instanceof|new|yield|await|else)$/.test(text.slice(Math.max(0, k - 12), k + 1));
  };
  let i = 0;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (lang === 'py') {
      if (c === '#') { let j = text.indexOf('\n', i); if (j < 0) j = n; wipe(i, j); i = j; continue; }
      if (c === '"' || c === "'") { const e = strEnd(i); wipe(i, e); i = e; continue; }
    } else {
      if (c === '/' && d === '/') { let j = text.indexOf('\n', i); if (j < 0) j = n; wipe(i, j); i = j; continue; }
      if (c === '/' && d === '*') { let j = text.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; wipe(i, j); i = j; continue; }
      if (c === '"' || c === "'") { const e = strEnd(i); wipe(i, e); i = e; continue; }
      if (c === '`') {
        if (lang === 'go') { let j = text.indexOf('`', i + 1); j = j < 0 ? n : j + 1; wipe(i, j); i = j; continue; }
        const e = tplEnd(i); wipe(i, e); i = e; continue;
      }
      if (c === '/' && lang === 'js' && regexOk(i)) {
        let j = i + 1, cls = false, ok = false;
        while (j < n) {
          const x = text[j];
          if (x === '\\') { j += 2; continue; }
          if (x === '\n') break;
          if (x === '[') cls = true; else if (x === ']') cls = false;
          else if (x === '/' && !cls) { ok = true; break; }
          j++;
        }
        if (ok) { j++; while (/[a-z]/i.test(text[j] || '')) j++; wipe(i, j); i = j; continue; }
      }
    }
    i++;
  }
  return out.join('');
}

function matchClose(b, i, open, close) {
  let depth = 0;
  for (let k = i; k < b.length; k++) {
    if (b[k] === open) depth++;
    else if (b[k] === close && --depth === 0) return k;
  }
  return -1;
}
function matchOpenBack(b, i, open, close) {
  let depth = 0;
  for (let k = i; k >= 0; k--) {
    if (b[k] === close) depth++;
    else if (b[k] === open && --depth === 0) return k;
  }
  return -1;
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo + 1; };
}

const JS_NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do', 'with', 'typeof', 'await', 'async', 'new', 'throw', 'super', 'import', 'delete', 'void', 'yield', 'case', 'in', 'of', 'instanceof', 'export', 'default', 'var', 'let', 'const', 'class', 'extends', 'interface', 'type', 'enum', 'namespace', 'declare']);

/** Index of the `{` that opens the body after a parameter list closed at p-1, or -1 (overload, expression-bodied arrow). */
function jsBodyOpen(b, p) {
  let i = p;
  for (;;) {
    while (i < b.length && /\s/.test(b[i])) i++;
    if (b[i] === '{') return i;
    if (b[i] === '=' && b[i + 1] === '>') {
      i += 2;
      while (i < b.length && /\s/.test(b[i])) i++;
      return b[i] === '{' ? i : -1;
    }
    if (b[i] !== ':') return -1;
    // return type annotation: walk to the body brace, hopping over object-type literals
    i++;
    let depth = 0, last = ':';
    for (; i < b.length; i++) {
      const c = b[i];
      if (c === '=' && b[i + 1] === '>' && depth === 0) break;
      if (c === '(' || c === '[' || c === '<') depth++;
      else if (c === ')' || c === ']' || c === '>') depth--;
      else if (c === ';' && depth <= 0) return -1;
      else if (c === '{' && depth <= 0) {
        if (':|&<,('.includes(last)) { const e = matchClose(b, i, '{', '}'); if (e < 0) return -1; i = e; last = '}'; continue; }
        return i;
      }
      if (!/\s/.test(c)) last = c;
    }
  }
}

/**
 * Functions of a file: [{name, startLine, bodyOpenLine, endLine, open, mutable, reason?}]. `open` is the offset of the
 * body's `{` (Python: of the first body line); `endLine` is the last line of the body.
 */
export function findFunctions(text, lang) {
  const b = blank(text, lang);
  const lineAt = lineIndex(text);
  const out = [];
  const seen = new Set();
  const add = (f) => { if (seen.has(f.open)) return; seen.add(f.open); out.push(f); };
  if (lang === 'js') {
    const body = (name, startOff, parenClose) => {
      const open = jsBodyOpen(b, parenClose + 1);
      if (open < 0) return;
      const close = matchClose(b, open, '{', '}');
      if (close < 0) return;
      add({ name, startLine: lineAt(startOff), bodyOpenLine: lineAt(open), endLine: lineAt(close), open, mutable: true });
    };
    const infer = (idx) => { const m = /([\w$.]+)\s*[:=]\s*(?:async\s+)?$/.exec(b.slice(Math.max(0, idx - 80), idx)); return m ? m[1] : 'anonymous'; };
    for (const m of b.matchAll(/\bfunction\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*(?:<[^()]*>)?\s*\(/g)) {
      const p = m.index + m[0].length - 1;
      const close = matchClose(b, p, '(', ')');
      if (close >= 0) body(m[1] || infer(m.index), m.index, close);
    }
    for (const m of b.matchAll(/^[ \t]*(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*(\*\s*)?([A-Za-z_$#][\w$]*)\s*(?:<[^()]*>)?\s*\(/gm)) {
      if (JS_NOT_METHOD.has(m[2])) continue;
      const p = m.index + m[0].length - 1;
      const close = matchClose(b, p, '(', ')');
      if (close >= 0) body(m[2], m.index + m[0].search(/\S/), close);
    }
    for (const m of b.matchAll(/=>/g)) {
      let j = m.index - 1;
      while (j >= 0 && /\s/.test(b[j])) j--;
      let startOff = m.index;
      if (b[j] === ')') { const s = matchOpenBack(b, j, '(', ')'); if (s >= 0) startOff = s; }
      else { let s = j; while (s >= 0 && /[\w$]/.test(b[s])) s--; if (s < j) startOff = s + 1; }
      let k = m.index + 2;
      while (k < b.length && /\s/.test(b[k])) k++;
      if (b[k] !== '{') continue; // expression-bodied arrow: no statement position to mutate
      const close = matchClose(b, k, '{', '}');
      if (close < 0) continue;
      add({ name: infer(startOff), startLine: lineAt(startOff), bodyOpenLine: lineAt(k), endLine: lineAt(close), open: k, mutable: true });
    }
  } else if (lang === 'go') {
    for (const m of b.matchAll(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\(/gm)) {
      const p = m.index + m[0].length - 1;
      const close = matchClose(b, p, '(', ')');
      if (close < 0) continue;
      let depth = 0, open = -1;
      for (let i = close + 1; i < b.length; i++) {
        const c = b[i];
        if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
        else if (c === '\n' && depth <= 0) break;
        else if (c === '{' && depth <= 0) { open = i; break; }
      }
      if (open < 0) continue;
      const end = matchClose(b, open, '{', '}');
      if (end >= 0) add({ name: m[1], startLine: lineAt(m.index), bodyOpenLine: lineAt(open), endLine: lineAt(end), open, mutable: true });
    }
    for (const m of b.matchAll(/[^\w]func\s*\(/g)) { // func literals (closures)
      const p = m.index + m[0].length - 1;
      const close = matchClose(b, p, '(', ')');
      if (close < 0) continue;
      let depth = 0, open = -1;
      for (let i = close + 1; i < b.length; i++) {
        const c = b[i];
        if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
        else if (c === '\n' && depth <= 0) break;
        else if (c === '{' && depth <= 0) { open = i; break; }
      }
      if (open < 0) continue;
      const end = matchClose(b, open, '{', '}');
      if (end >= 0) add({ name: 'func literal', startLine: lineAt(m.index + 1), bodyOpenLine: lineAt(open), endLine: lineAt(end), open, mutable: true });
    }
  } else if (lang === 'py') {
    const ls = b.split('\n');
    const orig = text.split('\n');
    const lineStart = []; let o = 0;
    for (const l of ls) { lineStart.push(o); o += l.length + 1; }
    const indentOf = (l) => /^[ \t]*/.exec(l)[0].length;
    for (let i = 0; i < ls.length; i++) {
      const m = /^([ \t]*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(ls[i]);
      if (!m) continue;
      const p = lineStart[i] + m[0].length - 1;
      const close = matchClose(b, p, '(', ')');
      if (close < 0) continue;
      let depth = 0, colon = -1;
      for (let k = close + 1; k < b.length; k++) { const c = b[k]; if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; else if (c === ':' && depth === 0) { colon = k; break; } else if (c === '\n' && depth === 0) break; }
      if (colon < 0) continue;
      const colonLine = lineAt0(lineStart, colon);
      const rest = ls[colonLine].slice(colon - lineStart[colonLine] + 1).trim();
      const defIndent = indentOf(ls[i]);
      if (rest) { add({ name: m[2], startLine: i + 1, bodyOpenLine: colonLine + 1, endLine: colonLine + 1, open: lineStart[colonLine], mutable: false, reason: 'one-line def' }); continue; }
      let first = -1, last = colonLine;
      for (let k = colonLine + 1; k < ls.length; k++) {
        if (!ls[k].trim()) continue;
        if (indentOf(ls[k]) <= defIndent) break;
        if (first < 0) first = k;
        last = k;
      }
      if (first < 0) { add({ name: m[2], startLine: i + 1, bodyOpenLine: colonLine + 1, endLine: colonLine + 1, open: lineStart[colonLine], mutable: false, reason: 'empty body' }); continue; }
      add({ name: m[2], startLine: i + 1, bodyOpenLine: colonLine + 1, endLine: last + 1, open: lineStart[first], mutable: true, indent: /^[ \t]*/.exec(orig[first])[0] });
    }
  }
  return out.sort((x, y) => x.startLine - y.startLine || x.open - y.open);
}
const lineAt0 = (starts, off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo; };

/** The text of `text` with a throw/raise/panic carrying `marker` inserted at the entry of function `f`. */
export function mutateText(text, lang, f, marker) {
  if (!f.mutable) throw new Error(`function ${f.name} is not mutable (${f.reason})`);
  if (lang === 'js') return `${text.slice(0, f.open + 1)} throw new Error(${JSON.stringify(marker)});${text.slice(f.open + 1)}`;
  if (lang === 'go') return `${text.slice(0, f.open + 1)} panic(${JSON.stringify(marker)});${text.slice(f.open + 1)}`;
  return `${text.slice(0, f.open)}${f.indent}raise RuntimeError(${JSON.stringify(marker)})\n${text.slice(f.open)}`;
}

// ───────────── changed lines ─────────────
/** `git diff -U0` text -> Map<file, {lines:Set<number>, touch:Set<number>}> (new-side line numbers; touch = deletion points). */
export function parseDiffLines(diff) {
  const res = new Map();
  let cur = null;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { const f = l.slice(4); cur = f === '/dev/null' ? null : f.replace(/^b\//, ''); if (cur && !res.has(cur)) res.set(cur, { lines: new Set(), touch: new Set() }); continue; }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (!m || !cur) continue;
    const start = +m[1], len = m[2] === undefined ? 1 : +m[2];
    if (len === 0) res.get(cur).touch.add(Math.max(1, start));
    else for (let k = start; k < start + len; k++) res.get(cur).lines.add(k);
  }
  return res;
}

/** Innermost function containing each changed line; lines outside every function come back as moduleLevel. */
export function changedFunctions(funcs, lines, touch = new Set()) {
  const hit = new Set();
  const moduleLevel = [];
  const inner = (ln) => funcs.filter((f) => f.startLine <= ln && ln <= f.endLine).sort((x, y) => (x.endLine - x.startLine) - (y.endLine - y.startLine))[0];
  for (const ln of [...lines].sort((x, y) => x - y)) { const f = inner(ln); if (f) hit.add(f); else moduleLevel.push(ln); }
  for (const ln of touch) { const f = inner(ln); if (f) hit.add(f); }
  return { functions: [...hit].sort((x, y) => x.startLine - y.startLine), moduleLevel };
}

export const rangeText = (nums) => {
  const s = [...nums].sort((a, b) => a - b), out = [];
  for (let i = 0; i < s.length;) { let j = i; while (s[j + 1] === s[j] + 1) j++; out.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`); i = j + 1; }
  return out.join(',');
};

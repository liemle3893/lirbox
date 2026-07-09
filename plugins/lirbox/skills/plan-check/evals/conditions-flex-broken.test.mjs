// WHETSTONE ACCEPTANCE-CHECK — concern id: conditions-flex-broken
// RED on the committed baseline; flips GREEN only after a real fix to
// assets/template.html. Do NOT edit the template to satisfy this check trivially.
//
// Concern: the "Conditions to clear before GO" list renders broken because
// `ul.conditions li.condition` is `display:flex` AND the condition body
// ({{CONDITION_1}}) sits as BARE mixed inline content directly inside that flex
// <li>. Every text run and inline <code> then becomes its own flex item, shrunk
// to min-content and wrapping per word.
//
// Observable structural invariant of the fix (asserted robustly, not by exact
// string): the body can no longer fragment into flex items iff EITHER
//   (a) the condition <li> (or its list) no longer lays the body out with
//       display:flex, OR
//   (b) {{CONDITION_1}} is enclosed in a SINGLE wrapper element spanning the
//       whole <li> body (e.g. <div class="cbody">…</div>), so the flex <li> has
//       exactly two children (the ☐ ::before marker + one block wrapper).
//
// FAILS (exit 1, concern PRESENT) iff BOTH: li.condition uses display:flex AND
// {{CONDITION_1}} is bare/fragmentable directly under the <li>. PASSES otherwise.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, '..', 'assets', 'template.html');
const PLACEHOLDER = '{{CONDITION_1}}';

const html = await readFile(TEMPLATE, 'utf8');
// Strip HTML comments so template guidance (which itself mentions a literal
// `<li class="condition">`) can't be mistaken for real markup.
const noComments = html.replace(/<!--[\s\S]*?-->/g, '');

function fail(reason) {
  console.error(`FAIL [conditions-flex-broken]: ${reason}`);
  process.exit(1);
}
function pass(reason) {
  console.log(`PASS [conditions-flex-broken]: ${reason}`);
  process.exit(0);
}

// --- (a) does the condition <li> lay out its body with (inline-)flex? ----------
// Scan every CSS rule; a rule whose selector targets `li.condition` (excluding the
// ::before marker rule) with `display:flex` counts. Property may appear anywhere
// in the declaration block; tolerant of whitespace.
const styleMatch = noComments.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
const css = styleMatch ? styleMatch[1] : '';
let conditionLiUsesFlex = false;
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
let rule;
while ((rule = ruleRe.exec(css))) {
  const selector = rule[1];
  const body = rule[2];
  if (!/li\.condition\b/.test(selector)) continue;
  if (/::?before\b|::?after\b/.test(selector)) continue; // marker/pseudo rule
  if (/\bdisplay\s*:\s*(inline-)?flex\b/i.test(body)) conditionLiUsesFlex = true;
}

// --- (b) is {{CONDITION_1}} bare inline content directly under the flex <li>? ---
// Locate the <li class="condition"> whose body contains the placeholder, then
// determine whether its (trimmed) body is a SINGLE element wrapping the
// placeholder, vs. bare text / multiple top-level runs that flex would fragment.
const liRe = /<li\b[^>]*class\s*=\s*["'][^"']*\bcondition\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
let inner = null;
let li;
while ((li = liRe.exec(noComments))) {
  if (li[1].includes(PLACEHOLDER)) { inner = li[1]; break; }
}
if (inner === null) {
  fail(`no <li class="condition"> containing ${PLACEHOLDER} found in template — check moot / template changed shape.`);
}

// Walk the li body, tracking element nesting depth, to learn:
//  - placeholderDepth: nesting depth of the placeholder (0 = bare direct child)
//  - topLevelElements:  count of element children directly under the <li>
//  - bareTopLevelText:  any non-whitespace text sits directly under the <li>
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base',
  'col', 'embed', 'source', 'track', 'wbr']);
const tagRe = /<\/?([a-zA-Z][\w-]*)\b[^>]*?(\/?)\s*>/g;
const placeholderPos = inner.indexOf(PLACEHOLDER);

let depth = 0;
let last = 0;
let placeholderDepth = null;
let topLevelElements = 0;
let bareTopLevelText = false;

function scanText(text, startAbs, curDepth) {
  const relIdx = placeholderPos - startAbs;
  if (relIdx >= 0 && relIdx < text.length) placeholderDepth = curDepth;
  if (curDepth === 0) {
    const withoutPlaceholder = text.split(PLACEHOLDER).join('');
    if (withoutPlaceholder.trim() !== '') bareTopLevelText = true;
  }
}

let t;
while ((t = tagRe.exec(inner))) {
  scanText(inner.slice(last, t.index), last, depth);
  last = tagRe.lastIndex;
  const name = t[1].toLowerCase();
  const selfClosing = t[2] === '/' || VOID.has(name);
  if (t[0][1] === '/') {
    depth = Math.max(0, depth - 1);
  } else if (!selfClosing) {
    if (depth === 0) topLevelElements++;
    depth++;
  } else if (depth === 0) {
    topLevelElements++; // a void element is still a top-level child
  }
}
scanText(inner.slice(last), last, depth);

// The body is safely wrapped iff there is exactly ONE top-level element child,
// no bare top-level text, and the placeholder lives inside that wrapper (depth>=1).
const bodyIsWrapped =
  topLevelElements === 1 && !bareTopLevelText && (placeholderDepth ?? 0) >= 1;
const bodyIsBare = !bodyIsWrapped;

// --- verdict -------------------------------------------------------------------
if (conditionLiUsesFlex && bodyIsBare) {
  fail(
    `li.condition is display:flex AND ${PLACEHOLDER} is bare/fragmentable directly under the <li> ` +
    `(topLevelElements=${topLevelElements}, placeholderDepth=${placeholderDepth ?? 0}, ` +
    `bareTopLevelText=${bareTopLevelText}) — each text run and inline <code> becomes its own ` +
    `flex item and wraps per word.`
  );
}

if (!conditionLiUsesFlex) {
  pass('condition <li> no longer lays its body out with display:flex — cannot fragment into flex items.');
}
pass(`${PLACEHOLDER} is enclosed in a single wrapper element inside the flex <li> — body flows as one flex item.`);

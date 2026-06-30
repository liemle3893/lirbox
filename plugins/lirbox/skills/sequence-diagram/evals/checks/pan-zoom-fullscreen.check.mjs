// ACCEPTANCE-CHECK (FEATURE concern) — FAILS on the unmodified baseline (fail-before / pass-after).
//
// Concern (issue #4): assets/template.html must ship a self-contained pan/zoom/fullscreen layer
// (vanilla JS+CSS, no new CDN/SRI dep) so large rendered diagrams are navigable, AND bake in the
// four hard-won gotchas so the feature is correct, not just present.
//
// This is a STRUCTURAL presence check on the template — it verifies the machinery is wired in and
// the documented anti-patterns are avoided. It cannot prove panning works in a live browser (a
// headless check can't); it proves the correct primitives are present and the wrong ones absent.
//
// IMPORTANT: comments are STRIPPED before the anti-pattern (forbidden) tests run, so an inline
// comment that *documents* a gotcha (e.g. "// width, not transform: scale()") does NOT trip the
// check — only effective code does. Positive tokens are also matched on the stripped source so a
// token buried in a comment can't fake a pass.
//
// REQUIRED (all must be PRESENT in effective code — machinery + positive half of the gotchas):
//   - requestFullscreen ........................ Fullscreen API toggle
//   - fullscreenElement | fullscreenchange ..... re-fit / popup gating on enter/exit
//   - svg.viewBox.baseVal.width ................ crisp zoom by re-sizing the SVG width (not raster scale)
//   - wheel listener ('wheel' | onwheel) ....... wheel-to-zoom
//   - pointer drag (pointermove | pointerdown) . drag-to-pan
//   - Math.min + Math.max + 0.2 ................ scale clamp (0.2x floor)
//   - min-width:0 .............................. grid track can't be pushed wide (gotcha 3)
//   - overflow:hidden .......................... chart box can't grow (gotcha 2)
//   - <n>vh height ............................. fixed viewport-relative chart-box height (gotcha 2)
//   - popup + a close control .................. in-fullscreen detail popup (gotcha: side panel is outside FS)
//
// FORBIDDEN (all must be ABSENT from effective code — negative half of the gotchas):
//   - will-change .............................. rasterizes the SVG → blur (gotcha 1)
//   - transform scale ('scale(') ............... CSS transform scale → blur; pan must be translate-only (gotcha 1)
//   - setPointerCapture ........................ breaks Mermaid node click handlers (gotcha 4)
//
// RED on baseline: the template has overflow:auto, no fullscreen/zoom/pan wiring → REQUIRED tokens
// missing → this check FAILS. GREEN only once the pan/zoom/fullscreen layer lands correctly.
// Locked (evals/**): the fixer may never edit this file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TEMPLATE = join(ROOT, 'plugins/lirbox/skills/sequence-diagram/assets/template.html');

let raw;
try {
  raw = readFileSync(TEMPLATE, 'utf8');
} catch (e) {
  console.error(`FAIL check: cannot read ${TEMPLATE}: ${e.message}`);
  process.exit(1);
}

// Strip comments so documenting an anti-pattern in prose can't trip (or fake) the check:
//   HTML <!-- -->, CSS/JS /* */, and JS // to EOL (but NOT the // inside a scheme like https://).
const html = raw
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const required = [
  ['fullscreen toggle (requestFullscreen)', /requestFullscreen/],
  ['fullscreen state (fullscreenElement|fullscreenchange)', /fullscreenElement|fullscreenchange/],
  ['crisp zoom via SVG width (viewBox.baseVal.width)', /viewBox\.baseVal\.width/],
  ['wheel-to-zoom (wheel listener)', /['"]wheel['"]|onwheel/],
  ['drag-to-pan (pointer events)', /pointermove|pointerdown/],
  ['scale clamp floor (0.2)', /0\.2\b/],
  ['scale clamp (Math.min)', /Math\.min\s*\(/],
  ['scale clamp (Math.max)', /Math\.max\s*\(/],
  ['grid track min-width:0', /min-width\s*:\s*0\b/],
  ['chart box overflow:hidden', /overflow\s*:\s*hidden/],
  ['fixed vh-based chart-box height', /\b\d+vh\b/],
  ['in-fullscreen popup element', /popup/i],
  ['popup close control', /✕|×|close/i],
];

const forbidden = [
  ['will-change (rasterizes → blur)', /will-change/i],
  ['CSS transform scale (→ blur; pan must be translate-only)', /scale\(/],
  ['setPointerCapture (breaks Mermaid node clicks)', /setPointerCapture/],
];

const missing = required.filter(([, re]) => !re.test(html)).map(([name]) => name);
const present = forbidden.filter(([, re]) => re.test(html)).map(([name]) => name);

if (missing.length === 0 && present.length === 0) {
  console.log('PASS check: template.html wires a self-contained pan/zoom/fullscreen layer with all four gotchas baked in.');
  process.exit(0);
}
if (missing.length) console.error(`FAIL check: missing required machinery → ${missing.join('; ')}`);
if (present.length) console.error(`FAIL check: present forbidden anti-pattern(s) → ${present.join('; ')}`);
process.exit(1);

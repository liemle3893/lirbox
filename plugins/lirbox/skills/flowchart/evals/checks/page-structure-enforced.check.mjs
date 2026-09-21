// ITEM-B ACCEPTANCE-CHECK — RED on the unmodified baseline (fail-before / pass-after).
//
// The gap. validate.mjs is the skill's stated load-bearing gate: "the verify gate a subagent can
// actually run", and SKILL.md tells the author "do NOT claim done while it fails". But it only
// ever inspected Mermaid LABEL ESCAPING. It never looked at the page. So a file with a perfectly
// escaped graph and no <h1>, no <style> and no Mermaid <script> — rubble that renders as unstyled
// text — printed PASS.
//
// This is not hypothetical. An author regex anchored on `%% TEMPLATE-GRAPH-START` matches the
// template's OWN instruction comment first (the comment quotes the marker) and swallows <head>,
// <style> and <header> on the way to the real marker. Observed, and the validator said PASS.
//
// SKILL.md already writes the contract down in its Verify checklist — markers gone, no leftover
// {{…}}, every node clickable with a STEPS entry, DEFAULT_NODE real, exactly one :::crit, one
// <h1 class="title">, integrity + crossorigin intact. It was prose. This makes it executable.
//
// FLOWCHART_VALIDATE_OVERRIDE points at the validate.mjs under test (set by prove-checks).
//
// Locked (evals/**): an automated fixer may never edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE =
  process.env.FLOWCHART_VALIDATE_OVERRIDE || join(HERE, '..', '..', 'assets', 'validate.mjs');
const FIX = (name) => join(HERE, '..', 'fixtures', name);

function exitFor(fixture) {
  try {
    execFileSync('node', [VALIDATE, fixture], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' ? e.status : 1;
  }
}

const failures = [];

// 1. THE INVARIANT. A structurally gutted page must not pass.
const gutted = exitFor(FIX('page-gutted.html'));
if (gutted !== 1) {
  failures.push(
    `a page with no <h1 class="title">, no <style>, no Mermaid <script> and a node with no STEPS ` +
      `entry was accepted (exit ${gutted}). validate.mjs only inspects label escaping — it has to ` +
      `enforce the page contract its own SKILL.md Verify checklist already states.`,
  );
}

// 2. GUARD RAIL. The clean control fixture must KEEP passing. The fixtures in this suite are bare
//    mermaid fragments, not finished pages, so a structural pass that fires on everything would
//    turn all nine sibling tests red. Whatever enforces (1) must skip a fragment.
const clean = exitFor(FIX('clean.html'));
if (clean !== 0) {
  failures.push(
    `the clean control fixture stopped passing (exit ${clean}) — the structural pass is firing on ` +
      `bare mermaid fragments, which breaks every sibling fixture test in this suite.`,
  );
}

// 3. The skill's OWN template, unfilled, must not pass. It still carries every {{PLACEHOLDER}} and
//    both pairs of TEMPLATE markers, so a run that copied the template and forgot to fill it is
//    the most likely way to ship an empty page — and the one the validator should catch first.
const template = exitFor(join(HERE, '..', '..', 'assets', 'template.html'));
if (template !== 1) {
  failures.push(
    `the unfilled template passed its own validator (exit ${template}) — leftover {{…}} ` +
      `placeholders and TEMPLATE-GRAPH/STEPS markers have to be findings, or "copied it and ` +
      `forgot to fill it" ships green.`,
  );
}

if (failures.length) {
  console.error('RED page-structure-enforced:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN page-structure-enforced');

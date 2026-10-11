// Copied from daily-news src/lib/brief/engine.test.mjs — the Prompt Improver's catalog, assembly, guards, scoring and output checks, offline.
import assert from "node:assert/strict";
import { PARTS, PART_IDS, RUBRIC, OVER_RUBRIC, TEMPLATES, TEMPLATE, GUARDS, SNIPPETS, SNIPPET_LIBRARY, GROUPS } from "../../scripts/catalog.mjs";
import {
  partsFor, assemble, guardsFor, questionsIn, answerQuestion, jevJudgeQuestions, jevTemplateQuestions, readJudgeAnswers,
  scorecard, weightedTotal, verdictOf, median, suggestLocal, acceptRewrites, acceptSplit, weakParts, effectiveEffort, partState,
} from "../../scripts/engine.mjs";

const ids = (xs) => xs.map((x) => x.id);
const squash = (s) => s.replace(/\s+/g, " ").trim();

// ── catalog ──
assert.equal(PARTS.length, 10);
for (const id of PART_IDS) { assert.equal(RUBRIC[id].length, 5, `rubric ${id}`); }
assert.equal(OVER_RUBRIC.length, 5);
assert.deepEqual(PARTS.filter((p) => p.w === 2).map((p) => p.id), ["goal", "verify"]);
assert.equal(new Set(ids(TEMPLATES)).size, TEMPLATES.length, "template ids unique");
assert.ok(TEMPLATES.length >= 20, "many templates");
for (const t of TEMPLATES) {
  assert.ok(GROUPS.some((g) => g.id === t.group), `${t.id} group`);
  assert.ok(t.on.includes("goal") && t.on.includes("verify"), `${t.id} has the core parts`);
  for (const id of t.on) {
    assert.ok(PART_IDS.includes(id), `${t.id}: unknown part ${id}`);
    assert.ok(t.hints[id], `${t.id}: hint for ${id}`);
    assert.ok(t.example.parts[id]?.trim(), `${t.id}: example text for ${id}`);
  }
  for (const id of Object.keys(t.example.parts)) assert.ok(t.on.includes(id), `${t.id}: example fills ${id}, which is off`);
  if (t.on.includes("inputs")) assert.ok(t.example.pasted?.length, `${t.id}: inputs needs a pasted example`);
  assert.ok(t.keywords.length >= 5 && t.checks.length >= 1, `${t.id} keywords/checks`);
  assert.equal(questionsIn(Object.values(t.example.parts).join(" ")).length, 0, `${t.id}: example has no open questions`);
}
for (const g of GUARDS) assert.ok(SNIPPETS[g.snip], `guard ${g.id} snippet`);
for (const k of Object.keys(SNIPPET_LIBRARY)) assert.ok(PART_IDS.includes(k), `library ${k}`);

// ── assembly round trip: the three prompts from 11 Oct come out of their templates (every sentence present) ──
const ORIGINAL = {
  game: `I want a browser game called Phở Rush: you run a phở stall in Hanoi during the 6–9am rush. Customers queue on plastic stools, each wants a variation (tái, chín, extra hành, no cilantro), and you assemble bowls by clicking ingredients before their patience runs out. It should feel like an indie game someone would pay $3 for: juicy feedback, sound, and a difficulty curve that gets frantic by 8:30. Make it really good. Use lots of tokens and iterate until you'd be proud to show it. Single HTML file, no build step, works on phone and desktop. Art direction: hand-drawn street-food illustration, warm morning light, steam. Before you tell me it's done, play it yourself in a headless browser. Run a scripted bot through a full in-game morning and check that the difficulty really ramps up and the game is winnable but not trivial.`,
  cli: `Build a small CLI, \`ledger\`, in TypeScript (Node 22). It reads bank statement CSV exports from Vietcombank and Techcombank and writes one normalized ledger (date, amount in VND, counterparty, memo, account) plus a monthly summary by category. Just the CLI and its tests. No web UI, no database, no config system. Categories come from a rules.json (regex → category) that I'll edit by hand; ship a starter one.`,
  overnight: `Overnight project: build Shelf, a self-hosted read-later app for one person. You save a link from a browser extension or the phone share sheet (PWA); it fetches the article, strips it to clean reading text, and makes everything full-text searchable. Stack is your call, but it must start with one \`docker compose up\` on a fresh machine. The budget is about 6 hours: split frontend, backend and extension across subagents so they run in parallel. Leave REPORT.md with the test output, screenshots of the reading view on phone and desktop, and anything you cut.`,
};
for (const [tplId, original] of Object.entries(ORIGINAL)) {
  const t = TEMPLATE[tplId];
  const pasted = (t.example.pasted ?? []).map((b, i) => ({ ...b, id: `id${i}` }));
  const { text } = assemble({ tplId, parts: t.example.parts, pasted });
  for (const sentence of original.split(/(?<=[.!?])\s+/)) assert.ok(squash(text).includes(squash(sentence)), `${tplId}: missing "${sentence}"`);
}

// ── guards follow model, effort, template and options; the effort pick itself is never changed ──
const g = (o) => ids(guardsFor({ tplId: "cli", on: partsFor("cli"), ...o }).guards);
assert.deepEqual(g({ model: "sonnet", effort: "low" }), ["sonnet-carry", "sonnet-verify"]);
assert.deepEqual(g({ model: "sonnet", effort: "medium" }), ["sonnet-carry"]);
assert.deepEqual(g({ model: "sonnet", effort: "" }), [], "unset Sonnet effort = high: no carry line");
assert.deepEqual(g({ model: "sonnet", effort: "max" }), ["sonnet-thorough"]);
assert.deepEqual(g({ model: "opus", effort: "low" }), []);
assert.deepEqual(g({ model: "opus", opts: { unattended: true } }), ["opus-unattended"]);
assert.deepEqual(g({ model: "sonnet", effort: "high", opts: { strictScope: true } }), ["sonnet-strict"]);
assert.deepEqual(g({ model: "opus", pasted: [{ text: "x" }] }), ["pasted"]);
assert.deepEqual(g({ model: "opus", pasted: [{ text: "  " }] }), [], "an empty paste block adds nothing");
assert.deepEqual(ids(guardsFor({ tplId: "overnight", on: partsFor("overnight"), model: "opus" }).guards), ["opus-time"]);
assert.deepEqual(ids(guardsFor({ tplId: "plan", on: partsFor("plan"), model: "sonnet", effort: "low" }).guards), ["sonnet-plan"], "plan only: no carry, no verify paragraph");
assert.deepEqual(ids(guardsFor({ tplId: "analysis", on: partsFor("analysis"), model: "opus" }).guards), ["opus-explore"]);
assert.deepEqual(ids(guardsFor({ tplId: "analysis", on: partsFor("analysis"), model: "sonnet", effort: "low" }).guards), ["sonnet-carry"], "no code to check: no verify paragraph");
assert.ok(ids(guardsFor({ tplId: "game", on: ["goal", "time", "verify"], model: "opus" }).notes).includes("time-advisory"));
assert.equal(effectiveEffort("opus", ""), "medium"); assert.equal(effectiveEffort("sonnet", ""), "high"); assert.equal(effectiveEffort("sonnet", "low"), "low");

// Guard text is placed under its part, verbatim; pasted blocks get matching ids; an off part with a guard still prints it.
{
  const a = assemble({ tplId: "cli", parts: TEMPLATE.cli.example.parts, model: "sonnet", effort: "low", pasted: [{ id: "k3f9", source: "vcb.csv", text: "a,b" }] });
  assert.match(a.text, /From vcb\.csv:\n<pasted_content id="k3f9">\na,b\n<\/pasted_content id="k3f9">/);
  assert.ok(a.text.includes(SNIPPETS.pasted.text) && a.text.includes(SNIPPETS.sonnetCarry.text) && a.text.includes(SNIPPETS.sonnetVerify.text));
  assert.ok(a.text.indexOf(SNIPPETS.sonnetVerify.text) > a.text.indexOf(TEMPLATE.cli.example.parts.verify), "verify guard after the verify part");
  const b = assemble({ tplId: "game", parts: { goal: "A game." }, on: ["goal", "verify"], model: "sonnet", effort: "low" });
  assert.deepEqual(ids(b.sections), ["goal", "autonomy", "verify"], "autonomy is off but carries the Sonnet line");
  assert.equal(b.sections.find((s) => s.id === "autonomy").active, false);
  assert.ok(!b.text.includes("[?"), "empty parts leave no placeholder text");
}

// ── question slots ──
assert.deepEqual(questionsIn("For [?: who plays it?] on [?:which device]."), ["who plays it?", "which device"]);
assert.equal(answerQuestion("For [?: who] on [?: what].", 1, "phones"), "For [?: who] on phones.");
assert.equal(answerQuestion("For [?: who] on [?: what].", 0, "kids"), "For kids on [?: what].");

// ── Jev request shape ──
{
  const q = jevJudgeQuestions(["goal", "scope", "verify"]);
  assert.deepEqual(Object.keys(q), ["part_goal", "part_scope", "part_verify", "over_direction", "clarity"]);
  assert.equal(q.part_goal.type, "score"); assert.equal(q.part_goal.criteria.length, 5); assert.equal(q.clarity.type, "noul");
  assert.match(q.part_goal.instructions, /`brief`/);
  const t = jevTemplateQuestions().template;
  assert.equal(t.type, "choice"); assert.equal(Object.keys(t.criteria).length, TEMPLATES.length);
  const ans = { part_goal: { type: "score", score: 3.2 }, part_scope: { type: "score", score: 1 }, part_verify: { type: "score", score: 0.4 }, over_direction: { type: "score", score: 3.9 }, clarity: { type: "noul", noul: 0.8 } };
  assert.deepEqual(readJudgeAnswers(ans, ["goal", "scope", "verify"]), { parts: { goal: 3.2, scope: 1, verify: 0.4 }, over: 3.9, clarity: 0.8 });
  assert.throws(() => readJudgeAnswers({ ...ans, clarity: undefined }, ["goal"]), /noul answer for clarity/);
}

// ── scoring: the draft's hand-scored samples (game preset weights: goal ×2, verify ×2, others ×1) ──
const GAME = partsFor("game");
const run = (parts, over = 4, clarity = 0.9) => ({ parts, over, clarity });
const snake = { goal: 1, bar: 0, scope: 1, direction: 1, verify: 1, report: 0 };
const pho = { goal: 4, bar: 4, scope: 3, direction: 4, verify: 4, report: 3 };
assert.equal(weightedTotal(snake, GAME), 19); assert.equal(verdictOf(19, 0.9), "rewrite");
assert.equal(weightedTotal(pho, GAME), 94); assert.equal(verdictOf(94, 0.9), "ready");
assert.equal(weightedTotal({ ...pho, verify: 0, report: 0 }, GAME), 59); assert.equal(verdictOf(59, 0.9), "tune");
assert.equal(verdictOf(94, 0.2), "unclear");
assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 4]), 2.5);
assert.equal(partState(2.6), "good"); assert.equal(partState(2.4), "weak"); assert.equal(partState(1.4), "missing");
{
  const c = scorecard([run(snake), run({ ...snake, goal: 1.4 }), run({ ...snake, goal: 0.8 })], GAME);
  assert.equal(c.total, 19); assert.equal(c.verdict, "rewrite"); assert.equal(c.parts.goal.state, "missing");
  assert.equal(c.parts.goal.target, RUBRIC.goal[3]); assert.deepEqual(c.warnings, []);
  assert.deepEqual(weakParts(c, GAME, {}), GAME, "everything is weak or empty");
  const steps = scorecard([run(snake, 1), run(snake, 1.2), run(snake, 0.9)], GAME);
  assert.ok(steps.warnings.some((w) => w.id === "over"));
  const shaky = scorecard([run({ ...pho, scope: 1 }), run(pho), run({ ...pho, scope: 4 })], GAME);
  assert.ok(shaky.warnings.some((w) => w.id === "unstable" && /Scope/.test(w.text)));
  const good = scorecard([run(pho)], GAME);
  assert.deepEqual(weakParts(good, GAME, TEMPLATE.game.example.parts), [], "nothing to improve");
  assert.equal(good.parts.scope.target, RUBRIC.scope[4], "a Good part still shows the next level");
}

// ── local suggestion ──
const top = (s) => suggestLocal(s)[0]?.id;
assert.equal(top("Fix the bug where users get logged out after an hour"), "bugfix");
assert.equal(top("port our HAProxy config parser from C to Rust"), "port");
assert.equal(top("a snake game I can play on my phone"), "game");
assert.equal(top("landing page for my new app with a waitlist"), "landing");
assert.equal(top("telegram bot that posts every morning"), "bot");
assert.equal(top("an MCP server so Claude can search Jira"), "mcp");
assert.equal(top("why did signups drop last week? dig into the data"), "analysis");
assert.equal(top("the search page is slow, speed it up"), "perf");
assert.equal(top("is it possible to render PDFs in the browser? quick prototype"), "spike");
assert.equal(top("give me options and a plan for multi tenancy, no code"), "plan");
assert.equal(top("security audit of our upload code"), "audit");
assert.equal(top("upgrade next.js to the latest major version"), "upgrade");
assert.equal(top("sửa lỗi đăng nhập trên app"), "bugfix");
assert.deepEqual(suggestLocal("hi"), []);
assert.ok(suggestLocal("build a full stack web app with login and a dashboard app").length <= 3);

// ── Opus output checks ──
{
  const r = acceptRewrites([{ id: "goal", text: " For [?: who]. ", why: "adds who" }, { id: "scope", text: "x" }, { id: "goal", text: "dup" }, { id: "verify", text: "" }], ["goal", "verify"]);
  assert.deepEqual(r, [{ id: "goal", text: "For [?: who].", why: "adds who", questions: ["who"] }], "only allowed, non-empty, first per part");
  const original = "Build a snake game in React.\nMake it look nice and   make sure it works.";
  const s = acceptSplit([{ id: "goal", spans: ["Build a snake game in React."] }, { id: "verify", spans: ["make sure it works.", "and run the tests"] }, { id: "bogus", spans: ["x"] }], original);
  assert.deepEqual(s.parts, { goal: "Build a snake game in React.", verify: "make sure it works." });
  assert.equal(s.dropped, 2, "an invented span and an unknown part are dropped");
  assert.equal(acceptSplit([{ id: "direction", spans: ["Make it look nice and make sure"] }], original).parts.direction, "Make it look nice and make sure", "whitespace differences don't matter");
}

console.log(`ok · ${TEMPLATES.length} templates · ${PARTS.length} parts · ${GUARDS.length} guards`);

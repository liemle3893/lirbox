# Graph Report - lirbox  (2026-09-22)

## Corpus Check
- 212 files · ~213,191 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1336 nodes · 1343 edges · 179 communities (131 shown, 48 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 131 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2b1b8be1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- board.mjs
- board-selfcheck.mjs
- validate.mjs headless gate
- whetstone skill
- Evidence manifest (frontend-evidence/manifest.json)
- step-list / autonumber numbering drift (sequence-diagram defect)
- component-diagram/assets/validate.mjs
- do/evals/floor/00-structure.test.mjs
- inline-no-permission-ask.check.mjs
- reject-not-softened.check.mjs
- intake-selfcheck.mjs
- analyze.cjs
- reject-outranks-capability.check.mjs
- SWE-bench-style grading (rung 1, hidden F2P/P2P)
- arena skill
- fallback-is-announced.check.mjs
- lane-always-asks.check.mjs
- conductor skill
- no-interrogation-path.check.mjs
- do/SKILL.md
- Conductor scoreboard (absolute SWE-style scores)
- content-verification (conductor whetstone item)
- do/evals/run.mjs
- evals-all.mjs
- e2b capability-floor finding (Task 0)
- config-refuses-unusable.check.mjs
- mechanical-refutation/tests/skill-assets/validate.mjs
- Conductor layer is restricted pure JS
- Improvement-loop consolidation — replacement status
- Absolute scoring (swe-run scorecard)
- Flowchart Model-Ladder Lift plan (NOT PURSUED)
- triage.mjs
- jev-selfcheck.mjs
- plan-check/assets/validate.mjs
- plan-deck whetstone floor (characterization, green on baseline)
- notes-wide-features task (8 independent plugins)
- frontend-gate-phase (conductor whetstone item)
- validate.mjs headless gate
- evidence.mjs
- code-copy-button.test.mjs
- conditions-flex-broken.test.mjs
- dod-block-contract.test.mjs
- plan-deck acceptance-checks directory (red on baseline)
- jev.mjs
- component-diagram/evals/checks/pan-zoom-fullscreen.check.mjs
- flowchart/assets/validate.mjs
- flowchart/evals/checks/pan-zoom-fullscreen.check.mjs
- agent-name-checked.check.mjs
- dod-template-and-audit.test.mjs
- plan-deck/assets/validate.mjs
- STEPLIST — numbered list as the interactive surface
- initPanZoom
- sequence-diagram/evals/checks/pan-zoom-fullscreen.check.mjs
- Per-concern acceptance check (RED on baseline)
- 01-scripts-contract.test.mjs
- Understanding checklist template
- ledger.go
- lirbox-builder.md
- harness-kinds.sh
- feedback/evals/floor/00-structure.test.mjs
- flowchart/evals/floor/00-structure.test.mjs
- lane-config/evals/floor/00-structure.test.mjs
- Grader fairness law (assert only what task.md states)
- lirbox-verifier.md
- skill-lint/evals/floor/00-structure.test.mjs
- uglify-corner-cases task (xxhard real-repo tier)
- Microsoft SkillOpt (skill file as trainable parameter)
- exotic-shape-rejected.check.mjs
- orphan-node.check.mjs
- steps-orphan-key.check.mjs
- untyped-edge.check.mjs
- component-diagram/evals/floor/structure.test.mjs
- loom: runtime proof of the gate-failure back-edge
- execution-shape.check.mjs
- 01-scrub.test.mjs
- node-nonascii.check.mjs
- edge-nonascii.test.mjs
- orch-lane.sh
- plan-check/evals/floor/structure.test.mjs
- validate-counts-css-verdict.test.mjs
- plan-deck/evals/floor/structure.test.mjs
- sequence-diagram/assets/validate.mjs
- kind-arrow-mismatch.check.mjs
- retry-backoff-guidance.check.mjs
- steplist-missing-fromto.check.mjs
- steplist-missing-kind.check.mjs
- unbalanced-activation.check.mjs
- sequence-diagram/evals/floor/structure.test.mjs
- Thin-floor warning (frontmatter-only floor is not enough)
- autofix-bounded.check.mjs
- lirbox-planner.md
- external-system-guidance.check.mjs
- harbor-prep.mjs
- plan-deck honesty rules
- Ledger Compaction — Implementation Plan
- lirbox plugin marketplace
- Methodological finding — odd passes turn position bias into a fake winner
- selectNode
- 01-node-paren-flagged.test.mjs
- 02-clean-passes.test.mjs
- train/03-edge-dashlabel-nonascii.test.mjs
- train/04-round-node-special.test.mjs
- 05-literal-newline-flagged.test.mjs
- 01-clean-passes.test.mjs
- 02-html-entity-flagged.test.mjs
- val/03-edge-dashlabel-nonascii.test.mjs
- val/04-round-node-special.test.mjs
- lane-config/evals/run.mjs
- Raw-tier honesty (specsWritten MUST be 0, evidence-only flags)
- pre-commit
- component-diagram/evals/run.mjs
- Pinned Mermaid script with SRI integrity
- flowchart/evals/run.mjs
- flowchart/evals/run-scored.mjs
- route-guard.sh
- orch-config.sh
- plan-check/evals/run.mjs
- plan-deck/evals/run.mjs
- sequence-diagram/evals/run.mjs
- autofix-bounded/tests/skill-assets/validate.mjs
- lirbox project logo (flat-vector toolbox with tools)
- A skill's frontmatter description is its trigger
- Add a brand-new plugin to the marketplace
- Prefer judge = claude-code on a subscription token
- --plugin-dir conductor-version axis
- pre-push
- likec4.sh
- feedback whetstone floor
- feedback/evals/run.mjs
- Skill title
- classDef palette (term/dec/ok/fail/crit)
- #dod machine-readable JSON block
- Line-ref rule (prefer file · symbol over file:line)
- fetch_pr.sh
- skill-lint/evals/run.mjs
- Toolbox brand metaphor (a box of ready-to-grab tools = plugin marketplace of skills)
- Add a new agent to the lirbox plugin
- -y is mandatory for an agent (Harbor aborts on non-TTY)
- isolated = true needs mount privileges the container lacks
- uvx --from, not --with, for harbor-rewardkit
- Independently shippable milestone slices (not a waterfall)
- Retry-with-backoff modeling (exit condition in loop label, backoff on reply)
- tags check (unbalanced structural XML tags)
- c4-model skill
- deep-understanding skill
- Conductor — failure triage on resume
- prove-checks.mjs
- Progressive disclosure — relocate meaning into references/, never delete
- scrub-and-shape/tests/test.sh
- ci-pipeline/tests/test.sh
- escaping-hostile/tests/test.sh
- fix-disposition.check.mjs
- task-graph.check.mjs
- Autofix — repairing the plan without laundering it
- execution-shape/tests/skill-assets/validate-legacy.mjs
- Schedule Run Hang Fix — Implementation Plan
- Schedule Run Bookkeeping — Implementation Plan
- .Resolve
- .Run
- autofix-bounded/solution/solve.sh
- autofix-bounded/tests/test.sh
- execution-shape/solution/solve.sh
- execution-shape/tests/test.sh
- goal-coverage.check.mjs
- goal-coverage/tests/skill-assets/validate.mjs
- validate-legacy.mjs
- Checkout Latency — Implementation Plan
- mechanical-refutation/solution/solve.sh
- goal-coverage/solution/solve.sh
- goal-coverage/tests/test.sh
- mechanical-refutation/tests/test.sh

## God Nodes (most connected - your core abstractions)
1. `conductor skill` - 13 edges
2. `loom: runtime proof of the gate-failure back-edge` - 11 edges
3. `analyzeSkill()` - 10 edges
4. `whetstone skill` - 9 edges
5. `Improvement-loop consolidation — replacement status` - 8 edges
6. `Conductor — failure triage on resume` - 8 edges
7. `validate.mjs headless gate` - 8 edges
8. `validate.mjs headless gate` - 8 edges
9. `Matrices` - 7 edges
10. `clean fixture (validator PASS baseline)` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Output contract` --semantically_similar_to--> `Evidence manifest (frontend-evidence/manifest.json)`  [INFERRED] [semantically similar]
  templates/agent-template.md → plugins/lirbox/agents/lirbox-web-verifier.md
- `Tests must fail for the RIGHT reason (RED step)` --semantically_similar_to--> `Per-concern acceptance check (RED on baseline)`  [INFERRED] [semantically similar]
  plugins/lirbox/agents/lirbox-test-writer.md → docs/whetstone-ready.md
- `A test fixture must have the same shape as what ships` --semantically_similar_to--> `Discrimination gate: run -a nop alongside -a oracle`  [INFERRED] [semantically similar]
  docs/plans/2026-07-27-loom-graph-runtime.md → CONTRIBUTING.md
- `A 0 is a finding: engagement failure vs quality failure` --semantically_similar_to--> `Read the Engaged column before the headline`  [INFERRED] [semantically similar]
  CONTRIBUTING.md → docs/arena/scores/README.md
- `Repo-wide regression gate (evals workflow)` --semantically_similar_to--> `Lock the floor's own regression net (else the fixer weakens it)`  [INFERRED] [semantically similar]
  .github/workflows/evals.yml → docs/whetstone-ready.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **The three-tier skill shipping gate** — claude_three_tier_shipping, contributing_tier1_validate_smoke, contributing_tier2_evals, contributing_tier3_harbor, contributing_discrimination_gate_nop_oracle [EXTRACTED 1.00]
- **The argument that no path reaches the terminal without crossing every gate** — docs_specs_2026_07_27_loom_graph_runtime_design_invariants_frozen_at_approval, docs_specs_2026_07_27_loom_graph_runtime_design_structural_dominance, docs_specs_2026_07_27_loom_graph_runtime_design_positional_dominance, docs_plans_2026_07_27_loom_graph_runtime_non_passing_edge_rule, docs_plans_2026_07_27_loom_graph_runtime_cursor_rename_fails_closed, docs_plans_2026_07_27_loom_graph_runtime_fnv1a_drift_detector [EXTRACTED 1.00]
- **Engagement-vs-quality measurement discipline across the eval stack** — docs_arena_scores_readme_engagement_column, docs_evals_eval_engine_plan_headline_metric_bug, docs_evals_eval_engine_plan_engagement_measured_not_assumed, docs_arena_scores_readme_dagger_engagement_assumed, contributing_engagement_vs_quality_failure, docs_plans_2026_07_28_flowchart_model_ladder_lift_e2b_capability_floor [EXTRACTED 1.00]
- **Arena's two-rung scoring stack (deterministic grade + blinded pairwise judge)** — docs_arena_guide_swe_bench_grading, docs_arena_guide_absolute_scorecard, docs_arena_guide_forfeit_rule, docs_arena_guide_even_judge_passes, docs_arena_guide_suite_fingerprint, docs_arena_handoff_two_scoring_layers [EXTRACTED 1.00]
- **SkillOpt control mechanisms as implemented in whetstone/prospector** — docs_skill_improvement_cookbook_scored_task_set, docs_skill_improvement_cookbook_harvest_feedback, docs_skill_improvement_cookbook_consolidate_flag, docs_skill_improvement_cookbook_max_diff_lines, docs_skill_improvement_cookbook_val_delta, docs_skillopt_exploration_skillopt [EXTRACTED 1.00]
- **Frontend/mobile verification gate (agents + frozen engines + evidence + phase)** — plugins_lirbox_agents_lirbox_web_verifier_lirbox_web_verifier, plugins_lirbox_agents_lirbox_mobile_verifier_lirbox_mobile_verifier, plugins_lirbox_agents_lirbox_web_verifier_evidence_manifest, docs_specs_2026_07_10_frontend_mobile_verification_gate_design_engine_freezing_protocol, docs_plans_2026_07_10_frontend_mobile_verification_gate_frontend_gate_phase [EXTRACTED 1.00]
- **component-diagram validator failure-mode fixture suite** — plugins_lirbox_skills_component_diagram_evals_fixtures_clean_clean_fixture, plugins_lirbox_skills_component_diagram_evals_fixtures_diamond_diamond_fixture, plugins_lirbox_skills_component_diagram_evals_fixtures_exotic_shape_rejected_exotic_shape_fixture, plugins_lirbox_skills_component_diagram_evals_fixtures_no_subgraph_no_subgraph_fixture, plugins_lirbox_skills_component_diagram_evals_fixtures_orphan_node_orphan_node_fixture, plugins_lirbox_skills_component_diagram_evals_fixtures_raw_paren_raw_paren_fixture, plugins_lirbox_skills_component_diagram_evals_fixtures_steps_orphan_key_steps_orphan_key_fixture, plugins_lirbox_skills_component_diagram_evals_fixtures_untyped_edge_untyped_edge_fixture, plugins_lirbox_skills_component_diagram_skill_validator_gate [INFERRED 0.95]
- **The verified-mastery tutoring loop (assess → teach → quiz → gate → advance)** — plugins_lirbox_skills_deep_understanding_skill, plugins_lirbox_skills_deep_understanding_assets_understanding_checklist, plugins_lirbox_skills_deep_understanding_references_teaching_playbook, plugins_lirbox_skills_deep_understanding_references_teaching_playbook_gauging_mastery, plugins_lirbox_skills_deep_understanding_skill_incremental_gates, plugins_lirbox_skills_deep_understanding_skill_askuserquestion [EXTRACTED 1.00]
- **Whetstone eval contract (floor GREEN on baseline + acceptance-checks RED on baseline) shared by feedback, flowchart and plan-check** — plugins_lirbox_skills_feedback_evals_readme, plugins_lirbox_skills_flowchart_evals_readme, plugins_lirbox_skills_plan_check_evals_readme, plugins_lirbox_skills_feedback_evals_readme_floor, plugins_lirbox_skills_flowchart_evals_readme_discrimination_gate, plugins_lirbox_skills_feedback_skill_backlog_record [INFERRED 0.95]
- **Mermaid label-escaping rules, validator gate, and its train/val fixture suite** — plugins_lirbox_skills_flowchart_skill_validate_gate, plugins_lirbox_skills_flowchart_references_components_escaping_labels, plugins_lirbox_skills_flowchart_evals_fixtures_clean, plugins_lirbox_skills_flowchart_evals_fixtures_edge_nonascii, plugins_lirbox_skills_flowchart_evals_fixtures_node_nonascii, plugins_lirbox_skills_flowchart_evals_fixtures_edge_dashlabel_nonascii, plugins_lirbox_skills_flowchart_evals_fixtures_round_node_special, plugins_lirbox_skills_flowchart_evals_fixtures_train_literal_newline, plugins_lirbox_skills_flowchart_evals_fixtures_train_node_paren, plugins_lirbox_skills_flowchart_evals_fixtures_val_edge_dashlabel, plugins_lirbox_skills_flowchart_evals_fixtures_val_html_entity, plugins_lirbox_skills_flowchart_evals_fixtures_val_round_node [EXTRACTED 1.00]
- **plan-check claim adjudication vocabulary (VERIFIED / UNVERIFIED / UNSTATED-ASSUMPTION / REFUTED / BLIND-SPOT-RISK)** — plugins_lirbox_skills_plan_check_references_interrogation_adjudication_table, plugins_lirbox_skills_plan_check_references_interrogation_unverified, plugins_lirbox_skills_plan_check_references_interrogation_unstated_assumption, plugins_lirbox_skills_plan_check_references_blind_spot_blind_spot_risk, plugins_lirbox_skills_plan_check_evals_fixtures_clean_verdict_contract [INFERRED 0.95]
- **plan-deck report-contract fixture matrix (one clean page + one fixture per break)** — plugins_lirbox_skills_plan_deck_evals_fixtures_clean_fixture, plugins_lirbox_skills_plan_deck_evals_fixtures_badge_gap_fixture, plugins_lirbox_skills_plan_deck_evals_fixtures_toc_order_mismatch_fixture, plugins_lirbox_skills_plan_deck_evals_fixtures_two_title_fixture, plugins_lirbox_skills_plan_deck_evals_fixtures_placeholder_left_fixture, plugins_lirbox_skills_plan_deck_evals_fixtures_decisions_not_first_fixture, plugins_lirbox_skills_plan_deck_evals_readme_floor [EXTRACTED 1.00]
- **Sequence-diagram validator failure-mode fixture suite** — plugins_lirbox_skills_sequence_diagram_skill_validator_gate, plugins_lirbox_skills_sequence_diagram_evals_fixtures_clean, plugins_lirbox_skills_sequence_diagram_evals_fixtures_kind_arrow_mismatch, plugins_lirbox_skills_sequence_diagram_evals_fixtures_literal_newline, plugins_lirbox_skills_sequence_diagram_evals_fixtures_no_autonumber, plugins_lirbox_skills_sequence_diagram_evals_fixtures_parity, plugins_lirbox_skills_sequence_diagram_evals_fixtures_raw_hash, plugins_lirbox_skills_sequence_diagram_evals_fixtures_steplist_missing_fromto, plugins_lirbox_skills_sequence_diagram_evals_fixtures_steplist_missing_kind, plugins_lirbox_skills_sequence_diagram_evals_fixtures_unbalanced_activation [INFERRED 0.95]

## Communities (179 total, 48 thin omitted)

### Community 0 - "board.mjs"
Cohesion: 0.31
Nodes (10): args, die(), done(), load(), parseArgs(), parseCriterion(), print(), set() (+2 more)

### Community 1 - "board-selfcheck.mjs"
Cohesion: 0.18
Nodes (5): argv, ASSERTIONS, HERE, MUTATIONS, REAL_BOARD

### Community 2 - "validate.mjs headless gate"
Cohesion: 0.06
Nodes (43): LikeC4 DSL, model block (elements + typed relationships), LikeC4 pitfalls (undeclared kinds, empty views), specification block (element kinds), views block (drill-down predicates), c4-model skill, likec4.sh throwaway docker toolchain, C4 quality bar (hierarchy earns its place) (+35 more)

### Community 3 - "whetstone skill"
Cohesion: 0.27
Nodes (10): Orchestration / loop skill family, Orphan tasks idle outside the suite, Train/val split over the task suite, Problem: conductor executes a fixed linear phase list, Four generators, 2,895 lines, zero shared code, loom — a graph runtime for lirbox orchestration skills, loom skill, prospector skill (+2 more)

### Community 4 - "Evidence manifest (frontend-evidence/manifest.json)"
Cohesion: 0.22
Nodes (8): FrontendGate phase (generator integration via whetstone), Shared output contract + evidence manifest, Deterministic lint only (no LLM judge, no new phase), implementation-notes/ fragments as the richest source, lirbox-docs-writer agent, Evidence manifest (frontend-evidence/manifest.json), Method, Output contract

### Community 5 - "step-list / autonumber numbering drift (sequence-diagram defect)"
Cohesion: 0.16
Nodes (14): Mermaid sequenceDiagram autonumber, session-notes.md (unredacted developer working notes fixture), planted secret material (tokens, AWS key, internal host/URL, email), requested fix: generate step list from one source, or fail validation on count mismatch, step-list / autonumber numbering drift (sequence-diagram defect), machine-readable record block (required issue-body format), scrub secrets but preserve the technical complaint, scrub-and-shape harbor task (+6 more)

### Community 6 - "component-diagram/assets/validate.mjs"
Cohesion: 0.33
Nodes (8): checkLabel(), ENTITY, files, isStructural(), mermaidBlocks(), spans(), SPECIALS, validateFile()

### Community 7 - "do/evals/floor/00-structure.test.mjs"
Cohesion: 0.29
Nodes (6): desc, fm, here, machine, name, skill

### Community 8 - "inline-no-permission-ask.check.mjs"
Cohesion: 0.33
Nodes (4): failures, here, section, text

### Community 9 - "reject-not-softened.check.mjs"
Cohesion: 0.40
Nodes (5): fail(), failures, here, need(), text

### Community 10 - "intake-selfcheck.mjs"
Cohesion: 0.09
Nodes (20): band(), CHEAPEST, confidenceOf(), decideRoute(), HERE, HIGH, main(), MEDIUM (+12 more)

### Community 11 - "analyze.cjs"
Cohesion: 0.12
Nodes (23): nets job — generator regression nets, Two-job split (fast gate vs slow nets), analyzeSkill(), discover(), fs, longProseRatio(), main(), path (+15 more)

### Community 13 - "SWE-bench-style grading (rung 1, hidden F2P/P2P)"
Cohesion: 0.40
Nodes (5): Forfeit rule (non-engagement, timeout, unresolved), SWE-bench-style grading (rung 1, hidden F2P/P2P), Conductor delivers on a wf/ branch, Invariant: graders stay hidden from the agent, Forfeited cells (sonnet bypassed conductor)

### Community 14 - "arena skill"
Cohesion: 0.40
Nodes (5): Null control: benchmark the same config twice, Quality beyond correctness stays pairwise, Null-skill control as the admissibility fork, The matrix is always paired — report the lift, never the raw score, arena skill

### Community 15 - "fallback-is-announced.check.mjs"
Cohesion: 0.40
Nodes (3): failures, here, text

### Community 16 - "lane-always-asks.check.mjs"
Cohesion: 0.40
Nodes (3): failures, here, text

### Community 17 - "conductor skill"
Cohesion: 0.22
Nodes (11): Delivery-artifact promotion exception, Runtime artifacts are gitignored, At-least-once execution requires idempotent nodes, Resume must restore structure, not just progress, conductor skill, lirbox-code-reviewer agent, lirbox-docs-writer agent, lirbox-mobile-verifier agent (+3 more)

### Community 18 - "no-interrogation-path.check.mjs"
Cohesion: 0.40
Nodes (3): failures, here, text

### Community 19 - "do/SKILL.md"
Cohesion: 0.40
Nodes (4): inline, lane, reject, scope

### Community 20 - "Conductor scoreboard (absolute SWE-style scores)"
Cohesion: 0.15
Nodes (17): Pin [judge].model, Engagement discipline as the discriminating dimension, Conductor scoreboard (absolute SWE-style scores), † engagement assumed, not measured, Read the Engaged column before the headline, Minimum detectable effect ~20pp, No usable cross-model engagement comparison exists, Suite-hash comparability contract (+9 more)

### Community 21 - "content-verification (conductor whetstone item)"
Cohesion: 0.50
Nodes (4): content-verification (conductor whetstone item), Worktree-local prose-lint copy (resume-proof path resolution), Append to criteria[], not a dod.json block (inert without a phase), prose-lint.mjs (zero-dep deterministic markdown check)

### Community 22 - "do/evals/run.mjs"
Cohesion: 0.50
Nodes (3): floorDir, here, tests

### Community 37 - "evals-all.mjs"
Cohesion: 0.13
Nodes (10): argv, failures, FAST, HERE, LIST, ONLY, promotes, ran (+2 more)

### Community 44 - "e2b capability-floor finding (Task 0)"
Cohesion: 0.18
Nodes (13): Never inject plugins/lirbox/skills into a container, CLAUDE_CODE_AUTO_COMPACT_WINDOW override for third-party endpoints, Measured context budget floor (16K impossible, 32K marginal), cost_usd is a LiteLLM estimate, fictional on a local endpoint, --ak disallowed_tools trims tool-schema tokens, A 0 is a finding: engagement failure vs quality failure, .harbor/ staging layout is gitignored on purpose, Harbor task declaration is the tracked source of truth (+5 more)

### Community 49 - "config-refuses-unusable.check.mjs"
Cohesion: 0.11
Nodes (12): cfg, cfg2, cfgPath, excluded, here, home, home2, initValidate (+4 more)

### Community 50 - "mechanical-refutation/tests/skill-assets/validate.mjs"
Cohesion: 0.12
Nodes (14): dodBlocks, errors, fullRows, goalEl, goalRows, markup, OPEN, ph (+6 more)

### Community 52 - "Conductor layer is restricted pure JS"
Cohesion: 0.06
Nodes (43): Conductor layer is restricted pure JS, Generator regression net (test-*.cjs), HTML-artifact skill family, Never hand-edit a generated loop script, Grader validator copies go stale silently, An artifact skill's floor should run its own headless validator, A failed judge must omit its key, not write 0, Watch the grader's incentive, not just its pass rate (+35 more)

### Community 56 - "Improvement-loop consolidation — replacement status"
Cohesion: 0.05
Nodes (38): Also found: a documented integration that does not exist, Decided — three workstreams, Evidence — what has actually been run, External landscape — what you could stop maintaining, Harbor's own scope, confirmed, Improvement-loop consolidation — replacement status, M0 — Layer map: what is even comparable, M1 — Layer 1: `swe-run.mjs` vs `harbor run` *(the real overlap)* (+30 more)

### Community 57 - "Absolute scoring (swe-run scorecard)"
Cohesion: 0.20
Nodes (10): Raw vs conductor comparison matrix, Absolute scoring (swe-run scorecard), lirbox:arena skill (pairwise durable loop), Frozen fixture suite (suite.json + tasks/), Suite fingerprint = comparability contract, Size the task so conductor engages, Invariant: model IDs pinned, never aliases, Two scoring layers (absolute vs pairwise) (+2 more)

### Community 60 - "Flowchart Model-Ladder Lift plan (NOT PURSUED)"
Cohesion: 0.18
Nodes (13): Non-destructive default: PR, never auto-merge, Per-run timestamped branches keyed by run slug, Three-tier skill shipping gate, Enforced personal commit identity (.githooks/pre-commit), Discrimination gate: run -a nop alongside -a oracle, main is pull-request-only ruleset, Tier 1 — validate + smoke-test + skill-lint, Tier 2 — evals (the real release gate) (+5 more)

### Community 67 - "triage.mjs"
Cohesion: 0.16
Nodes (12): areas, argv, classify(), dispatchDir, flags, hasCommand(), hasExpectation(), itemsPath (+4 more)

### Community 68 - "jev-selfcheck.mjs"
Cohesion: 0.15
Nodes (8): FIXTURES, HERE, JEV, QUESTIONS, results, server, STATE, tmp

### Community 70 - "plan-check/assets/validate.mjs"
Cohesion: 0.12
Nodes (15): dodBlocks, errors, fullRows, goalEl, goalRows, markup, NEEDS_FIX_TAG, OPEN (+7 more)

### Community 71 - "plan-deck whetstone floor (characterization, green on baseline)"
Cohesion: 0.06
Nodes (40): Embedded definition-of-done JSON block (script#dod), plan-check clean fixture (well-formed report), plan-check report verdict contract (data-verdict / claim rows / conditions), plan-check conditions-mismatch fixture (open row, zero conditions), plan-check full-template-render fixture, plan-check placeholder-left fixture (unfilled {{VERDICT_SUMMARY}}), plan-check refuted-but-go fixture (REFUTED row without NO-GO), Blind-spot pass (hunting unknown unknowns) (+32 more)

### Community 76 - "notes-wide-features task (8 independent plugins)"
Cohesion: 0.40
Nodes (5): Conductor's cost is its bookends (planning + gates), notes-wide-features task (8 independent plugins), First clean parallel conductor cell (notes-wide-features), lirbox-code-reviewer agent, Review-and-fix in one pass (Critical/High must be resolved)

### Community 77 - "frontend-gate-phase (conductor whetstone item)"
Cohesion: 0.27
Nodes (10): frontend-gate-phase (conductor whetstone item), Deliberate omission of tools: on the web verifier, Web verifier dogfood (behavioral proof), Approach B — two sibling verifier agents, Engine freezing protocol (probe once, freeze into dod.json), Writeup promotion gap (HTML-only, evidence never rides the PR), Mobile engine chain: maestro → appium → raw, lirbox-mobile-verifier agent (+2 more)

### Community 88 - "validate.mjs headless gate"
Cohesion: 0.08
Nodes (30): feedback evals README, feedback acceptance-checks (RED on baseline), feedback SKILL, Whetstone backlog record (JSON), scrub.cjs deterministic redactor, Semantic redaction pass, subjective feedback type (human-only), flowchart HTML template (+22 more)

### Community 89 - "evidence.mjs"
Cohesion: 0.20
Nodes (10): argv, branch, common, die(), evid, flags, mainRepo, many (+2 more)

### Community 90 - "code-copy-button.test.mjs"
Cohesion: 0.20
Nodes (9): cssRemote, externalRefs, externalScript, HERE, html, remoteUrl, scripts, TEMPLATE (+1 more)

### Community 91 - "conditions-flex-broken.test.mjs"
Cohesion: 0.20
Nodes (6): HERE, noComments, placeholderPos, styleMatch, TEMPLATE, VOID

### Community 92 - "dod-block-contract.test.mjs"
Cohesion: 0.20
Nodes (5): CASES, dir, HERE, SKILL_DIR, VALIDATE

### Community 97 - "jev.mjs"
Cohesion: 0.14
Nodes (20): apiToken(), askJev(), assertBudget(), assertQuestions(), CAP_STATE_PLUS_QUESTION_TOKENS, CAP_TOTAL_TOKENS, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS (+12 more)

### Community 98 - "component-diagram/evals/checks/pan-zoom-fullscreen.check.mjs"
Cohesion: 0.22
Nodes (8): forbidden, html, missing, present, IMPORTANT: comments are STRIPPED before the anti-pattern (forbidden) tests run,…, required, ROOT, TEMPLATE

### Community 113 - "flowchart/assets/validate.mjs"
Cohesion: 0.33
Nodes (8): checkLabel(), ENTITY, files, isStructural(), mermaidBlocks(), spans(), SPECIALS, validateFile()

### Community 114 - "flowchart/evals/checks/pan-zoom-fullscreen.check.mjs"
Cohesion: 0.22
Nodes (8): forbidden, html, missing, present, IMPORTANT: comments are STRIPPED before the anti-pattern (forbidden) tests run,…, required, ROOT, TEMPLATE

### Community 116 - "agent-name-checked.check.mjs"
Cohesion: 0.22
Nodes (3): excluded, here, realPath

### Community 117 - "dod-template-and-audit.test.mjs"
Cohesion: 0.22
Nodes (7): BLIND_SPOT, externals, HERE, offenders, SKILL, SKILL_DIR, TEMPLATE

### Community 118 - "plan-deck/assets/validate.mjs"
Cohesion: 0.22
Nodes (8): badges, errors, expected, ids, idSet, ph, toc, tocSet

### Community 119 - "STEPLIST — numbered list as the interactive surface"
Cohesion: 0.09
Nodes (24): sequence-diagram HTML template, Fullscreen detail popup mirror, renderSteps, selectStep, Fixture: clean (PASS baseline), Fixture: STEPLIST kind disagrees with the arrow, Fixture: literal \n in message text, Fixture: missing autonumber (+16 more)

### Community 120 - "initPanZoom"
Cohesion: 0.39
Nodes (9): applyPan, applyZoom, clamp, Crisp zoom by SVG width, translate-only pan layer, fitToWidth, initPanZoom, resetZoom, setZoom (+1 more)

### Community 121 - "sequence-diagram/evals/checks/pan-zoom-fullscreen.check.mjs"
Cohesion: 0.22
Nodes (8): forbidden, html, missing, present, IMPORTANT: comments are STRIPPED before the anti-pattern (forbidden) tests run,…, required, ROOT, TEMPLATE

### Community 122 - "Per-concern acceptance check (RED on baseline)"
Cohesion: 0.33
Nodes (6): Per-concern acceptance check (RED on baseline), Litmus test — can you write a command that exits non-zero?, Tests must fail for the RIGHT reason (RED step), lirbox-test-writer agent, Engineering-perspective gaps derived from the diff, lirbox-tryve-enhancer agent

### Community 123 - "01-scripts-contract.test.mjs"
Cohesion: 0.25
Nodes (7): cfg, here, initBlock, lane, root, skill, table

### Community 130 - "Understanding checklist template"
Cohesion: 0.07
Nodes (32): Understanding checklist template, Stage 1 — The problem, Stage 2 — The solution, Stage 3 — The broader context, Teaching playbook, The ELI ladder (ELI5 / ELI14 / ELII), Gauging mastery, Quizzing with AskUserQuestion (+24 more)

### Community 132 - "ledger.go"
Cohesion: 0.52
Nodes (6): Entry, Store, Append(), Compact(), Context, Time

### Community 133 - "lirbox-builder.md"
Cohesion: 0.29
Nodes (6): Before you write anything, Deletions, If the brief is wrong, Red means stop, Reporting, The frame

### Community 152 - "feedback/evals/floor/00-structure.test.mjs"
Cohesion: 0.29
Nodes (5): dir, HERE, nameMatch, NOTE: this is a THIN floor. Add >=1 behavior characterization test alongside it…, SKILL_DIR

### Community 153 - "flowchart/evals/floor/00-structure.test.mjs"
Cohesion: 0.29
Nodes (5): dir, HERE, nameMatch, NOTE: this is a THIN floor. Add >=1 behavior characterization test alongside it…, SKILL_DIR

### Community 155 - "lane-config/evals/floor/00-structure.test.mjs"
Cohesion: 0.29
Nodes (6): desc, fm, here, machine, name, skill

### Community 156 - "Grader fairness law (assert only what task.md states)"
Cohesion: 0.33
Nodes (6): Grader fairness law (assert only what task.md states), Measurement posture (what the benchmark honestly measures), Discrimination gate (check must be RED on baseline), Validation gating (accept iff held-out val improves), Anchor resolution moved to opt-in (renderer-dependent slugging), Filtering principle — a failure must be a real defect regardless of content

### Community 157 - "lirbox-verifier.md"
Cohesion: 0.33
Nodes (5): Hard rules, Prove the check can fail, Timing-dependent results, Tooling failure is not app failure, Verdict

### Community 162 - "skill-lint/evals/floor/00-structure.test.mjs"
Cohesion: 0.29
Nodes (5): dir, HERE, nameMatch, NOTE: this is a THIN floor. Add >=1 behavior characterization test alongside it…, SKILL_DIR

### Community 166 - "uglify-corner-cases task (xxhard real-repo tier)"
Cohesion: 0.33
Nodes (6): uglify-corner-cases task (xxhard real-repo tier), Width × expensive: the only 'raw fails, conductor wins' shape, Difficulty ladder (easy → xxhard), Real-repo tier (SWE-bench Pro recipe), headless-background-workflow-orphan (filed defect), independent-work-needs-per-worker-worktrees (filed defect)

### Community 168 - "Microsoft SkillOpt (skill file as trainable parameter)"
Cohesion: 0.08
Nodes (26): checks job — floors + frozen checks (fast gate), Repo-wide regression gate (evals workflow), agent-file-surface (whetstone backlog item), in-progress / needs-human labels as the lock, Nightly issue-implementer routine, Routine safety model (own issues only, eval-gated push), consolidate: true (compaction pass), Worked example — flowchart run (train 60→100, val 50→100) (+18 more)

### Community 171 - "exotic-shape-rejected.check.mjs"
Cohesion: 0.33
Nodes (4): FIXTURE, ROOT, { status, out }, VALIDATE

### Community 172 - "orphan-node.check.mjs"
Cohesion: 0.33
Nodes (4): FIXTURE, ROOT, { status, out }, VALIDATE

### Community 173 - "steps-orphan-key.check.mjs"
Cohesion: 0.33
Nodes (4): FIXTURE, ROOT, { status, out }, VALIDATE

### Community 174 - "untyped-edge.check.mjs"
Cohesion: 0.33
Nodes (4): FIXTURE, ROOT, { status, out }, VALIDATE

### Community 175 - "component-diagram/evals/floor/structure.test.mjs"
Cohesion: 0.40
Nodes (4): FIX(), HERE, VALIDATE, validateExit()

### Community 179 - "loom: runtime proof of the gate-failure back-edge"
Cohesion: 0.15
Nodes (12): Backlog outcome, loom: runtime proof of the gate-failure back-edge, Reproduce, Result: PROVEN, Still unproven, Two honest caveats, What `DoDGate` verified, What `Implement#1` produced (+4 more)

### Community 182 - "execution-shape.check.mjs"
Cohesion: 0.22
Nodes (6): assertions, blind, bullets, failed, ROOT, skill

### Community 184 - "01-scrub.test.mjs"
Cohesion: 0.33
Nodes (4): dirty, HERE, SCRUB, SKILL_DIR

### Community 186 - "node-nonascii.check.mjs"
Cohesion: 0.33
Nodes (4): exit, FIXTURE, HERE, VALIDATE

### Community 187 - "edge-nonascii.test.mjs"
Cohesion: 0.40
Nodes (4): FIX(), HERE, VALIDATE, validateExit()

### Community 188 - "orch-lane.sh"
Cohesion: 0.47
Nodes (3): refuse(), resolve_profile(), orch-lane.sh script

### Community 192 - "plan-check/evals/floor/structure.test.mjs"
Cohesion: 0.40
Nodes (4): FIX(), HERE, VALIDATE, validateExit()

### Community 193 - "validate-counts-css-verdict.test.mjs"
Cohesion: 0.33
Nodes (4): FIXTURE, HERE, SKILL_DIR, VALIDATE

### Community 194 - "plan-deck/evals/floor/structure.test.mjs"
Cohesion: 0.40
Nodes (4): FIX(), HERE, VALIDATE, validateExit()

### Community 197 - "sequence-diagram/assets/validate.mjs"
Cohesion: 0.53
Nodes (5): arrowKind(), files, mermaidBlocks(), steplistEntries(), validateFile()

### Community 198 - "kind-arrow-mismatch.check.mjs"
Cohesion: 0.33
Nodes (4): { code, out }, FIXTURE, ROOT, VALIDATOR

### Community 199 - "retry-backoff-guidance.check.mjs"
Cohesion: 0.33
Nodes (5): DOC, hasBackoff, hasExit, hasRetry, ROOT

### Community 200 - "steplist-missing-fromto.check.mjs"
Cohesion: 0.33
Nodes (4): { code, out }, FIXTURE, ROOT, VALIDATOR

### Community 201 - "steplist-missing-kind.check.mjs"
Cohesion: 0.33
Nodes (4): { code, out }, FIXTURE, ROOT, VALIDATOR

### Community 202 - "unbalanced-activation.check.mjs"
Cohesion: 0.33
Nodes (4): { code, out }, FIXTURE, ROOT, VALIDATOR

### Community 203 - "sequence-diagram/evals/floor/structure.test.mjs"
Cohesion: 0.40
Nodes (4): FIX(), HERE, VALIDATE, validateExit()

### Community 206 - "autofix-bounded.check.mjs"
Cohesion: 0.25
Nodes (7): assertions, autofix, blocks(), failed, ROOT, skill, someBlock()

### Community 207 - "lirbox-planner.md"
Cohesion: 0.29
Nodes (6): One slice. Not a decomposition., Re-invocation: plan from what happened, not from what you said, Read the code first, The criteria, The slice has to be independently shippable and independently testable, What you owe the orchestrator

### Community 208 - "external-system-guidance.check.mjs"
Cohesion: 0.40
Nodes (4): DOC, hasConvention, mentionsExternal, ROOT

### Community 215 - "harbor-prep.mjs"
Cohesion: 0.25
Nodes (7): all, argv, isBundle(), PRUNE, prunedCopy(), REPO, SKILLS

### Community 217 - "plan-deck honesty rules"
Cohesion: 0.40
Nodes (5): plan-deck honesty rules, plan-deck honesty pass (delete rather than fabricate), Verbose-mode before/after snippet pattern, Code density mode (lean default vs verbose), Narrative, not diff

### Community 223 - "Ledger Compaction — Implementation Plan"
Cohesion: 0.40
Nodes (4): Definition of done, Ledger Compaction — Implementation Plan, Task 1: Implement compaction, Task 2: Schedule the compaction job

### Community 225 - "lirbox plugin marketplace"
Cohesion: 0.50
Nodes (4): lirbox plugin marketplace, Marketplace / plugin layout rules, lirbox (Claude Code plugin marketplace), skill-train recipe (prospector on a skill's pass-rate)

### Community 226 - "Methodological finding — odd passes turn position bias into a fake winner"
Cohesion: 0.67
Nodes (4): EVEN judge pass count (position balance), Judge position bias (proven live, 6/6 shown-B), Leaderboard page — swe-graded-effort-high-vs-med, Methodological finding — odd passes turn position bias into a fake winner

### Community 235 - "selectNode"
Cohesion: 0.50
Nodes (4): DEFAULT_NODE, selectNode(), STEPS map, click <nodeId> selectNode wiring

### Community 236 - "01-node-paren-flagged.test.mjs"
Cohesion: 0.50
Nodes (3): FIXTURE, HERE, VALIDATE

### Community 237 - "02-clean-passes.test.mjs"
Cohesion: 0.50
Nodes (3): FIXTURE, HERE, VALIDATE

### Community 238 - "train/03-edge-dashlabel-nonascii.test.mjs"
Cohesion: 0.50
Nodes (3): FIXTURE, HERE, VALIDATE

### Community 239 - "train/04-round-node-special.test.mjs"
Cohesion: 0.50
Nodes (3): FIXTURE, HERE, VALIDATE

### Community 240 - "05-literal-newline-flagged.test.mjs"
Cohesion: 0.50
Nodes (3): FIXTURE, HERE, VALIDATE

### Community 241 - "01-clean-passes.test.mjs"
Cohesion: 0.50
Nodes (3): FIXTURE, HERE, VALIDATE

### Community 242 - "02-html-entity-flagged.test.mjs"
Cohesion: 0.50
Nodes (3): FIXTURE, HERE, VALIDATE

### Community 243 - "val/03-edge-dashlabel-nonascii.test.mjs"
Cohesion: 0.50
Nodes (3): FIXTURE, HERE, VALIDATE

### Community 244 - "val/04-round-node-special.test.mjs"
Cohesion: 0.50
Nodes (3): FIXTURE, HERE, VALIDATE

### Community 245 - "lane-config/evals/run.mjs"
Cohesion: 0.50
Nodes (3): floorDir, here, tests

### Community 250 - "Raw-tier honesty (specsWritten MUST be 0, evidence-only flags)"
Cohesion: 0.67
Nodes (3): Mobile honest-failure smoke (no stack detected), Tooling failure ≠ app failure, Raw-tier honesty (specsWritten MUST be 0, evidence-only flags)

### Community 255 - "Pinned Mermaid script with SRI integrity"
Cohesion: 0.67
Nodes (3): Pinned Mermaid script with SRI integrity, SRI hash recompute procedure, CDN/offline caveat (Mermaid from jsDelivr)

### Community 267 - "autofix-bounded/tests/skill-assets/validate.mjs"
Cohesion: 0.18
Nodes (9): dodBlocks, errors, markup, OPEN, ph, QUADRANTS, rows, STATUSES (+1 more)

### Community 280 - "Skill title"
Cohesion: 0.22
Nodes (8): 1. <first step>, 2. <next step>, 3. Verify before claiming done, Inputs, Quality bar, Skill title, When to use, Workflow

### Community 314 - "Conductor — failure triage on resume"
Cohesion: 0.14
Nodes (13): 1 · Failure record — written by the run, not by whoever is watching, 2 · Gather protocol — ordered, stop as soon as it is answered, 3 · Resume triage — `scripts/triage.cjs`, not prose, 4 · Hint channel — without this, the rest is theatre, 5 · Write-back — the only thing that makes the knowledge base grow, Conductor — failure triage on resume, Design, Files touched (+5 more)

### Community 315 - "prove-checks.mjs"
Cohesion: 0.22
Nodes (7): argv, MANIFEST, REPO, SKILL, SKILL_DIR, STRICT, unproven

### Community 321 - "Progressive disclosure — relocate meaning into references/, never delete"
Cohesion: 0.67
Nodes (3): book check (word budget + long-prose ratio), flow check (oversized inline diagrams / references), Progressive disclosure — relocate meaning into references/, never delete

### Community 325 - "fix-disposition.check.mjs"
Cohesion: 0.17
Nodes (7): assertions, failed, ROOT, skill, steps, template, TMP

### Community 326 - "task-graph.check.mjs"
Cohesion: 0.12
Nodes (14): assertions, blind, CONTENTION_PARALLEL, failed, INVENTED_SERIAL, OVERCLAIMED_PARALLEL, PARALLEL, report() (+6 more)

### Community 327 - "Autofix — repairing the plan without laundering it"
Cohesion: 0.40
Nodes (4): Autofix — repairing the plan without laundering it, NO-GO is cleared by re-verification, never by the edit, What is mechanical (autofixable), What needs a decision (never autofixed)

### Community 328 - "execution-shape/tests/skill-assets/validate-legacy.mjs"
Cohesion: 0.18
Nodes (9): dodBlocks, errors, markup, OPEN, ph, QUADRANTS, rows, STATUSES (+1 more)

### Community 329 - "Schedule Run Hang Fix — Implementation Plan"
Cohesion: 0.29
Nodes (6): Definition of done, Schedule Run Hang Fix — Implementation Plan, Task 1: Migration — add the run-error column, Task 2: Bookkeeping survives job-context cancellation, Task 3: The run records its own failure reason, Task 4: Expose the run error on the API

### Community 330 - "Schedule Run Bookkeeping — Implementation Plan"
Cohesion: 0.40
Nodes (4): Definition of done, Schedule Run Bookkeeping — Implementation Plan, Task 1: Detach the bookkeeping writes, Task 2: Resolve targets before claiming the occurrence

### Community 331 - ".Resolve"
Cohesion: 0.50
Nodes (3): Context, Resolver, Target

### Community 332 - ".Run"
Cohesion: 0.50
Nodes (3): Context, RunScheduleArgs, Worker

### Community 341 - "goal-coverage.check.mjs"
Cohesion: 0.15
Nodes (10): assertions, blocks(), D, failed, ROOT, skill, someBlock(), TMP (+2 more)

### Community 342 - "goal-coverage/tests/skill-assets/validate.mjs"
Cohesion: 0.15
Nodes (11): dodBlocks, errors, goalEl, goalRows, markup, OPEN, ph, QUADRANTS (+3 more)

### Community 343 - "validate-legacy.mjs"
Cohesion: 0.18
Nodes (9): dodBlocks, errors, markup, OPEN, ph, QUADRANTS, rows, STATUSES (+1 more)

### Community 345 - "Checkout Latency — Implementation Plan"
Cohesion: 0.40
Nodes (4): Checkout Latency — Implementation Plan, Definition of done, Task 1: Cache the tax-rate lookup, Task 2: Batch the inventory reservation calls

## Ambiguous Edges - Review These
- `First clean parallel conductor cell (notes-wide-features)` → `Review-and-fix in one pass (Critical/High must be resolved)`  [AMBIGUOUS]
  plugins/lirbox/agents/lirbox-code-reviewer.md · relation: conceptually_related_to
- `.harbor/ staging layout is gitignored on purpose` → `.harbor/tasks drift gate`  [AMBIGUOUS]
  docs/plans/2026-07-28-flowchart-model-ladder-lift.md · relation: conceptually_related_to

## Knowledge Gaps
- **646 isolated node(s):** `HERE`, `argv`, `REAL_BOARD`, `ASSERTIONS`, `MUTATIONS` (+641 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **48 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `First clean parallel conductor cell (notes-wide-features)` and `Review-and-fix in one pass (Critical/High must be resolved)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `.harbor/ staging layout is gitignored on purpose` and `.harbor/tasks drift gate`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Read the Engaged column before the headline` connect `Conductor scoreboard (absolute SWE-style scores)` to `e2b capability-floor finding (Task 0)`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `Forfeit rule (non-engagement, timeout, unresolved)` connect `SWE-bench-style grading (rung 1, hidden F2P/P2P)` to `Absolute scoring (swe-run scorecard)`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `Engagement discipline as the discriminating dimension` connect `Conductor scoreboard (absolute SWE-style scores)` to `SWE-bench-style grading (rung 1, hidden F2P/P2P)`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `HERE`, `argv`, `REAL_BOARD` to the rest of the system?**
  _646 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `validate.mjs headless gate` be split into smaller, more focused modules?**
  _Cohesion score 0.05647840531561462 - nodes in this community are weakly interconnected._
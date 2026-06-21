---
name: skill-template
description: This skill should be used when … (describe the trigger concretely — what the user asks for, which file types or tasks, and what outcome they want). Write in the third person. The model reads ONLY this name + description to decide whether to invoke the skill, so be specific about WHEN to use it, not just what it does.
---

# Skill title

One or two sentences on the purpose: what this skill produces and why it exists.

## When to use

- The concrete situations that should trigger this skill.
- What this skill is NOT for (so it doesn't fire on adjacent tasks).

## Inputs

- The information the skill needs from the user. State sensible defaults and what to ask for if missing.

## Workflow

### 1. <first step>
Imperative instructions. Reference bundled resources by relative path, e.g.
run `${CLAUDE_PLUGIN_ROOT}/skills/skill-template/scripts/do_thing.sh`.

### 2. <next step>
…

### 3. Verify before claiming done
Spell out the checks that prove the output is correct. Evidence before assertions.

## Quality bar

- The non-negotiables that make output good.

<!--
Bundled resources (delete the dirs you don't use):
  scripts/     executable code; deterministic, token-efficient, runnable without loading into context
  references/  docs loaded on demand to keep this file lean (link them from the steps above)
  assets/      templates/images/fonts used in the skill's OUTPUT (not loaded into context)
-->

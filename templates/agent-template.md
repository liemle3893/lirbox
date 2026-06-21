---
name: agent-template
description: Use this agent when … (be specific about the situations that should dispatch it, the inputs it expects, and the result it returns). The orchestrator reads this to decide when to hand work to the agent.
model: sonnet
tools:
  - Read
  - Grep
  - Glob
  - Bash
---

You are a <role> agent. Your single job is to <one clear responsibility>.

## Method

1. <how you approach the task, step by step>
2. <what to gather, what to verify>
3. <how to handle ambiguity — make a call and note it, or stop and report>

## Output contract

Return <exactly what the caller expects>. For example:
- A short status line, OR
- A structured result with these fields: …

Keep findings grounded in evidence (file:line, command output). Do not fabricate.
Stay within your role — do not expand scope beyond <responsibility>.

"""Deterministic checks on the file conductor GENERATED. The workflow is never executed.

This directory is named `reward`, so its aggregate becomes the `reward` key Harbor scores the task
on. That is deliberate: it is the only dimension allowed to gate, because the whetstone loop keeps
or reverts a fix on that scalar and a stochastic input would make the decision a coin flip. The
semantic judge lives in ../quality/ and lands under its own key.

KNOWN LIMIT, measured 2026-07-30: these prove the emitted file is WELL-FORMED, not GOOD. A scaffold
with one phase named "Work", a prompt of the literal string "x", and no DoD passes all six. Closing
that is ../quality/'s job.
"""

import re
import subprocess
from pathlib import Path

from rewardkit import criterion


def _workflow(workspace: Path):
    """The generated conductor script, or None."""
    matches = sorted((workspace / ".workflows").glob("*.js"))
    return matches[0] if matches else None


def _body(src: str) -> str:
    """The EXECUTING body — the slice from `const NAME` onward.

    The header comment and the meta block name the restricted primitives in prose ("A leftover
    `TODO:` means...", "inside agent() subagents"), so scanning the whole file grades the
    documentation instead of the code. That cost two checks a false red during development.
    """
    i = src.find("const NAME")
    return src[i:] if i >= 0 else ""


META_RE = re.compile(r"export const meta = \{.*?\n\}", re.S)
TITLE_RE = re.compile(r"\{ title: '([^']+)' \}")


@criterion(description="a workflow script was generated under .workflows/")
def output_exists(workspace: Path) -> bool:
    return _workflow(workspace) is not None


@criterion(description="emitted script compiles as an async workflow body")
def parses_as_workflow_body(workspace: Path) -> bool:
    """The runtime wraps the script in an async function (top-level await AND top-level return), so
    compiling it as that function's BODY is what actually parses it.

    CORRECTION to the rationale first written here, measured 2026-07-30 on node v22.21.1: I claimed
    `node --check` "can never pass" a generated conductor. The opposite is true — it ALWAYS passes,
    and passes even when the file is broken. `--check` stops validating after the first ESM
    statement, and every emitted script opens with `export const meta`, so a syntax error injected
    into the executing body sails through; a bare top-level `return 1` passes too. Errors BEFORE the
    first export/import are still caught, which is why it looked like it worked. So this probe is
    needed not because --check fails, but because --check is VACUOUS here."""
    wf = _workflow(workspace)
    if wf is None:
        return False
    script = (
        "const fs=require('fs');"
        "const s=fs.readFileSync(process.argv[1],'utf8')"
        ".replace(/^export const meta/m,'const meta');"
        "const AF=Object.getPrototypeOf(async function(){}).constructor;"
        "new AF('args','log','phase','agent','parallel','pipeline','budget','workflow',s);"
    )
    return subprocess.run(
        ["node", "-e", script, str(wf)], capture_output=True, timeout=60
    ).returncode == 0


@criterion(description="meta block declares name, description and at least one phase")
def has_meta(workspace: Path) -> bool:
    wf = _workflow(workspace)
    if wf is None:
        return False
    m = META_RE.search(wf.read_text())
    if not m:
        return False
    block = m.group(0)
    return bool(
        re.search(r"name:\s*'\S", block)
        and re.search(r"description:\s*'\S", block)
        and TITLE_RE.search(block)
    )


@criterion(description="conductor layer is pure JS (no fs/git/require/Date.now/Math.random)")
def conductor_layer_pure(workspace: Path) -> bool:
    """CLAUDE.md: the conductor layer is "pure JS only". The rule is about what the conductor
    EXECUTES, so every string literal is stripped first — anything inside quotes is data the
    conductor ships to a worker or a shell, never code it runs itself. A genuine violation is
    unquoted (`require(` / `fs.` as code), so it survives the strip and is still caught.

    Stripping only template literals is not enough, and scoring a real run proved it: with a
    --dod-file, the generator inlines the DoD as a JSON blob whose `check` fields are shell
    commands the gate shells out, e.g.

        "check":"node -e \\"const fs=require('fs'); ...\\""

    Those are double- and single-quoted, so a template-literal-only strip left 9 matches and
    failed a correct scaffold. That penalised exactly the behaviour the task wants: the run that
    tripped it (claude-code/sonnet-5, 2026-07-30) earned 5/5 from the judge for a falsifiable DoD
    and lost a deterministic point for the same file. The repo's own scan in
    scripts/test-scaffold.cjs shares this blind spot; its matrix just never feeds it such a DoD.

    ponytail: regex-based, so a regex literal containing a lone quote could still confuse it.
    Upgrade to a real JS tokenizer only if that ever shows up in generator output."""
    wf = _workflow(workspace)
    if wf is None:
        return False
    body = _body(wf.read_text())
    if not body:
        return False
    stripped = body
    for literal in (
        r"`(?:[^`\\]|\\.)*`",
        r'"(?:[^"\\]|\\.)*"',
        r"'(?:[^'\\]|\\.)*'",
    ):
        stripped = re.sub(literal, '""', stripped)
    forbidden = [
        r"\brequire\s*\(",
        r"\bfs\.",
        r"\bDate\.now\s*\(",
        r"\bnew Date\b",
        r"\bMath\.random\s*\(",
    ]
    return not any(re.search(p, stripped) for p in forbidden)


@criterion(description="every phase() call is declared in meta, in the same relative order")
def phase_order_matches_meta(workspace: Path) -> bool:
    wf = _workflow(workspace)
    if wf is None:
        return False
    src = wf.read_text()
    m = META_RE.search(src)
    if not m:
        return False
    declared = TITLE_RE.findall(m.group(0))
    called = re.findall(r"^phase\('([^']+)'\)", src[m.end():], re.M)
    if not called or any(c not in declared for c in called):
        return False
    idx = [declared.index(c) for c in called]
    return all(idx[k] >= idx[k - 1] for k in range(1, len(idx)))


@criterion(description="work-phase prompts arrived as data (no unfilled TODO)")
def prompts_as_data(workspace: Path) -> bool:
    wf = _workflow(workspace)
    if wf is None:
        return False
    return "TODO:" not in _body(wf.read_text())


@criterion(description="every agent() dispatch carries a schema")
def every_agent_has_schema(workspace: Path) -> bool:
    wf = _workflow(workspace)
    if wf is None:
        return False
    body = _body(wf.read_text())
    calls = len(re.findall(r"\bagent\(", body))
    schemas = len(re.findall(r"\bschema:", body))
    return calls > 0 and schemas >= calls

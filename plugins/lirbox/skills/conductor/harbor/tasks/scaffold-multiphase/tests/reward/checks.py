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
    """A generated conductor is neither standalone ESM nor CommonJS: it carries `export const meta`
    AND a top-level `return`, so `node --check` can never pass it. The runtime wraps it in an async
    function (it uses top-level await), so that is what we compile it as."""
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
    """CLAUDE.md: the conductor layer is "pure JS only". Those primitives may appear ONLY inside
    worker prompt strings, which are data the conductor ships and never executes — so template
    literals are stripped before scanning."""
    wf = _workflow(workspace)
    if wf is None:
        return False
    body = _body(wf.read_text())
    if not body:
        return False
    stripped = re.sub(r"`(?:[^`\\]|\\.)*`", '""', body)
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

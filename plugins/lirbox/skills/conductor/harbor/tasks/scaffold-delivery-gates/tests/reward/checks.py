"""Deterministic checks for a DELIVERY-tier scaffold. The workflow is never executed.

WHY THIS TASK EXISTS (2026-07-30). The sibling task `scaffold-multiphase` is scaffold-only and bare
tier: it needs no gate flags at all. That makes it blind to exactly the regression a token-reduction
change is most likely to cause — trimming `references/generator-flags.md`, whose bulk is gate
semantics (hard-fail behaviour, gate ordering, DoDBaseline), would score WELL on that task while
quietly breaking real delivery runs. Measured there: `generator-flags.md` was read in 6/6 runs.

So this task supplies the up-signals for the delivery tier (broad risky surface, must not regress,
ships as a PR, needs review + tests + docs, spans sessions) and grades whether the agent actually
wired the gates. A trim that hurts delivery shows up HERE as a reward drop.

Same split as the sibling: this directory is `reward` (the scalar Harbor gates on); the semantic
judge lives in ../quality/ under its own key.
"""

import json
import re
import subprocess
from pathlib import Path

from rewardkit import criterion


def _workflow(workspace: Path):
    matches = sorted((workspace / ".workflows").glob("*.js"))
    return matches[0] if matches else None


def _dod(workspace: Path):
    """The frozen DoD file, wherever the agent put it (.workflows/ or the repo root)."""
    for pat in ("*.dod.json", "*dod*.json"):
        for base in (workspace / ".workflows", workspace):
            hits = sorted(p for p in base.glob(pat) if p.is_file())
            if hits:
                return hits[0]
    return None


def _body(src: str) -> str:
    i = src.find("const NAME")
    return src[i:] if i >= 0 else ""


META_RE = re.compile(r"export const meta = \{.*?\n\}", re.S)
TITLE_RE = re.compile(r"\{ title: '([^']+)' \}")


def _phases(workspace: Path):
    wf = _workflow(workspace)
    if wf is None:
        return []
    m = META_RE.search(wf.read_text())
    return TITLE_RE.findall(m.group(0)) if m else []


@criterion(description="a workflow script was generated under .workflows/")
def output_exists(workspace: Path) -> bool:
    return _workflow(workspace) is not None


@criterion(description="emitted script compiles as an async workflow body")
def parses_as_workflow_body(workspace: Path) -> bool:
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


@criterion(description="conductor layer is pure JS (no fs/git/require/Date.now/Math.random)")
def conductor_layer_pure(workspace: Path) -> bool:
    """Strips EVERY string literal, not just template literals — see the sibling task's note. A DoD
    whose checks are `node -e "...require('fs')..."` is data the gate shells out, not code the
    conductor runs, and a delivery scaffold always carries such a DoD."""
    wf = _workflow(workspace)
    if wf is None:
        return False
    body = _body(wf.read_text())
    if not body:
        return False
    for literal in (r"`(?:[^`\\]|\\.)*`", r'"(?:[^"\\]|\\.)*"', r"'(?:[^'\\]|\\.)*'"):
        body = re.sub(literal, '""', body)
    return not any(
        re.search(p, body)
        for p in (r"\brequire\s*\(", r"\bfs\.", r"\bDate\.now\s*\(", r"\bnew Date\b",
                  r"\bMath\.random\s*\(")
    )


@criterion(description="work-phase prompts arrived as data (no unfilled TODO)")
def prompts_as_data(workspace: Path) -> bool:
    wf = _workflow(workspace)
    return wf is not None and "TODO:" not in _body(wf.read_text())


@criterion(description="a code-review gate phase is wired in")
def has_review_gate(workspace: Path) -> bool:
    """--enforce-code emits CodeGate; --merge-gates / --profile lite collapse it into Review. Either
    satisfies "it needs a proper code review before merge"."""
    return any(p in ("CodeGate", "Review") for p in _phases(workspace))


@criterion(description="a PR phase is wired in")
def has_pr_phase(workspace: Path) -> bool:
    return "PR" in _phases(workspace)


@criterion(description="a definition of done was frozen as a file")
def dod_file_exists(workspace: Path) -> bool:
    return _dod(workspace) is not None


@criterion(description="the DoD has >=3 criteria and every checkable one carries a real command")
def dod_is_falsifiable(workspace: Path) -> bool:
    """The gap the sibling task cannot see: a DoD of `"check": "true"` is well-formed and useless.
    A checkable criterion must carry a command that could actually fail."""
    p = _dod(workspace)
    if p is None:
        return False
    try:
        crit = json.loads(p.read_text()).get("criteria") or []
    except Exception:
        return False
    if len(crit) < 3:
        return False
    for c in crit:
        if c.get("tier") != "checkable":
            continue
        chk = (c.get("check") or "").strip()
        if not chk or chk in {"true", "/bin/true", ":", "exit 0"}:
            return False
    return True


@criterion(description="a DoD gate phase verifies the DoD at run end")
def has_dod_gate(workspace: Path) -> bool:
    return "DoDGate" in _phases(workspace)


@criterion(description="every agent() dispatch carries a schema")
def every_agent_has_schema(workspace: Path) -> bool:
    wf = _workflow(workspace)
    if wf is None:
        return False
    body = _body(wf.read_text())
    return body.count("agent(") > 0 and body.count("agent(") <= body.count("schema:")

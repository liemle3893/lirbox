# Task image for loom__scaffold-fanout.
#
# BUILD INPUT: the `COPY skill` below installs a PRUNED copy of this skill for the agent, from
# environment/skill/ in this directory. That copy is derived, not tracked — generate it with
#     node scripts/harbor-prep.mjs loom/scaffold-fanout
# before running the task. The prune strips evals/, harbor/ and arena/; shipping those would hand
# the container the graders it is scored against.
#
# python3 is present for rewardkit (installed at verify time by tests/test.sh via uvx, never baked
# into the image — test-only deps stay out of the image per Harbor convention).
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl ripgrep python3 \
    && rm -rf /var/lib/apt/lists/*

# Installed as a PERSONAL skill so the Skill tool resolves it by the bare name "loom",
# which is what instruction.md instructs the agent to use.
COPY skill /root/.claude/skills/loom

# A real (tiny) service to plan against. loom's Plan node reads the repo; a graph authored against
# an empty directory is authored against nothing. The three exporters must be VISIBLY independent
# — no shared helper between them — or "these are independent" is the instruction's claim rather
# than something the agent can verify for itself.
RUN mkdir -p /app/src/exporters
WORKDIR /app

RUN printf '%s\n' \
  'COLUMNS = ["name", "email", "phone", "ssn", "amount"]' \
  '' \
  'def rows():' \
  '    return [{"name": "a", "email": "a@x", "phone": "1", "ssn": "2", "amount": 3}]' \
  '' \
  'def export(fmt):' \
  '    from src.exporters import csv_export, pdf_export, xlsx_export' \
  '    return {"csv": csv_export, "pdf": pdf_export, "xlsx": xlsx_export}[fmt].write(rows())' \
  > /app/src/report.py

RUN printf '%s\n' \
  'from src.report import COLUMNS' \
  '' \
  '# Quirk: the header row is emitted separately from the body.' \
  'def write(rows):' \
  '    out = [",".join(COLUMNS)]' \
  '    for r in rows:' \
  '        out.append(",".join(str(r[c]) for c in COLUMNS))' \
  '    return "\\n".join(out)' \
  > /app/src/exporters/csv_export.py

RUN printf '%s\n' \
  'from src.report import COLUMNS' \
  '' \
  '# Quirk: column widths are precomputed, so dropping a column shifts the layout.' \
  'def write(rows):' \
  '    widths = {c: max(len(c), 8) for c in COLUMNS}' \
  '    lines = ["".join(c.ljust(widths[c]) for c in COLUMNS)]' \
  '    for r in rows:' \
  '        lines.append("".join(str(r[c]).ljust(widths[c]) for c in COLUMNS))' \
  '    return "\\n".join(lines)' \
  > /app/src/exporters/pdf_export.py

RUN printf '%s\n' \
  'from src.report import COLUMNS' \
  '' \
  '# Quirk: cells are addressed by absolute column index, not by name.' \
  'def write(rows):' \
  '    cells = {}' \
  '    for i, c in enumerate(COLUMNS):' \
  '        cells[(0, i)] = c' \
  '    for j, r in enumerate(rows, start=1):' \
  '        for i, c in enumerate(COLUMNS):' \
  '            cells[(j, i)] = r[c]' \
  '    return cells' \
  > /app/src/exporters/xlsx_export.py

# Golden fixtures for TWO of the three formats. The regeneration step therefore depends on
# csv and xlsx and on neither the pdf work — the asymmetry that makes the region a DAG rather
# than three parallel lanes.
RUN mkdir -p /app/tests/golden
RUN printf '%s\n' 'name,email,phone,ssn,amount' 'a,a@x,1,2,3' > /app/tests/golden/report.csv
RUN printf '%s\n' '{"(0, 0)": "name", "(0, 1)": "email"}' > /app/tests/golden/report.xlsx.json

# loom's Setup node runs git and expects a working tree.
RUN git init -q /app \
 && git -C /app config user.email harbor@local \
 && git -C /app config user.name harbor \
 && git -C /app add -A \
 && git -C /app commit -q -m "init: three-format report exporter"

-- DuckDB views over the append-only JSON artifacts. No daemon, no ingestion, no drift:
-- a lane only ever writes a JSON file, so lanes stay harness-neutral.
--   duckdb -c "SET VARIABLE r='<run-dir>'" -c ".read views.sql" -c "SELECT * FROM board"
CREATE OR REPLACE VIEW dispatch AS
  SELECT * FROM read_json_auto(getvariable('r') || '/dispatch/*.json', union_by_name := true);
CREATE OR REPLACE VIEW evidence AS
  SELECT * FROM read_json_auto(getvariable('r') || '/evidence/*.json', union_by_name := true);
CREATE OR REPLACE VIEW decisions AS
  SELECT * FROM read_json_auto(getvariable('r') || '/decisions/*.json', union_by_name := true);
CREATE OR REPLACE VIEW transitions AS
  SELECT * FROM read_json_auto(getvariable('r') || '/transitions.jsonl', format := 'newline_delimited');

-- The board. `verified_by` is NULL unless some agent OTHER than the implementor
-- produced a verification artifact — the column a Done column cannot fake.
CREATE OR REPLACE VIEW board AS
SELECT d.lane, d.role, d.agent_name, d.pane_id, d.branch, d.sha_at_dispatch,
       (SELECT t.to FROM transitions t WHERE t.lane = d.lane ORDER BY t.at DESC LIMIT 1) AS state,
       (SELECT string_agg(e.produced_by, ',') FROM evidence e
         WHERE e.lane = d.lane AND e.kind = 'verification' AND e.produced_by <> d.agent_name) AS verified_by,
       (SELECT count(*) FROM evidence e WHERE e.lane = d.lane) AS artifacts
FROM dispatch d ORDER BY d.lane;

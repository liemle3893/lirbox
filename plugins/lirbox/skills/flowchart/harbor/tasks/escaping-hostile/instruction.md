Diagram this request-handling flow as an interactive flowchart, written to `/app/out.html`.

The handler reads the tenant with `c.Param("tenant_id")`. If that is empty it returns
`ApiResponse{Error: "missing tenant"}`. Otherwise it loads `[]ServiceKeyDto` from the cache; on a
miss it queries Postgres and calls `cache.Set(key, dto, 5*time.Minute)`. If the query errors it
returns a 500 — otherwise it serialises `ApiResponse{Data: dto}` and returns 200.

Use the real code expressions above as the node labels — do not paraphrase them.

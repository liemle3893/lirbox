Invoke the Skill tool with skill: "flowchart" — that exact bare value, not "lirbox:flowchart". Do
not call "flowchart" as a tool directly; it is not one. The skills list advertises names, it does
not create tools.

This session is headless and non-interactive — do not end your turn until the HTML file is written
to disk. Write the output to /app/out.html (exactly that path).

---

Diagram this request-handling flow as an interactive flowchart, written to `/app/out.html`.

The handler reads the tenant with `c.Param("tenant_id")`. If that is empty it returns
`ApiResponse{Error: "missing tenant"}`. Otherwise it loads `[]ServiceKeyDto` from the cache; on a
miss it queries Postgres and calls `cache.Set(key, dto, 5*time.Minute)`. If the query errors it
returns a 500 — otherwise it serialises `ApiResponse{Data: dto}` and returns 200.

Use the real code expressions above as the node labels — do not paraphrase them.

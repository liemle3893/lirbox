# LikeC4 DSL — condensed reference

A `.c4` file has three top-level blocks, in this order:

```likec4
specification { }   // declare the element kinds you will use
model { }           // the architecture: elements, nesting, relationships
views { }           // what to render: one view per drill-down level
```

Multiple `.c4` files in one project dir are merged; for this skill keep ONE `model.c4`.

## specification

Declare every element kind before use. C4 mapping used by this skill:

```likec4
specification {
  element actor {              // C4 "Person"
    style { shape person }
  }
  element system               // C4 "Software System"
  element container            // C4 "Container" (app/service/store)
  element component            // C4 "Component"
}
```

Optional per-kind defaults: `technology '...'`, `description '...'`,
`style { shape person|browser|mobile|cylinder|storage|queue|rectangle; color primary|secondary|muted|green|amber|red }`.
Tags: declare `tag critical` here, attach as `#critical` on elements, target in views.

## model

- Element: `id = kind 'Title'` — `id` is the reference name; nested ids are addressed
  `parent.child` from outside, short name from inside the same scope.
- Nesting IS the C4 hierarchy: components inside containers inside systems.
- Optional element body: `description '...'`, `technology '...'`, `style { ... }`, `#tag`.
- Relationship: `source -> target 'label'` or `source -> target 'label' 'technology'`.
  Relationships may be declared inside a parent (short names) or at model root (full paths).

```likec4
model {
  customer = actor 'Customer'
  shop = system 'Shop Platform' {
    web = container 'Web App' { technology 'React' }
    api = container 'API' {
      technology 'Go'
      auth = component 'Auth Middleware'
      orders = component 'Orders Service'
    }
    db = container 'Database' { technology 'PostgreSQL'; style { shape storage } }
    web -> api 'calls' 'JSON/HTTPS'
    api.orders -> db 'reads/writes' 'SQL'
  }
  customer -> shop.web 'uses'
}
```

## views

One view per drill-down level. `view index` is the landing page — always define it.

```likec4
views {
  view index {                 // C4 level 1: system landscape/context
    title 'Landscape'
    include *
  }
  view of shop {               // C4 level 2: containers of one system
    title 'Shop Platform — Containers'
    include *
  }
  view of shop.api {           // C4 level 3: components of one container
    title 'API — Components'
    include *
  }
}
```

Predicates (order matters; later rules apply on top of earlier ones):
- `include *` — in a `view of X`: X's children + edges to visible neighbors.
- `include a.b`, `include a.*` (children), `include a.**` (all descendants).
- `exclude a.b` — remove previously included.
- `include x with { color amber; title '...' }` — per-view override.
- `autoLayout TopBottom` (default) | `LeftRight` etc.

## Pitfalls

- Every kind used in `model` MUST be declared in `specification` — the validator
  rejects unknown kinds (this is the most common error).
- Ids are code, titles are prose: `web = container 'Web App'` — don't quote ids.
- `->` needs both ends resolvable from the current scope; from model root use full
  paths (`shop.web`), not short names.
- Don't fabricate a `view of X` for an X with no children — it renders empty.
- Semicolons separate inline properties (`technology 'Go'; style { ... }`); newlines
  otherwise suffice.

## Validate loop

From the directory containing the model dir:

```sh
<skill-dir>/scripts/likec4.sh validate --json <slug>-c4
```

Exit 0 + `"totalErrors": 0` → clean. Errors come with file/line — fix and re-run.

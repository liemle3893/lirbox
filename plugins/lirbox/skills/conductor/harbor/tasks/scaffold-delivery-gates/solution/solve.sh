#!/bin/bash
# Reference solution: what a correct delivery-tier scaffold looks like. Real computation — it runs
# the generator, it does not drop a pre-baked file.
set -euo pipefail

SKILL=/root/.claude/skills/conductor
cd /app
mkdir -p .workflows

# A DoD with commands that could actually fail — `"check": "true"` would be well-formed and useless.
cat > .workflows/auth-bearer-migration.dod.json <<'JSON'
{
  "criteria": [
    { "id": "suite-green", "tier": "checkable",
      "text": "the full test suite passes on the migrated code",
      "check": "npm test --silent" },
    { "id": "legacy-path-authenticates", "tier": "checkable",
      "text": "a session-cookie request still authenticates (no client is logged out)",
      "check": "npm test --silent -- --grep 'session cookie'" },
    { "id": "bearer-path-authenticates", "tier": "checkable",
      "text": "a signed bearer token authenticates on every route module",
      "check": "npm test --silent -- --grep 'bearer'" },
    { "id": "no-deprecated-session-api", "tier": "checkable",
      "text": "no route module still imports the deprecated session-cookie helper",
      "check": "! grep -rn --include=*.js -e 'require(.*session-cookie' src/routes" },
    { "id": "refresh-endpoint-reviewed", "tier": "judged",
      "text": "the refresh endpoint's token rotation is correct and cites the code it relies on" }
  ]
}
JSON

cat > .workflows/auth-bearer-migration.prompts.json <<'JSON'
{
  "Migrate": "Move the authentication middleware off the deprecated session-cookie path onto signed bearer tokens. Cover every route module under src/routes, the login and refresh endpoints, and the session store. Keep the session-cookie path working for existing clients: accept BOTH credentials during the transition rather than replacing one with the other. Record each touched module and the credential paths it now accepts in implementation-notes/."
}
JSON

node "$SKILL/scripts/scaffold-workflow.cjs" \
  --name auth-bearer-migration \
  --desc "Migrate auth middleware from session cookies to signed bearer tokens" \
  --phases "Migrate" \
  --prompts-file .workflows/auth-bearer-migration.prompts.json \
  --dod-file .workflows/auth-bearer-migration.dod.json \
  --profile delivery

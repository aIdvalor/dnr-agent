#!/usr/bin/env bash
# Verifies the static export is replay-only: no API routes, no server handlers, no model SDK or provider endpoints,
# no key names or key-shaped strings. Exits 1 on any hit. Usage: scripts/verify-static.sh [out]
set -uo pipefail
OUT="${1:-out}"
fail=0
[ -d "$OUT" ] || { echo "no $OUT dir"; exit 1; }
[ -f "$OUT/index.html" ] || { echo "FAIL no index.html"; fail=1; }
[ -d "$OUT/demo/runs" ] || { echo "FAIL no recorded runs"; fail=1; }
if find "$OUT" -path '*/api/*' | grep -q .; then echo "FAIL api path in export:"; find "$OUT" -path '*/api/*' | head; fail=1; fi
if find "$OUT" -name '*.func' -o -name 'route.js' -o -name '*.server.js' | grep -q .; then echo "FAIL server handler in export"; fail=1; fi
check() { # label, regex (ERE). Prints file + count only, never the match.
  local hits; hits=$(grep -rlE "$2" "$OUT" 2>/dev/null || true)
  if [ -n "$hits" ]; then echo "FAIL $1:"; echo "$hits" | sed 's/^/  /'; fail=1; else echo "ok   $1"; fi
}
check "provider endpoints" 'generativelanguage\.googleapis|api\.openai\.com|api\.anthropic\.com|ai-gateway\.vercel|gateway\.ai\.vercel'
check "AI SDK provider code" '@ai-sdk/(google|openai|anthropic|gateway)|createGoogleGenerativeAI|ToolLoopAgent'
check "key env names" 'GOOGLE_GENERATIVE_AI_API_KEY|AI_GATEWAY_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|DNR_DEMO_ALLOW_LIVE'
check "key-shaped strings" 'AIza[0-9A-Za-z_-]{35}|ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{40,}|sk-[A-Za-z0-9_-]{20,}'
check "live route / fetch to /api" '/api/(run|commit|ledger|evals|cases)'
exit $fail

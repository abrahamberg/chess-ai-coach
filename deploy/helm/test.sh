#!/usr/bin/env bash
# Golden tests for the chess-ai-coach umbrella chart (plan Task 9.1, architecture §11).
#
# These are *rendering* tests: they run `helm template` with values.example.yaml and
# assert on the resulting manifests. No cluster is required. Run:
#
#   ./deploy/helm/test.sh
#
# Requires: helm (>= 3). `kubeconform` is optional — when present the rendered
# manifests are additionally schema-validated.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="$SCRIPT_DIR/chess-ai-coach"
VALUES="$CHART_DIR/values.example.yaml"
# Pinned so rendering does not depend on the caller's current kube-context.
NAMESPACE="chess-coach"

PASS=0
FAIL=0

pass() {
  PASS=$((PASS + 1))
  printf '  ok   %s\n' "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  printf '  FAIL %s\n' "$1"
  if [ -n "${2:-}" ]; then printf '       %s\n' "$2"; fi
}

# assert_contains <label> <needle> <haystack-file>
assert_contains() {
  if grep -qF -- "$2" "$3"; then
    pass "$1"
  else
    fail "$1" "expected to find: $2"
  fi
}

# assert_not_matches <label> <extended-regex> <haystack-file>
assert_not_matches() {
  local hits
  hits="$(grep -nE -- "$2" "$3" || true)"
  if [ -z "$hits" ]; then
    pass "$1"
  else
    fail "$1" "unexpected match for /$2/: $(printf '%s' "$hits" | head -3 | tr '\n' ' ')"
  fi
}

# ---------------------------------------------------------------------------
# Setup: the chart must exist and its pinned dependencies must be vendored.
# ---------------------------------------------------------------------------
echo "==> chess-ai-coach chart golden tests"

if [ ! -f "$CHART_DIR/Chart.yaml" ]; then
  echo "  FAIL chart exists"
  echo "       no Chart.yaml at $CHART_DIR"
  exit 1
fi

if [ ! -d "$CHART_DIR/charts" ]; then
  echo "--> vendoring pinned dependencies (helm dependency build)"
  helm repo add bitnami https://charts.bitnami.com/bitnami >/dev/null 2>&1
  helm repo add oauth2-proxy https://oauth2-proxy.github.io/manifests >/dev/null 2>&1
  if ! helm dependency build "$CHART_DIR" >/dev/null; then
    echo "  FAIL dependencies vendored"
    echo "       helm dependency build failed (network? Chart.lock stale?)"
    exit 1
  fi
fi

RENDER_DIR="$(mktemp -d)"
trap 'rm -rf "$RENDER_DIR"' EXIT
ALL="$RENDER_DIR/all.yaml"

render() { # render <output-file> [extra helm template args...]
  local out="$1"
  shift
  helm template chess-coach "$CHART_DIR" -f "$VALUES" -n "$NAMESPACE" "$@" >"$out" 2>"$out.err"
}

# ---------------------------------------------------------------------------
# 1. Rendering with the documented example values succeeds.
# ---------------------------------------------------------------------------
if render "$ALL"; then
  pass "helm template with values.example.yaml renders"
else
  fail "helm template with values.example.yaml renders" "$(head -5 "$ALL.err" | tr '\n' ' ')"
  echo
  echo "$PASS passed, $FAIL failed"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. The api Deployment's env includes ENGINE_URL (and the rest of the wiring
#    the app actually reads at boot — see apps/api/src/server.ts).
# ---------------------------------------------------------------------------
API="$RENDER_DIR/api.yaml"
render "$API" --show-only templates/api-deployment.yaml
assert_contains "api deployment runs the server bundle" '"node", "dist-bundle/server.mjs"' "$API"
assert_contains "api deployment declares ENGINE_URL" "name: ENGINE_URL" "$API"
assert_contains "api deployment declares DATABASE_URL" "name: DATABASE_URL" "$API"
assert_contains "api deployment declares LLM_KEY_MASTER_KEY" "name: LLM_KEY_MASTER_KEY" "$API"
assert_contains "api ENGINE_URL points at the engine service" "http://chess-coach-engine:8081" "$API"
assert_contains "api readiness probe is /readyz (architecture §11)" "path: /readyz" "$API"

# The worker is the same image with a different command (apps/api/src/worker.ts).
WORKER="$RENDER_DIR/worker.yaml"
render "$WORKER" --show-only templates/worker-deployment.yaml
assert_contains "worker deployment runs the worker bundle" '"node", "dist-bundle/worker.mjs"' "$WORKER"
assert_contains "worker deployment declares ENGINE_URL" "name: ENGINE_URL" "$WORKER"

# ---------------------------------------------------------------------------
# 3. The Stripe webhook path is unauthenticated at the proxy (architecture §11:
#    "--skip-auth-route for /api/stripe/webhook and probes"). The webhook is
#    still signature-verified in-app (§12).
# ---------------------------------------------------------------------------
PROXY="$RENDER_DIR/proxy.yaml"
render "$PROXY" --show-only charts/oauth2-proxy/templates/deployment.yaml
assert_contains "oauth2-proxy skips auth for the stripe webhook" \
  "--skip-auth-route=^/api/stripe/webhook$" "$PROXY"
assert_contains "oauth2-proxy skips auth for /healthz" "--skip-auth-route=^/healthz$" "$PROXY"
assert_contains "oauth2-proxy skips auth for /readyz" "--skip-auth-route=^/readyz$" "$PROXY"
assert_contains "oauth2-proxy forwards identity headers" "--set-xauthrequest=true" "$PROXY"

# ---------------------------------------------------------------------------
# 4. No secret literals anywhere in the rendered output. Everything sensitive
#    must come from a pre-created Secret via secretKeyRef / envFrom
#    (architecture §11 "templated existingSecret pattern").
# ---------------------------------------------------------------------------
OURS="$RENDER_DIR/ours.yaml"
helm template chess-coach "$CHART_DIR" -f "$VALUES" -n "$NAMESPACE" \
  --show-only templates/api-deployment.yaml \
  --show-only templates/worker-deployment.yaml \
  --show-only templates/migrate-job.yaml \
  --show-only templates/engine-deployment.yaml \
  --show-only templates/web-deployment.yaml >"$OURS" 2>/dev/null

assert_not_matches "chart templates create no Secret objects" '^kind: Secret' "$OURS"
assert_not_matches "chart templates embed no stringData/data blocks" '^\s*(stringData|data):\s*$' "$OURS"
assert_not_matches "no provider api-key literals in rendered output" \
  '(sk-[A-Za-z0-9_-]{8,}|sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|price_[A-Za-z0-9]+)' "$ALL"
assert_not_matches "no password literal in the rendered DATABASE_URL" \
  'postgresql?://[^ "]*:[A-Za-z0-9%._~+-]+@' "$OURS"

assert_contains "master key comes from a secretKeyRef" "secretKeyRef" "$OURS"
assert_contains "master key references the llm-key-master-key secret" "name: llm-key-master-key" "$OURS"
assert_contains "platform LLM keys reference the platform-llm-keys secret" "name: platform-llm-keys" "$OURS"
assert_contains "stripe values reference the stripe secret" "name: stripe" "$OURS"
assert_contains "db password references the postgres-credentials secret" "name: postgres-credentials" "$OURS"

# values.yaml / values.example.yaml themselves must not ship real-looking keys.
assert_not_matches "values.yaml ships no secret literals" \
  '(sk-[A-Za-z0-9_-]{8,}|sk_(live|test)_|whsec_|price_[A-Za-z0-9]{6,})' "$CHART_DIR/values.yaml"
assert_not_matches "values.example.yaml ships no secret literals" \
  '(sk-[A-Za-z0-9_-]{8,}|sk_(live|test)_|whsec_|price_[A-Za-z0-9]{6,})' "$VALUES"

# ---------------------------------------------------------------------------
# 5. Structural requirements from architecture §11.
# ---------------------------------------------------------------------------
MIGRATE="$RENDER_DIR/migrate.yaml"
render "$MIGRATE" --show-only templates/migrate-job.yaml
assert_contains "migrate job is a pre-install/pre-upgrade hook" '"helm.sh/hook": pre-install,pre-upgrade' "$MIGRATE"
assert_contains "migrate job runs the kysely migrations" \
  '"node", "dist-bundle/migrate.mjs"' "$MIGRATE"
assert_contains "migrate job reuses the api image" "chess-ai-coach/api" "$MIGRATE"

NETPOL="$RENDER_DIR/netpol.yaml"
helm template chess-coach "$CHART_DIR" -f "$VALUES" -n "$NAMESPACE" \
  --show-only templates/networkpolicy-api.yaml \
  --show-only templates/networkpolicy-worker.yaml \
  --show-only templates/networkpolicy-engine.yaml \
  --show-only templates/networkpolicy-web.yaml >"$NETPOL" 2>/dev/null
assert_contains "engine NetworkPolicy exists" "chess-coach-engine" "$NETPOL"
assert_contains "engine accepts only api + worker" "component: worker" "$NETPOL"
assert_not_matches "no NetworkPolicy opens a component to the whole world" 'ipBlock' "$NETPOL"

INGRESS="$RENDER_DIR/ingress.yaml"
render "$INGRESS" --show-only templates/ingress.yaml
assert_contains "ingress targets oauth2-proxy only" "chess-coach-oauth2-proxy" "$INGRESS"
assert_not_matches "ingress does not expose api/web directly" \
  'name: chess-coach-(api|web)$' "$INGRESS"

# ---------------------------------------------------------------------------
# 6. Optional Stripe: the chart must render with Stripe disabled too
#    (apps/api/src/bootstrap.ts treats STRIPE_* as all-or-nothing optional).
# ---------------------------------------------------------------------------
NOSTRIPE="$RENDER_DIR/nostripe.yaml"
if render "$NOSTRIPE" --set stripe.enabled=false --show-only templates/api-deployment.yaml; then
  assert_not_matches "stripe env is absent when stripe.enabled=false" 'STRIPE_SECRET_KEY' "$NOSTRIPE"
else
  fail "renders with stripe.enabled=false" "$(head -3 "$NOSTRIPE.err" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 7. Schema validation (optional, only when kubeconform is installed).
# ---------------------------------------------------------------------------
if command -v kubeconform >/dev/null 2>&1; then
  if kubeconform -strict -summary "$ALL" >"$RENDER_DIR/kubeconform.txt" 2>&1; then
    pass "kubeconform -strict validates the rendered manifests"
  else
    fail "kubeconform -strict validates the rendered manifests" \
      "$(head -5 "$RENDER_DIR/kubeconform.txt" | tr '\n' ' ')"
  fi
else
  echo "  skip kubeconform not installed"
fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

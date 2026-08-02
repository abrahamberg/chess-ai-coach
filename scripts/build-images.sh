#!/usr/bin/env bash
# Build the three deployment images (api, web, engine) — Task 9.1.
#
# The api and web images are built OUTSIDE Docker: their Dockerfiles only COPY
# finished artifacts (apps/api/dist-bundle, apps/web/dist and a pruned
# production node_modules). The four preparation steps below are order-sensitive
# — step 3 deletes the dev dependencies steps 1–2 need — which is exactly why
# they live in a script instead of a doc that can be transcribed wrongly.
# Background and rationale: docs/deploy-build.md.
#
# Usage:
#   scripts/build-images.sh [options]
#
#   --registry <host/org>   registry prefix for the image tags (e.g. ghcr.io/acme).
#                           Must be set when pushing. Default: none (local tags).
#   --tag <tag>             image tag. Default: the short git SHA, else "dev".
#   --platform <p>          target platform. Default: linux/arm64 (the cluster's
#                           node architecture). Pass "" to build for the host.
#   --push                  push to the registry instead of loading locally.
#                           Without it the images are --load'ed into the local
#                           daemon; buildx writes NOTHING with neither flag.
#   --skip-artifacts        reuse an existing dist-bundle/dist/node_modules
#                           (skips steps 1–3 — you own the ordering then).
#   --artifacts-only        run steps 1–3 and stop before building images.
#   --restore-dev-deps      re-run a full `npm ci` at the end, undoing step 3.
#                           Off by default: pointless on a throwaway CI runner,
#                           usually what you want on a workstation.
#
# Examples:
#   scripts/build-images.sh --registry ghcr.io/acme --tag v1.2.3 --push
#   scripts/build-images.sh --platform "" --restore-dev-deps      # local smoke build
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

REGISTRY=""
TAG=""
PLATFORM="linux/arm64"
PUSH=0
SKIP_ARTIFACTS=0
ARTIFACTS_ONLY=0
RESTORE_DEV_DEPS=0

log() { echo "[build-images] $*"; }
die() { echo "[build-images] ERROR: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry) REGISTRY="${2:-}"; shift 2 ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --push) PUSH=1; shift ;;
    --skip-artifacts) SKIP_ARTIFACTS=1; shift ;;
    --artifacts-only) ARTIFACTS_ONLY=1; shift ;;
    --restore-dev-deps) RESTORE_DEV_DEPS=1; shift ;;
    -h|--help) awk 'NR==1 {next} !/^#/ {exit} {sub(/^# ?/, ""); print}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

if [[ -z "$TAG" ]]; then
  TAG="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
fi
[[ "$PUSH" -eq 1 && -z "$REGISTRY" ]] && die "--push needs --registry (nothing to push to)"

PREFIX=""
[[ -n "$REGISTRY" ]] && PREFIX="${REGISTRY%/}/"

# ---------------------------------------------------------------------------
# Steps 1–3: produce the artifacts the api/web Dockerfiles copy. Order matters.
# ---------------------------------------------------------------------------
if [[ "$SKIP_ARTIFACTS" -eq 0 ]]; then
  log "1/4 npm ci (full install — the builds below need the dev dependencies)"
  npm ci

  log "2/4 building artifacts: apps/api/dist-bundle + apps/web/dist"
  npm run bundle --workspace=@chess-coach/api
  npm run build --workspace=@chess-coach/web

  log "3/4 pruning node_modules to apps/api's production dependencies"
  # Destructive on purpose and only correct here: it removes the dev
  # dependencies step 2 needed, so it must run after step 2 and before any
  # image build.
  npm ci --omit=dev --workspace=@chess-coach/api --include-workspace-root
else
  log "1-3/4 skipped (--skip-artifacts)"
fi

[[ -f apps/api/dist-bundle/server.mjs ]] || die "apps/api/dist-bundle/server.mjs missing — run without --skip-artifacts"
[[ -f apps/web/dist/index.html ]] || die "apps/web/dist/index.html missing — run without --skip-artifacts"

restore_dev_deps() {
  if [[ "$RESTORE_DEV_DEPS" -eq 1 ]]; then
    log "restoring dev dependencies (npm ci)"
    npm ci
  else
    log "NOTE: node_modules is pruned to production deps. Run 'npm ci' before developing or testing."
  fi
}

if [[ "$ARTIFACTS_ONLY" -eq 1 ]]; then
  log "artifacts built (--artifacts-only); skipping image builds"
  restore_dev_deps
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 4: the images. buildx is required — see docs/deploy-build.md for the
# builder/QEMU prerequisites when PLATFORM differs from the host architecture.
# ---------------------------------------------------------------------------
docker buildx version >/dev/null 2>&1 || die "docker buildx is not available (see docs/deploy-build.md)"

BUILD_ARGS=()
[[ -n "$PLATFORM" ]] && BUILD_ARGS+=(--platform "$PLATFORM")
# buildx discards the result unless an output is requested: --push or --load.
if [[ "$PUSH" -eq 1 ]]; then
  BUILD_ARGS+=(--push)
else
  BUILD_ARGS+=(--load)
fi

for COMPONENT in api web engine; do
  IMAGE="${PREFIX}chess-ai-coach/${COMPONENT}:${TAG}"
  log "4/4 building $IMAGE${PLATFORM:+ ($PLATFORM)}"
  docker buildx build "${BUILD_ARGS[@]}" \
    -f "docker/Dockerfile.${COMPONENT}" \
    -t "$IMAGE" \
    .
done

log "done: ${PREFIX}chess-ai-coach/{api,web,engine}:${TAG}"
restore_dev_deps

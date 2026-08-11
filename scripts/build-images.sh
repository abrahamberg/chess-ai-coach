#!/usr/bin/env bash
# Build the three deployment images (api, web, engine) — Task 9.1.
#
# All application images are built OUTSIDE Docker: their Dockerfiles only COPY
# finished artifacts (api/web/engine bundles and static files). The preparation
# steps below are order-sensitive
# — step 3 deletes the dev dependencies steps 1–2 need — which is exactly why
# they live in a script instead of a doc that can be transcribed wrongly.
# Background and rationale: docs/deploy-build.md.
#
# Usage:
#   scripts/build-images.sh [options]
#
#   --registry <host/org>   registry prefix for the image tags (e.g. ghcr.io/acme).
#                           Must be set when pushing. Default: none (local tags).
#   --tag <tag>             image tag. Repeatable: every value becomes another tag
#                           on the same build, so all of them share one digest.
#                           Default: the short git SHA, else "dev".
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
#   scripts/build-images.sh --registry ghcr.io/acme --tag latest --tag v1.2.3 --push
#   scripts/build-images.sh --platform "" --restore-dev-deps      # local smoke build
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

REGISTRY=""
TAGS=()
PLATFORM="linux/arm64"
PUSH=0
SKIP_ARTIFACTS=0
ARTIFACTS_ONLY=0
RESTORE_DEV_DEPS=0

log() { echo "[build-images] $*"; }
die() { echo "[build-images] ERROR: $*" >&2; exit 1; }
# The tag list rendered as "a,b", for the log lines.
joined_tags() { local IFS=,; echo "${TAGS[*]}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry) REGISTRY="${2:-}"; shift 2 ;;
    --tag) TAGS+=("${2:-}"); shift 2 ;;
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --push) PUSH=1; shift ;;
    --skip-artifacts) SKIP_ARTIFACTS=1; shift ;;
    --artifacts-only) ARTIFACTS_ONLY=1; shift ;;
    --restore-dev-deps) RESTORE_DEV_DEPS=1; shift ;;
    -h|--help) awk 'NR==1 {next} !/^#/ {exit} {sub(/^# ?/, ""); print}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

if [[ "${#TAGS[@]}" -eq 0 ]]; then
  TAGS=("$(git rev-parse --short HEAD 2>/dev/null || echo dev)")
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

  log "2/4 building artifacts: apps/api/dist-bundle + apps/web/dist + services/engine/dist-bundle"
  npm run bundle --workspace=@chess-coach/api
  npm run build --workspace=@chess-coach/web
  node services/engine/scripts/bundle.mjs

  log "3/4 pruning node_modules to apps/api's production dependencies"
  # This must happen after all runner-side builds: esbuild is needed to bundle
  # the engine, but its platform-specific binary must not enter the API image.
  npm ci --omit=dev --workspace=@chess-coach/api --include-workspace-root
else
  log "1-3/4 skipped (--skip-artifacts)"
fi

[[ -f apps/api/dist-bundle/server.mjs ]] || die "apps/api/dist-bundle/server.mjs missing — run without --skip-artifacts"
[[ -f apps/web/dist/index.html ]] || die "apps/web/dist/index.html missing — run without --skip-artifacts"
[[ -f services/engine/dist-bundle/server.mjs ]] || die "services/engine/dist-bundle/server.mjs missing — run without --skip-artifacts"

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
  # Every tag is passed to the same build, so they all name one digest — the
  # only way "latest" and the version tag cannot drift apart.
  TAG_ARGS=()
  for TAG in "${TAGS[@]}"; do
    TAG_ARGS+=(-t "${PREFIX}chess-ai-coach:${COMPONENT}-${TAG}")
  done
  log "4/4 building ${PREFIX}chess-ai-coach:${COMPONENT}-{$(joined_tags)}${PLATFORM:+ ($PLATFORM)}"
  docker buildx build "${BUILD_ARGS[@]}" \
    -f "docker/Dockerfile.${COMPONENT}" \
    "${TAG_ARGS[@]}" \
    .
done

log "done: ${PREFIX}chess-ai-coach:{api,web,engine}-{$(joined_tags)}"
restore_dev_deps

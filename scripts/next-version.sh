#!/usr/bin/env bash
# Resolve the next patch version from the repository's git tags.
#
# Git tags are the version of record — nothing in the working tree records it,
# so publishing never needs a commit. A `v<major>.<minor>.<patch>` tag pointing
# at HEAD also means "this commit's images are already published", which is what
# lets a rebuild of the same commit do nothing at all.
#
# Only the patch level ever bumps automatically. Minor and major releases are a
# human `git tag` push, which the next build reads as its new base.
#
# Prints one `key=value` line per result, ready for GitHub Actions' $GITHUB_OUTPUT:
#
#   current=v0.3.7      highest existing version tag (empty if there are none)
#   next=v0.3.8         current with the patch level bumped
#   published=v0.3.7    version tag pointing at HEAD, empty if there is none
#   skip=true|false     true when published is set: HEAD is already built
#
# Usage:
#   scripts/next-version.sh                      # inspect
#   scripts/next-version.sh >> "$GITHUB_OUTPUT"  # in CI
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The glob is a coarse prefilter; the regex below is what actually decides, so a
# tag like v1.2.3-rc1 is ignored rather than fed into the arithmetic.
readonly TAG_GLOB='v[0-9]*.[0-9]*.[0-9]*'
readonly TAG_PATTERN='v[0-9]+\.[0-9]+\.[0-9]+'

# --sort=-v:refname orders by version number, so v0.3.10 ranks above v0.3.9.
# Sorting these as strings picks v0.3.9 instead, and the version series silently
# walks backwards the first time a patch level reaches double digits.
#
# $@: extra `git tag` selectors, e.g. --points-at HEAD
list_version_tags() {
  git tag --list "$TAG_GLOB" --sort=-v:refname "$@" | grep -Ex "$TAG_PATTERN" || true
}

bump_patch() {
  local version="${1#v}"
  local major="${version%%.*}"
  local rest="${version#*.}"
  local minor="${rest%%.*}"
  local patch="${rest##*.}"
  echo "v${major}.${minor}.$((patch + 1))"
}

CURRENT="$(list_version_tags | head -1)"
PUBLISHED="$(list_version_tags --points-at HEAD | head -1)"
# No tags yet: the first release is v0.0.1, matching the chart's appVersion.
NEXT="$(bump_patch "${CURRENT:-v0.0.0}")"

echo "current=${CURRENT}"
echo "next=${NEXT}"
echo "published=${PUBLISHED}"
if [[ -n "$PUBLISHED" ]]; then echo "skip=true"; else echo "skip=false"; fi

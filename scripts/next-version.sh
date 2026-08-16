#!/usr/bin/env bash
# Resolve the next version from the repository's git tags and HEAD's commit
# message.
#
# Git tags are the version of record — nothing in the working tree records it,
# so publishing never needs a commit. A `v<major>.<minor>.<patch>` tag pointing
# at HEAD also means "this commit's images are already published", which is what
# lets a rebuild of the same commit do nothing at all.
#
# The bump level is read from HEAD's commit message (Conventional Commits):
#   - a `!` before the colon (`feat!:`, `fix(api)!:`, ...) or a `BREAKING
#     CHANGE:` footer bumps major
#   - a `feat:` (or `feat(scope):`) subject bumps minor
#   - everything else bumps patch
# Only HEAD is inspected — when a push carries several commits, the rest are
# ignored, so squash/merge the bump you want into the last commit.
#
# A human can still push a `git tag` to set a new base directly (e.g. to jump
# to v2.0.0); the next build reads the highest tag as its starting point
# regardless of who created it.
#
# Prints one `key=value` line per result, ready for GitHub Actions' $GITHUB_OUTPUT:
#
#   current=v0.3.7      highest existing version tag (empty if there are none)
#   level=minor         bump level read from HEAD's commit message
#   next=v0.4.0         current with that level bumped
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

# Conventional-commit subject: `type(scope)!: subject` or `type: subject`.
# Patterns live in variables, not inline in [[ =~ ]] — bash's own parser (not
# just the regex engine) trips over unescaped parens typed directly there.
readonly MAJOR_SUBJECT_RE='^[a-zA-Z]+(\([^)]*\))?!:'
readonly MINOR_SUBJECT_RE='^feat(\([^)]*\))?:'
readonly BREAKING_FOOTER_RE='^BREAKING[ -]CHANGE:'

commit_bump_level() {
  local message subject
  message="$(git log -1 --format=%B HEAD)"
  subject="$(head -1 <<<"$message")"
  if [[ "$subject" =~ $MAJOR_SUBJECT_RE ]] \
    || grep -qE "$BREAKING_FOOTER_RE" <<<"$message"; then
    echo major
  elif [[ "$subject" =~ $MINOR_SUBJECT_RE ]]; then
    echo minor
  else
    echo patch
  fi
}

bump_patch() {
  local version="${1#v}"
  local major="${version%%.*}"
  local rest="${version#*.}"
  local minor="${rest%%.*}"
  local patch="${rest##*.}"
  echo "v${major}.${minor}.$((patch + 1))"
}

bump_minor() {
  local version="${1#v}"
  local major="${version%%.*}"
  local rest="${version#*.}"
  local minor="${rest%%.*}"
  echo "v${major}.$((minor + 1)).0"
}

bump_major() {
  local version="${1#v}"
  local major="${version%%.*}"
  echo "v$((major + 1)).0.0"
}

LEVEL="$(commit_bump_level)"
CURRENT="$(list_version_tags | head -1)"
PUBLISHED="$(list_version_tags --points-at HEAD | head -1)"
# No tags yet: the first release is v0.0.1, matching the chart's appVersion.
case "$LEVEL" in
  major) NEXT="$(bump_major "${CURRENT:-v0.0.0}")" ;;
  minor) NEXT="$(bump_minor "${CURRENT:-v0.0.0}")" ;;
  *) NEXT="$(bump_patch "${CURRENT:-v0.0.0}")" ;;
esac

echo "current=${CURRENT}"
echo "level=${LEVEL}"
echo "next=${NEXT}"
echo "published=${PUBLISHED}"
if [[ -n "$PUBLISHED" ]]; then echo "skip=true"; else echo "skip=false"; fi

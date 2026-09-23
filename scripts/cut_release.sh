#!/usr/bin/env bash
# Cuts a GitHub Release, which is what triggers .github/workflows/release-mac.yml's
# `on: release: types: [published]` trigger -- publishing a release here builds, signs,
# notarizes, and attaches the macOS DMG automatically. (workflow_dispatch from the Actions tab, or
# `gh workflow run release-mac.yml`, remains the other way to trigger it.)
#
# Usage:
#   ./scripts/cut_release.sh v0.2.0
#   ./scripts/cut_release.sh v0.2.0 --notes "What changed in this build."
#   ./scripts/cut_release.sh v0.2.0 --draft       # create but don't publish (no CI trigger)
#   ./scripts/cut_release.sh v0.2.0 --allow-dirty  # skip the clean-working-tree check
#
# Requires: gh (authenticated, `gh auth status`), and a `origin` remote pointing
# at the GitHub repo. Release notes default to GitHub's auto-generated notes
# (commits/PRs since the previous release) unless --notes is given.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "Usage: $0 <version-tag> [--notes \"...\"] [--draft] [--allow-dirty]" >&2
  exit 1
}

VERSION=""
NOTES=""
DRAFT=false
ALLOW_DIRTY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes)
      NOTES="${2:-}"
      [[ -z "$NOTES" ]] && usage
      shift 2
      ;;
    --draft)
      DRAFT=true
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    v*)
      [[ -n "$VERSION" ]] && usage
      VERSION="$1"
      shift
      ;;
    *)
      usage
      ;;
  esac
done

[[ -z "$VERSION" ]] && usage
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must look like vX.Y.Z (got: $VERSION)" >&2
  exit 1
fi

cd "$REPO_ROOT"

# --- Preflight checks -------------------------------------------------------

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh (GitHub CLI) is not installed. https://cli.github.com" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

REPO_SLUG="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
if [[ -z "$REPO_SLUG" ]]; then
  echo "error: couldn't resolve the GitHub repo from the 'origin' remote. Is one configured?" >&2
  exit 1
fi

if [[ "$ALLOW_DIRTY" != "true" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree has uncommitted changes -- commit or stash first (or pass --allow-dirty)." >&2
  git status --short >&2
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "warning: releasing from branch '$CURRENT_BRANCH', not 'main'." >&2
fi

if git rev-parse "$VERSION" >/dev/null 2>&1 || gh release view "$VERSION" --repo "$REPO_SLUG" >/dev/null 2>&1; then
  echo "error: tag/release $VERSION already exists." >&2
  exit 1
fi

# --- Create the release ------------------------------------------------------

RELEASE_ARGS=(release create "$VERSION" --repo "$REPO_SLUG" --title "$VERSION")

if [[ -n "$NOTES" ]]; then
  RELEASE_ARGS+=(--notes "$NOTES")
else
  RELEASE_ARGS+=(--generate-notes)
fi

if [[ "$DRAFT" == "true" ]]; then
  RELEASE_ARGS+=(--draft)
  echo "-> Creating DRAFT release $VERSION on $REPO_SLUG (won't trigger CI until published)..."
else
  echo "-> Creating and publishing release $VERSION on $REPO_SLUG..."
fi

gh "${RELEASE_ARGS[@]}"

git fetch --tags origin >/dev/null 2>&1 || true

if [[ "$DRAFT" == "true" ]]; then
  echo "✅ Draft release $VERSION created. Publish it from the Releases page (or 'gh release edit $VERSION --draft=false') to trigger CI."
else
  echo "✅ Release $VERSION published -- this triggers CI release workflows."
  RUN_ID="$(gh run list --repo "$REPO_SLUG" --workflow=release-mac.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
  if [[ -n "$RUN_ID" ]]; then
    echo "   Watch it with: gh run watch --repo $REPO_SLUG $RUN_ID"
  fi
fi

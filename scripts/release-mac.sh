#!/usr/bin/env bash
# Build, sign, notarize, and attach both macOS desktop editions (Lite and Standalone)
# to an existing GitHub release.
#
#   ./scripts/release-mac.sh                  # attach to the latest published release
#   ./scripts/release-mac.sh --tag v0.3.0     # a specific tag
#   ./scripts/release-mac.sh --skip-build     # reuse the bundle already built
#   ./scripts/release-mac.sh --no-upload      # build, sign, notarize only — don't attach
#   ./scripts/release-mac.sh --check          # verify credentials resolve, build nothing
#
# The release itself is created by scripts/cut_release.sh -- this script only attaches
# the signed, notarized DMGs to a release that already exists.
# .github/workflows/release-mac.yml runs this same script in CI on `release: published`.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
REPO="tianhaoz95/meowtrix"
BUILD_DIR="$ROOT/build/release-mac"

TAG=""; SKIP_BUILD=0; NO_UPLOAD=0; CHECK_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag)        TAG="${2:-}"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-upload)  NO_UPLOAD=1; shift ;;
    --check)      CHECK_ONLY=1; shift ;;
    -h|--help)    sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "!! unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { echo "!! $*" >&2; exit 1; }

# ------------------------------------------------------------------ preflight
say "preflight"

IDENTITY="${FA_MAC_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null \
  | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')}"
[ -n "$IDENTITY" ] || die "no \"Developer ID Application\" certificate in the keychain.
   Xcode > Settings > Accounts > your team > Manage Certificates > + .
   Only the Account Holder can create one."
echo "    identity        $IDENTITY"

# Notarization credentials
if [ -n "${FA_KEY_LOCATION:-}" ]; then
  ASC_KEY="${FA_KEY_LOCATION/#\~/$HOME}"
  ASC_KEY_ID="${FA_ASC_KEY_ID:-}"
  if [ -z "$ASC_KEY_ID" ]; then b="$(basename "$ASC_KEY")"; b="${b%.p8}"; ASC_KEY_ID="${b#AuthKey_}"; fi
else
  ASC_KEY_ID="${FA_ASC_KEY_ID:-}"
  ASC_KEY="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID:-none}.p8"
fi
if [ -n "${FA_NOTARY_PROFILE:-}" ]; then
  echo "    notarization    keychain profile \"$FA_NOTARY_PROFILE\""
elif [ -n "$ASC_KEY_ID" ] && [ -n "${FA_ASC_ISSUER_ID:-}" ] && [ -f "$ASC_KEY" ]; then
  echo "    notarization    API key $ASC_KEY_ID"
elif [ -n "${FA_APPLE_ID:-}" ] && [ -n "${FA_APP_PASSWORD:-}" ] && [ -n "${FA_TEAM_ID:-}" ]; then
  echo "    notarization    app-specific password for $FA_APPLE_ID"
else
  die "no notarization credentials — run ./scripts/sign-desktop.sh --notarize for the setup help."
fi

TOKEN="${FA_GITHUB_TOKEN:-${GH_TOKEN:-${GITHUB_TOKEN:-}}}"
if [ "$NO_UPLOAD" -eq 0 ] && [ "$CHECK_ONLY" -eq 0 ]; then
  command -v gh >/dev/null 2>&1 || die "gh CLI not found (needed to upload; use --no-upload to skip)"
  gh auth status >/dev/null 2>&1 || [ -n "$TOKEN" ] || die "not logged in to gh and no GH_TOKEN set"

  if [ -z "$TAG" ]; then
    TAG="$(gh release view --repo "$REPO" --json tagName -q .tagName 2>/dev/null || true)"
    [ -n "$TAG" ] || die "no tag given and no existing release found — pass --tag, or run scripts/cut_release.sh first."
  fi
  echo "    release tag     $TAG"
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  say "setup looks good — run without --check to build and release"
  exit 0
fi

LITE_APP="$ROOT/src-tauri/target/release/bundle/macos/Meowtrix Lite.app"
STANDALONE_APP="$ROOT/src-tauri/target/release/bundle/macos/Meowtrix Standalone.app"

# --------------------------------------------------------------------- build
if [ "$SKIP_BUILD" -eq 0 ]; then
  say "building Meowtrix Lite (Client Edition)"
  (cd "$ROOT" && npm run tauri build -- -c "$ROOT/src-tauri/tauri.lite.conf.json" -b app --no-sign)

  say "preparing standalone payload for Meowtrix Standalone"
  "$ROOT/scripts/prepare-standalone-payload.sh"

  say "building Meowtrix Standalone (Embedded Edition)"
  (cd "$ROOT" && npm run tauri build -- -c "$ROOT/src-tauri/tauri.standalone.conf.json" -b app --no-sign)
else
  say "skipping build"
fi

[ -d "$LITE_APP" ] || die "no app bundle at $LITE_APP — drop --skip-build"
[ -d "$STANDALONE_APP" ] || die "no app bundle at $STANDALONE_APP — drop --skip-build"

# ------------------------------------------------------- sign + notarize
mkdir -p "$BUILD_DIR/dmg"
LITE_DMG="$BUILD_DIR/dmg/Meowtrix-Lite-signed.dmg"
STANDALONE_DMG="$BUILD_DIR/dmg/Meowtrix-Standalone-signed.dmg"

say "signing and notarizing Meowtrix Lite"
"$ROOT/scripts/sign-desktop.sh" \
  --app "$LITE_APP" \
  --dmg "$LITE_DMG" \
  --volume "Meowtrix Lite" \
  --skip-updater \
  --notarize

say "signing and notarizing Meowtrix Standalone"
"$ROOT/scripts/sign-desktop.sh" \
  --app "$STANDALONE_APP" \
  --dmg "$STANDALONE_DMG" \
  --volume "Meowtrix Standalone" \
  --notarize

[ -f "$LITE_DMG" ] || die "expected artifact missing: $LITE_DMG"
[ -f "$STANDALONE_DMG" ] || die "expected artifact missing: $STANDALONE_DMG"

if [ "$NO_UPLOAD" -eq 1 ]; then
  say "done (not uploaded)"
  echo "  $LITE_DMG"
  echo "  $STANDALONE_DMG"
  exit 0
fi

# --------------------------------------------------------------- publish
VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$STANDALONE_APP/Contents/Info.plist")"
LITE_DMG_NAME="Meowtrix-Lite-$VERSION-arm64.dmg"
STANDALONE_DMG_NAME="Meowtrix-Standalone-$VERSION-arm64.dmg"

say "attaching both editions to $TAG"
[ -n "$TOKEN" ] && export GH_TOKEN="$TOKEN"

gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 \
  || die "release $TAG does not exist yet — run scripts/cut_release.sh first"

STAGE_DIR="$(mktemp -d)"
cp "$LITE_DMG" "$STAGE_DIR/$LITE_DMG_NAME"
cp "$STANDALONE_DMG" "$STAGE_DIR/$STANDALONE_DMG_NAME"

UPLOAD_FILES=(
  "$STAGE_DIR/$LITE_DMG_NAME#$LITE_DMG_NAME"
  "$STAGE_DIR/$STANDALONE_DMG_NAME#$STANDALONE_DMG_NAME"
)

UPDATER_DIR="$ROOT/src-tauri/target/release/bundle/macos/updater"
if [ -d "$UPDATER_DIR" ]; then
  for f in "$UPDATER_DIR"/*; do
    [ -f "$f" ] && UPLOAD_FILES+=("$f")
  done
fi

gh release upload "$TAG" --repo "$REPO" --clobber "${UPLOAD_FILES[@]}"

say "verifying uploaded asset URLs"
for asset in "$LITE_DMG_NAME" "$STANDALONE_DMG_NAME"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -L "https://github.com/$REPO/releases/download/$TAG/$asset")"
  [ "$code" = "200" ] || die "$asset is not fetchable (got $code)"
  echo "    $code  $asset"
done

if [ -f "$UPDATER_DIR/latest.json" ]; then
  json_code="$(curl -s -o /dev/null -w '%{http_code}' -L "https://github.com/$REPO/releases/download/$TAG/latest.json")"
  echo "    $json_code  latest.json"
fi

cat <<EOF

Attached both macOS editions and updater artifacts to $TAG:
  - Meowtrix Lite:       $LITE_DMG_NAME (~5 MB client shell)
  - Meowtrix Standalone: $STANDALONE_DMG_NAME (~55 MB zero-dependency bundle)
  URL: https://github.com/$REPO/releases/tag/$TAG
EOF

#!/usr/bin/env bash
# Sign the built .app, package a signed DMG, and optionally notarize.
#
#   ./scripts/sign-desktop.sh                 # sign the .app and build a signed .dmg
#   ./scripts/sign-desktop.sh --notarize      # ...then notarize and staple
#   ./scripts/sign-desktop.sh --verify-only   # report on what's already signed
#
# Identity:
#   FA_MAC_IDENTITY   full identity string; otherwise a "Developer ID Application"
#                     cert is preferred, falling back to "Apple Development"
#                     (fine for running locally, NOT distributable or notarizable).
#
# Notarization auth, best first:
#   FA_NOTARY_PROFILE                        a `notarytool store-credentials` profile
#   FA_ASC_ISSUER_ID + one of:
#     FA_KEY_LOCATION      explicit path to the .p8 (key id read off the filename)
#     FA_ASC_KEY_ID        looked up in ~/.appstoreconnect/private_keys/
#   FA_APPLE_ID + FA_APP_PASSWORD + FA_TEAM_ID   app-specific password

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
APP="$ROOT/src-tauri/target/release/bundle/macos/Meowtrix.app"
ENTITLEMENTS="$ROOT/src-tauri/Entitlements.plist"
OUT_DMG="$ROOT/build/release-mac/dmg/Meowtrix-signed.dmg"
VOLUME_NAME="Meowtrix"

NOTARIZE=0
VERIFY_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --notarize)    NOTARIZE=1; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    -h|--help)     sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "!! unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -d "$APP" ] || {
  echo "!! no app bundle at: $APP" >&2
  echo "   build it first: ./scripts/release-mac.sh" >&2
  exit 1
}

# ---------------------------------------------------------------- identity
pick_identity() {
  if [ -n "${FA_MAC_IDENTITY:-}" ]; then echo "$FA_MAC_IDENTITY"; return; fi
  local devid
  devid="$(security find-identity -v -p codesigning 2>/dev/null \
            | grep "Developer ID Application" | head -1 \
            | sed 's/.*"\(.*\)".*/\1/')"
  if [ -n "$devid" ]; then echo "$devid"; return; fi
  security find-identity -v -p codesigning 2>/dev/null \
    | grep "Apple Development" | head -1 | sed 's/.*"\(.*\)".*/\1/'
}

IDENTITY="$(pick_identity)"
[ -n "$IDENTITY" ] || {
  echo "!! no code signing identity in the keychain." >&2
  echo "   Xcode > Settings > Accounts > Manage Certificates > + " >&2
  exit 1
}

DISTRIBUTABLE=1
case "$IDENTITY" in
  *"Developer ID Application"*) ;;
  *) DISTRIBUTABLE=0 ;;
esac

echo "==> identity: $IDENTITY"
if [ "$DISTRIBUTABLE" -eq 0 ]; then
  cat <<'EOF'

   !! This is a DEVELOPMENT certificate, not "Developer ID Application".
      The signed app will run on this Mac, but it cannot be notarized and
      Gatekeeper will refuse it on anyone else's machine.

      To fix: Xcode > Settings > Accounts > select the team >
      Manage Certificates > + > Developer ID Application.
      Only the Account Holder of the developer program can create one.

      Continuing so the pipeline can be verified end to end.

EOF
fi

# ------------------------------------------------------------------ verify
report() {
  echo "==> verifying"
  codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/    /' || true
  echo "==> entitlements on the app"
  codesign -d --entitlements - --xml "$APP" 2>/dev/null \
    | plutil -convert xml1 -o - - 2>/dev/null | grep -E "<key>|<true|<false" | sed 's/^/    /' || true
  echo "==> Gatekeeper assessment"
  spctl -a -vvv -t exec "$APP" 2>&1 | sed 's/^/    /' || true
}

if [ "$VERIFY_ONLY" -eq 1 ]; then report; exit 0; fi

# -------------------------------------------------------------------- sign
echo "==> signing nested frameworks/binaries if present"
if [ -d "$APP/Contents/Frameworks" ]; then
  find "$APP/Contents/Frameworks" -type f -perm +111 -exec codesign --force --sign "$IDENTITY" --timestamp --options runtime {} +
fi

echo "==> signing the app bundle"
codesign --force --sign "$IDENTITY" --timestamp --options runtime \
  --entitlements "$ENTITLEMENTS" \
  "$APP"

report

echo "==> checking for get-task-allow (a notarization blocker)"
if codesign -d --entitlements - --xml "$APP" 2>/dev/null \
     | plutil -convert xml1 -o - - 2>/dev/null | grep -q "get-task-allow"; then
  echo "!! get-task-allow is set on the app bundle -- refusing to continue." >&2
  exit 1
fi
echo "    clean"

# --------------------------------------------------------------------- dmg
echo "==> building a DMG from the signed app"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
mkdir -p "$(dirname "$OUT_DMG")"
rm -f "$OUT_DMG"
hdiutil create -volname "$VOLUME_NAME" -srcfolder "$STAGE" \
  -ov -format UDZO "$OUT_DMG" >/dev/null
codesign --force --sign "$IDENTITY" --timestamp "$OUT_DMG"
echo "    $OUT_DMG"

# --------------------------------------------------------------- notarize
if [ "$NOTARIZE" -eq 0 ]; then
  echo
  echo "Signed. To notarize (required before anyone else can open it):"
  echo "  ./scripts/sign-desktop.sh --notarize"
  exit 0
fi

if [ "$DISTRIBUTABLE" -eq 0 ]; then
  echo "!! cannot notarize with a development certificate — see above." >&2
  exit 1
fi

if [ -n "${FA_KEY_LOCATION:-}" ]; then
  ASC_KEY="${FA_KEY_LOCATION/#\~/$HOME}"
  if [ -z "${FA_ASC_KEY_ID:-}" ]; then
    base="$(basename "$ASC_KEY")"; base="${base%.p8}"
    FA_ASC_KEY_ID="${base#AuthKey_}"
  fi
else
  ASC_KEY="$HOME/.appstoreconnect/private_keys/AuthKey_${FA_ASC_KEY_ID:-none}.p8"
  [ -f "$ASC_KEY" ] || ASC_KEY="$HOME/private_keys/AuthKey_${FA_ASC_KEY_ID:-none}.p8"
fi

AUTH=()
if [ -n "${FA_NOTARY_PROFILE:-}" ]; then
  AUTH=(--keychain-profile "$FA_NOTARY_PROFILE")
elif [ -n "${FA_ASC_KEY_ID:-}" ] && [ -n "${FA_ASC_ISSUER_ID:-}" ] && [ -f "$ASC_KEY" ]; then
  AUTH=(--key "$ASC_KEY" --key-id "$FA_ASC_KEY_ID" --issuer "$FA_ASC_ISSUER_ID")
elif [ -n "${FA_APPLE_ID:-}" ] && [ -n "${FA_APP_PASSWORD:-}" ] && [ -n "${FA_TEAM_ID:-}" ]; then
  AUTH=(--apple-id "$FA_APPLE_ID" --password "$FA_APP_PASSWORD" --team-id "$FA_TEAM_ID")
else
  echo "!! no notarization credentials configured." >&2
  exit 1
fi

echo "==> submitting to the notary service (this takes a few minutes)"
xcrun notarytool submit "$OUT_DMG" "${AUTH[@]}" --wait

echo "==> stapling"
xcrun stapler staple "$OUT_DMG"
xcrun stapler staple "$APP"

echo "==> Rebuilding updater artifact from notarized app"
"$ROOT/scripts/sign-updater-artifact.sh" "$APP"

echo "==> final assessment"
spctl -a -vvv -t exec "$APP" 2>&1 | sed 's/^/    /' || true

echo
echo "Done: $OUT_DMG"

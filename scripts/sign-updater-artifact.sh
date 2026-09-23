#!/usr/bin/env bash
# ==============================================================================
# Build, sign, and manifest the Tauri updater artifact from a signed & stapled .app
# ==============================================================================
# Rebuilding the updater tarball from the final signed & stapled .app is critical:
# `tauri build` emits an updater tarball during bundling from the *unsigned* app,
# which would distribute an unsigned/unstapled payload to users on update!

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_NAME="Meowtrix"
APP_SLUG="meowtrix"
REPO_OWNER="tianhaoz95"
REPO_NAME="meowtrix"
TAURI_DIR="$ROOT/src-tauri"

# Default to release bundle path unless provided via $1
APP="${1:-$TAURI_DIR/target/release/bundle/macos/$APP_NAME.app}"
if [ ! -d "$APP" ]; then
  echo "!! Target .app bundle not found at: $APP" >&2
  echo "   Ensure the app has been built, signed, and notarized first." >&2
  exit 1
fi

BUNDLE_DIR="$(dirname "$APP")"
UPDATER_DIR="$BUNDLE_DIR/updater"
mkdir -p "$UPDATER_DIR"

echo "==> Building updater artifact from signed and stapled app: $APP"

# Discard stale pre-signing tarballs left by `tauri build`
for stale in "$BUNDLE_DIR/$APP_NAME.app.tar.gz" "$BUNDLE_DIR/$APP_NAME.app.tar.gz.sig"; do
  if [ -f "$stale" ]; then
    rm -f "$stale"
    echo "    Discarded pre-signing tarball: $stale"
  fi
done

TARBALL="$UPDATER_DIR/$APP_NAME.app.tar.gz"
rm -f "$TARBALL" "$TARBALL.sig"

# COPYFILE_DISABLE=1 is mandatory on macOS. Without it, bsdtar archives macOS
# extended attributes as AppleDouble (._*) files. Tauri's updater unpacks entries
# in order, hits `._<App>.app`, and aborts with a decompression error after downloading.
COPYFILE_DISABLE=1 tar --no-mac-metadata -czf "$TARBALL" \
  -C "$(dirname "$APP")" "$(basename "$APP")"

# Verify 0 AppleDouble entries remain
APPLEDOUBLE=$(python3 -c "
import tarfile, sys
try:
    with tarfile.open(sys.argv[1]) as t:
        print(sum(1 for n in t.getnames() if '._' in n))
except Exception as e:
    sys.exit(1)
" "$TARBALL")

if [ "$APPLEDOUBLE" != "0" ]; then
  echo "!! Error: updater tarball contains $APPLEDOUBLE AppleDouble (._) entries. Updates would fail." >&2
  exit 1
fi
echo "    Verified: 0 AppleDouble metadata entries in archive"

# Resolve updater signing key
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  KEY_FILE="$HOME/.tauri/${APP_SLUG}-updater.key"
  if [ -f "$KEY_FILE" ]; then
    # TAURI_SIGNING_PRIVATE_KEY expects the raw key string, or pass KEY_FILE to tauri signer sign -k
    export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
  else
    echo "!! No updater signing key found." >&2
    echo "   Expected ~/.tauri/${APP_SLUG}-updater.key or TAURI_SIGNING_PRIVATE_KEY set." >&2
    echo "   Generate one with: npx @tauri-apps/cli signer generate -w ~/.tauri/${APP_SLUG}-updater.key" >&2
    exit 1
  fi
fi
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

# Sign the tarball using Tauri CLI
( cd "$ROOT" && npx @tauri-apps/cli signer sign "$TARBALL" >/dev/null )
if [ ! -f "$TARBALL.sig" ]; then
  echo "!! Signing produced no .sig file at $TARBALL.sig" >&2
  exit 1
fi
echo "    Signed: $TARBALL.sig"

# Extract version from tauri.conf.json
VERSION="$(python3 -c "import json; print(json.load(open('$TAURI_DIR/tauri.conf.json'))['version'])")"
ARCH="$(uname -m)"
[ "$ARCH" = "arm64" ] && ARCH="aarch64"
[ "$ARCH" = "x86_64" ] && ARCH="x86_64"

# GitHub Releases sanitizes spaces in filenames to dots (e.g. "My App" -> "My.App")
DOTTED_NAME="$(echo "$APP_NAME" | tr ' ' '.')"
DOWNLOAD_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${VERSION}/${DOTTED_NAME}.app.tar.gz"

python3 - "$VERSION" "$ARCH" "$DOWNLOAD_URL" "$TARBALL.sig" "$UPDATER_DIR/latest.json" <<'PY'
import json, sys, datetime, pathlib
version, arch, download_url, sigfile, out = sys.argv[1:6]
sig = pathlib.Path(sigfile).read_text().strip()

manifest = {
    "version": version,
    "notes": f"Release v{version}",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "platforms": {
        f"darwin-{arch}": {
            "signature": sig,
            "url": download_url
        }
    }
}
pathlib.Path(out).write_text(json.dumps(manifest, indent=2) + "\n")
print(f"    Generated latest.json for darwin-{arch} v{version}")
PY

echo
echo "==> Tauri updater artifacts ready:"
echo "    Tarball:  $TARBALL"
echo "    Sig:      $TARBALL.sig"
echo "    Manifest: $UPDATER_DIR/latest.json"
echo
echo "Upload all three assets to GitHub Release tagged v${VERSION}."
echo "Note: The release MUST be published (not draft or pre-release) for clients to discover it."

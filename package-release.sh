#!/usr/bin/env bash
set -e

# Default settings
NODE_VERSION="20.11.1" # Standard LTS Node.js
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Normalize architecture names
if [ "$ARCH" = "x86_64" ]; then
  ARCH="x64"
elif [ "$ARCH" = "aarch64" ]; then
  ARCH="arm64"
fi

# Print current settings
echo "🐾 Packaging Meowtrix..."
echo "Target OS: $OS"
echo "Target Arch: $ARCH"
echo "Node.js version: v$NODE_VERSION"

# Define directories
BUILD_DIR="build-temp"
DIST_DIR="dist"
PACKAGE_NAME="meowtrix-$OS-$ARCH"
TARGET_DIR="$BUILD_DIR/$PACKAGE_NAME"

# Clean up previous builds
rm -rf "$BUILD_DIR"
rm -rf "$DIST_DIR"
mkdir -p "$TARGET_DIR"
mkdir -p "$DIST_DIR"

# 1. Download and extract Node.js binary for the target OS/Arch
NODE_TARBALL_URL=""
if [ "$OS" = "darwin" ]; then
  NODE_TARBALL_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz"
elif [ "$OS" = "linux" ]; then
  NODE_TARBALL_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz"
else
  echo "Unsupported OS: $OS. Supported OS are: darwin, linux"
  exit 1
fi

echo "→ Downloading Node.js binary..."
curl -fsSL "$NODE_TARBALL_URL" -o "node-binary.tar"

echo "→ Extracting Node.js binary..."
mkdir -p "$BUILD_DIR/node-bin"
if [[ "$NODE_TARBALL_URL" == *.tar.xz ]]; then
  tar -xf "node-binary.tar" -C "$BUILD_DIR/node-bin" --strip-components=1
else
  tar -zxf "node-binary.tar" -C "$BUILD_DIR/node-bin" --strip-components=1
fi
rm "node-binary.tar"

# Copy node executable to target bin/
mkdir -p "$TARGET_DIR/bin"
cp "$BUILD_DIR/node-bin/bin/node" "$TARGET_DIR/bin/node"

# 2. Copy Meowtrix application files (keeping directory structures intact)
echo "→ Copying Meowtrix source files..."
cp -R public "$TARGET_DIR/public"
cp -R bin "$TARGET_DIR/bin-helpers"
# Rename bin-helpers back to bin inside target directory, but wait, target node binary goes to target bin/ too.
# Let's place mtx helper in bin/ alongside node binary.
cp "$TARGET_DIR/bin-helpers/mtx" "$TARGET_DIR/bin/mtx"
rm -rf "$TARGET_DIR/bin-helpers"

cp server.js "$TARGET_DIR/server.js"
cp package.json "$TARGET_DIR/package.json"
cp package-lock.json "$TARGET_DIR/package-lock.json"
cp README.md "$TARGET_DIR/README.md"
cp CLAUDE.md "$TARGET_DIR/CLAUDE.md"

# 3. Install production dependencies inside the target directory
echo "→ Installing dependencies and compiling node-pty..."
# We prepend the target node bin path to PATH to ensure that npm compiles C++ modules 
# against the bundled Node version.
export PATH="$PWD/$BUILD_DIR/node-bin/bin:$PATH"
cd "$TARGET_DIR"
npm install --omit=dev --silent
cd - > /dev/null

# 4. Create the launcher script
echo "→ Creating launcher script..."
cat > "$TARGET_DIR/meowtrix" <<'EOF'
#!/usr/bin/env bash
# Determine local path of execution in a portable way
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
HERE="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"

# Run node on server.js passing through args
"$HERE/bin/node" "$HERE/server.js" "$@"
EOF
chmod +x "$TARGET_DIR/meowtrix"

# 5. Compress the build
echo "→ Creating archive package..."
tar -czf "$DIST_DIR/$PACKAGE_NAME.tar.gz" -C "$BUILD_DIR" "$PACKAGE_NAME"

# Clean build temp
rm -rf "$BUILD_DIR"

echo "✅ Package created successfully!"
echo "   File: $DIST_DIR/$PACKAGE_NAME.tar.gz"
echo "   To deploy, copy this file, extract it, and run './meowtrix'"

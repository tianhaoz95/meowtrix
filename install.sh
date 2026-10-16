#!/usr/bin/env bash
# Meowtrix moved to the HEJI apps monorepo: https://github.com/tianhaoz95/hejitech-apps
# (projects/meowtrix). This forwards to its installer with the same flags.
set -euo pipefail
echo "🐾 Meowtrix moved to github.com/tianhaoz95/hejitech-apps (projects/meowtrix); using its installer."
curl -fsSL https://raw.githubusercontent.com/tianhaoz95/hejitech-apps/main/projects/meowtrix/install.sh | bash -s -- "$@"

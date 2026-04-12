#!/bin/bash
set -euo pipefail

APP_BINARY="/opt/Spaluter Desktop/spaluter-desktop"
SYMLINK_PATH="/usr/local/bin/spaluter-desktop"

if [ -x "$APP_BINARY" ]; then
  ln -sf "$APP_BINARY" "$SYMLINK_PATH"
fi

if ! command -v sclang >/dev/null 2>&1; then
  echo "Spaluter Desktop installed, but SuperCollider (sclang) was not found in PATH." >&2
  echo "Install it with: sudo apt install supercollider" >&2
  echo "Or set SCLANG_PATH before launching the app." >&2
fi

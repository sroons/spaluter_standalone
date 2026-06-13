#!/usr/bin/env bash
# Re-render the SPILUTER mockups from the HTML/CSS sources to PNG.
# Requires Google Chrome (headless). Outputs at 2x of the 1024x600 Pi surface.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$(dirname "$SRC_DIR")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

for src in 01_perform 02_edit 03_mods 04_presets; do
  case "$src" in
    03_mods)     out="03_modulation" ;;
    04_presets)  out="04_presets" ;;
    *)       out="$src" ;;
  esac
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=1024,600 \
    --virtual-time-budget=2500 --default-background-color=00000000 \
    --screenshot="$OUT_DIR/${out}.png" "file://$SRC_DIR/${src}.html"
  echo "rendered ${out}.png"
done

#!/usr/bin/env bash
# Pi-side recorder for Spaluter (X11 + PipeWire/Pisound, Raspberry Pi 4).
#
# Single hardware-encoded pass: captures the X display (:0, 1024x600) plus the
# PipeWire monitor of the Pisound sink (which carries scsynth's output) into one
# file. Records to a robust .mkv first (valid even if interrupted), then losslessly
# remuxes to .mp4 and removes the .mkv.
#
# This script is deployed and driven by scripts/record-demo.sh on the Mac, but can
# also be run directly on the Pi:  spaluter-pi-record.sh [output.mp4]
#
# Stop with q (preferred) or Ctrl-C. Set DURATION=<seconds> for a fixed-length,
# self-stopping capture (used by tests / unattended recordings).
set -uo pipefail

OUT="${1:-$HOME/spaluter-$(date +%Y%m%d-%H%M%S).mp4}"
TMP="${OUT%.*}.mkv"
DISP="${DISP:-:0.0}"
SIZE="${SIZE:-1024x600}"
FPS="${FPS:-30}"
AUDIO_SRC="${AUDIO_SRC:-alsa_output.platform-soc_sound.stereo-fallback.monitor}"
VBITRATE="${VBITRATE:-6M}"

dur_args=()
[ -n "${DURATION:-}" ] && dur_args=(-t "$DURATION")

echo "Recording ${SIZE}@${FPS} + ${AUDIO_SRC}  (press q to stop)"
ffmpeg -hide_banner -y \
  -thread_queue_size 512 -f x11grab -framerate "$FPS" -video_size "$SIZE" -i "$DISP" \
  -thread_queue_size 512 -f pulse -i "$AUDIO_SRC" \
  -c:v h264_v4l2m2m -b:v "$VBITRATE" -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  "${dur_args[@]}" \
  "$TMP"

echo "Remuxing -> ${OUT}"
ffmpeg -hide_banner -loglevel error -y -i "$TMP" -c copy "$OUT" && rm -f "$TMP"
echo "Done: ${OUT}"

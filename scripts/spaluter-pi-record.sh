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
#
# Real-time protection (avoids audio xruns/dropouts while recording on the Pi 4):
#   * Temporarily raises the PipeWire quantum to REC_QUANTUM (default 2048 = ~43ms)
#     so scsynth gets ~2x deadline headroom; reverts to dynamic on exit.
#   * Runs ffmpeg with nice + taskset so it cannot preempt the audio thread.
#   * Defaults to 24 fps to cut framebuffer-read/encode load.
# Tunables: REC_QUANTUM (0 disables), REC_CPUS (cores for ffmpeg, "" disables
# pinning), REC_NICE.
set -uo pipefail

OUT="${1:-$HOME/spaluter-$(date +%Y%m%d-%H%M%S).mp4}"
TMP="${OUT%.*}.mkv"
DISP="${DISP:-:0.0}"
SIZE="${SIZE:-1024x600}"
FPS="${FPS:-24}"
AUDIO_SRC="${AUDIO_SRC:-alsa_output.platform-soc_sound.stereo-fallback.monitor}"
VBITRATE="${VBITRATE:-6M}"
REC_QUANTUM="${REC_QUANTUM:-2048}"
REC_CPUS="${REC_CPUS-2,3}"
REC_NICE="${REC_NICE:-19}"

dur_args=()
[ -n "${DURATION:-}" ] && dur_args=(-t "$DURATION")

# Give the real-time audio graph more headroom for the duration of the capture.
restore_quantum() { pw-metadata -n settings 0 clock.force-quantum 0 >/dev/null 2>&1 || true; }
if [ "$REC_QUANTUM" != "0" ] && command -v pw-metadata >/dev/null 2>&1; then
  trap restore_quantum EXIT INT TERM
  pw-metadata -n settings 0 clock.force-quantum "$REC_QUANTUM" >/dev/null 2>&1 || true
fi

# Keep ffmpeg from preempting scsynth: low priority + pin to non-audio cores.
launcher=(nice -n "$REC_NICE")
if [ -n "$REC_CPUS" ] && command -v taskset >/dev/null 2>&1; then
  launcher+=(taskset -c "$REC_CPUS")
fi

echo "Recording ${SIZE}@${FPS} + ${AUDIO_SRC}  (press q to stop)"
"${launcher[@]}" ffmpeg -hide_banner -y \
  -thread_queue_size 1024 -f x11grab -framerate "$FPS" -video_size "$SIZE" -i "$DISP" \
  -thread_queue_size 1024 -f pulse -i "$AUDIO_SRC" \
  -c:v h264_v4l2m2m -b:v "$VBITRATE" -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  "${dur_args[@]}" \
  "$TMP"

echo "Remuxing -> ${OUT}"
ffmpeg -hide_banner -loglevel error -y -i "$TMP" -c copy "$OUT" && rm -f "$TMP"
echo "Done: ${OUT}"

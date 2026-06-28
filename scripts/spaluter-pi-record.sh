#!/usr/bin/env bash
# Pi-side recorder for Spaluter (X11 + PipeWire/Pisound, Raspberry Pi 4).
#
# Captures the X display (:0, 1024x600) plus the synth audio into one .mp4.
#
# AUDIO_MODE (default: decoupled)
#   decoupled  Audio is captured by a dedicated pw-record client (independent of
#              the video encoder, so encoder/CPU stalls can't drop samples) while
#              ffmpeg captures video only; the two are muxed at the end. Cleanest.
#   monitor    Single ffmpeg pass: x11grab video + pulse audio from the sink
#              monitor in one file. Simpler, slightly more dropout-prone.
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
# pinning), REC_NICE, AV_OFFSET (seconds to shift audio in decoupled mux).
set -uo pipefail

OUT="${1:-$HOME/spaluter-$(date +%Y%m%d-%H%M%S).mp4}"
DISP="${DISP:-:0.0}"
SIZE="${SIZE:-1024x600}"
FPS="${FPS:-24}"
AUDIO_SRC="${AUDIO_SRC:-alsa_output.platform-soc_sound.stereo-fallback.monitor}"
VBITRATE="${VBITRATE:-6M}"
REC_QUANTUM="${REC_QUANTUM:-2048}"
REC_CPUS="${REC_CPUS-2,3}"
REC_NICE="${REC_NICE:-19}"
AUDIO_MODE="${AUDIO_MODE:-decoupled}"
AV_OFFSET="${AV_OFFSET:-0}"
# Optional scripted UI tour (xdotool). When CHOREO points at an executable, the
# recorder starts capture, waits LEAD_IN, runs the choreography, waits TAIL, then
# stops the encoder — so the clip length auto-matches the tour (no q / DURATION).
CHOREO="${CHOREO:-}"
LEAD_IN="${LEAD_IN:-1.5}"
TAIL="${TAIL:-1.5}"

base="${OUT%.*}"
TMP_MKV="${base}.mkv"
TMP_V="${base}.video.mkv"
TMP_A="${base}.audio.wav"

dur_args=()
[ -n "${DURATION:-}" ] && dur_args=(-t "$DURATION")

# Restore PipeWire quantum and remove any leftover temp files on exit.
cleanup() {
  pw-metadata -n settings 0 clock.force-quantum 0 >/dev/null 2>&1 || true
  rm -f "$TMP_MKV" "$TMP_V" "$TMP_A" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Give the real-time audio graph more headroom for the duration of the capture.
if [ "$REC_QUANTUM" != "0" ] && command -v pw-metadata >/dev/null 2>&1; then
  pw-metadata -n settings 0 clock.force-quantum "$REC_QUANTUM" >/dev/null 2>&1 || true
fi

# Keep ffmpeg from preempting scsynth: low priority + pin to non-audio cores.
launcher=(nice -n "$REC_NICE")
if [ -n "$REC_CPUS" ] && command -v taskset >/dev/null 2>&1; then
  launcher+=(taskset -c "$REC_CPUS")
fi

# Run the scripted UI tour against a running encoder (PID $1): let a little video
# roll first (LEAD_IN), perform the tour, hold briefly (TAIL), then SIGINT the
# encoder so it finalises the file. Recording length tracks the tour length.
run_choreography() {
  local pid="$1"
  sleep "$LEAD_IN"
  echo "Running choreography: $CHOREO"
  DISPLAY="${DISP%.*}" "$CHOREO" || true
  sleep "$TAIL"
  kill -INT "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

if [ "$AUDIO_MODE" = "monitor" ]; then
  echo "Recording (monitor mode) ${SIZE}@${FPS} + ${AUDIO_SRC}  (press q to stop)"
  mon_cmd=("${launcher[@]}" ffmpeg -hide_banner -y
    -thread_queue_size 1024 -f x11grab -framerate "$FPS" -video_size "$SIZE" -i "$DISP"
    -thread_queue_size 1024 -f pulse -i "$AUDIO_SRC"
    -c:v h264_v4l2m2m -b:v "$VBITRATE" -pix_fmt yuv420p
    -c:a aac -b:a 192k)
  if [ -n "$CHOREO" ]; then
    "${mon_cmd[@]}" "$TMP_MKV" &
    run_choreography "$!"
  else
    "${mon_cmd[@]}" "${dur_args[@]}" "$TMP_MKV"
  fi
  echo "Remuxing -> ${OUT}"
  ffmpeg -hide_banner -loglevel error -y -i "$TMP_MKV" -c copy "$OUT" && rm -f "$TMP_MKV"
  echo "Done: ${OUT}"
  exit 0
fi

# --- decoupled mode ---
echo "Recording (decoupled) ${SIZE}@${FPS} + ${AUDIO_SRC}  (press q to stop)"

# Dedicated audio capture: native PipeWire client with a generous buffer so it
# never underruns even if the video encoder/CPU stalls. Run at normal priority.
pw-record --target "$AUDIO_SRC" --rate 48000 --channels 2 --format s32 --latency 200ms "$TMP_A" &
APID=$!

# Video only (no audio) — hardware encoded, de-prioritised and CPU-pinned.
vid_cmd=("${launcher[@]}" ffmpeg -hide_banner -y
  -thread_queue_size 1024 -f x11grab -framerate "$FPS" -video_size "$SIZE" -i "$DISP"
  -an -c:v h264_v4l2m2m -b:v "$VBITRATE" -pix_fmt yuv420p)
if [ -n "$CHOREO" ]; then
  "${vid_cmd[@]}" "$TMP_V" &
  run_choreography "$!"
else
  "${vid_cmd[@]}" "${dur_args[@]}" "$TMP_V"
fi

# Stop the audio capture and let it finalise the WAV.
kill -INT "$APID" 2>/dev/null || true
wait "$APID" 2>/dev/null || true

echo "Muxing audio + video -> ${OUT}"
ffmpeg -hide_banner -loglevel error -y \
  -i "$TMP_V" \
  -itsoffset "$AV_OFFSET" -i "$TMP_A" \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k -shortest \
  "$OUT" && rm -f "$TMP_V" "$TMP_A"
echo "Done: ${OUT}"

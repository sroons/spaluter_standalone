#!/usr/bin/env bash
# Mac-side orchestrator: record a screen+audio demo on the Pi, copy the finished
# .mp4 to this machine, then delete it from the Pi.
#
#   scripts/record-demo.sh [name]
#
# The Pi captures its X display (:0, 1024x600) plus the Pisound sink monitor
# (scsynth's output) in one hardware-encoded pass. Press q in this terminal to
# stop (or Ctrl-C). The finished .mp4 is copied into $DEST and removed from the Pi.
#
# Config via environment:
#   SSH_HOST   SSH target for the Pi              (default: patch@patchbox.local)
#   DEST       local directory for recordings     (default: ~/Movies/spaluter)
#   DURATION   fixed length in seconds, optional  (auto-stops; skips q)
#   FPS SIZE VBITRATE AUDIO_SRC DISP              forwarded to the Pi recorder
#   AUDIO_MODE AV_OFFSET                          decoupled (default) | monitor
#   REC_QUANTUM REC_CPUS REC_NICE                 RT-protection tunables (see recorder)
#   CHOREO     run the scripted UI guided tour    (any non-empty value; auto-stops)
#   LEAD_IN TAIL                                  seconds of capture before/after the tour
set -uo pipefail

SSH_HOST="${SSH_HOST:-patch@patchbox.local}"
DEST="${DEST:-$HOME/Movies/spaluter}"
REMOTE_DIR="${REMOTE_DIR:-/tmp}"
PI_SCRIPT_SRC="$(cd "$(dirname "$0")" && pwd)/spaluter-pi-record.sh"
PI_SCRIPT_DST="${PI_SCRIPT_DST:-/tmp/spaluter-pi-record.sh}"
PI_CHOREO_SRC="$(cd "$(dirname "$0")" && pwd)/spaluter-pi-choreography.sh"
PI_CHOREO_DST="${PI_CHOREO_DST:-/tmp/spaluter-pi-choreography.sh}"
PI_DETECT_SRC="$(cd "$(dirname "$0")" && pwd)/spaluter-detect-handle.py"
PI_DETECT_DST="${PI_DETECT_DST:-/tmp/spaluter-detect-handle.py}"

name="${1:-spaluter-$(date +%Y%m%d-%H%M%S)}"
name="${name%.mp4}"
remote_mp4="${REMOTE_DIR}/${name}.mp4"
mkdir -p "$DEST"

echo "Deploying recorder to ${SSH_HOST} ..."
scp -q "$PI_SCRIPT_SRC" "${SSH_HOST}:${PI_SCRIPT_DST}" || { echo "Failed to copy recorder to Pi" >&2; exit 1; }
scp -q "$PI_CHOREO_SRC" "${SSH_HOST}:${PI_CHOREO_DST}" || { echo "Failed to copy choreography to Pi" >&2; exit 1; }
scp -q "$PI_DETECT_SRC" "${SSH_HOST}:${PI_DETECT_DST}" || { echo "Failed to copy handle detector to Pi" >&2; exit 1; }
ssh "$SSH_HOST" "chmod +x ${PI_SCRIPT_DST} ${PI_CHOREO_DST} ${PI_DETECT_DST}"

# Forward any tuning vars that are set in this environment.
remote_env=""
for v in DURATION FPS SIZE VBITRATE AUDIO_SRC DISP REC_QUANTUM REC_CPUS REC_NICE AUDIO_MODE AV_OFFSET LEAD_IN TAIL; do
  if [ -n "${!v:-}" ]; then remote_env+="${v}=${!v} "; fi
done
# A non-empty CHOREO selects the scripted guided tour (deployed above).
if [ -n "${CHOREO:-}" ]; then remote_env+="CHOREO=${PI_CHOREO_DST} "; fi

echo "Recording on Pi -> ${remote_mp4}"
if [ -n "${CHOREO:-}" ]; then
  echo "Running scripted guided tour; recording stops automatically when it ends."
else
  echo "Press q to stop."
fi
ssh -t "$SSH_HOST" "${remote_env}${PI_SCRIPT_DST} ${remote_mp4}" || true

if ! ssh "$SSH_HOST" "test -s ${remote_mp4}"; then
  echo "No recording was produced on the Pi (nothing to copy)." >&2
  exit 1
fi

echo "Copying to ${DEST}/ ..."
if scp -q "${SSH_HOST}:${remote_mp4}" "${DEST}/"; then
  echo "Deleting from Pi ..."
  ssh "$SSH_HOST" "rm -f ${remote_mp4}"
  echo "Saved: ${DEST}/${name}.mp4"
else
  echo "Copy failed; leaving file on the Pi at ${remote_mp4}" >&2
  exit 1
fi

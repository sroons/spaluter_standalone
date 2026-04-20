#!/bin/bash
set -euo pipefail

LAUNCHER_PATH="/usr/local/bin/spaluter-desktop"
STARTUP_SCRIPT_PATH="/usr/local/bin/spaluter-linux-startup"
SETUP_SCRIPT_PATH="/usr/local/bin/spaluter-rpi-setup"
APP_BINARY=""

for candidate in \
  "/opt/Spaluter Desktop/spaluter-desktop" \
  "/opt/spaluter-desktop/spaluter-desktop" \
  "/opt/Spaluter Desktop/Spaluter Desktop"; do
  if [ -x "$candidate" ]; then
    APP_BINARY="$candidate"
    break
  fi
done

if [ -n "$APP_BINARY" ]; then
  # electron-builder may install /usr/local/bin/spaluter-desktop as a symlink
  # to the app binary. Remove it first so we don't overwrite the binary target.
  rm -f "$LAUNCHER_PATH"
  cat >"$LAUNCHER_PATH" <<EOF
#!/bin/bash
set -euo pipefail
APP_BINARY='$APP_BINARY'
STARTUP_SCRIPT='$STARTUP_SCRIPT_PATH'

if [ -x "\$STARTUP_SCRIPT" ]; then
  if ! "\$STARTUP_SCRIPT"; then
    echo "Spaluter startup bootstrap reported issues; continuing launch." >&2
  fi
fi

if command -v pw-jack >/dev/null 2>&1; then
  exec pw-jack "\$APP_BINARY" "\$@"
fi

echo "pw-jack not found in PATH; launching Spaluter Desktop without PipeWire JACK wrapper." >&2
exec "\$APP_BINARY" "\$@"
EOF
  chmod 755 "$LAUNCHER_PATH"

  mapfile -t desktop_files < <(grep -rl --include="*.desktop" "spaluter-desktop" /usr/share/applications 2>/dev/null || true)
  for desktop_file in "${desktop_files[@]}"; do
    sed -i "s|^Exec=.*spaluter-desktop.*|Exec=${LAUNCHER_PATH} %U|" "$desktop_file"
  done
else
  echo "Spaluter Desktop installed, but app binary was not found at expected paths." >&2
  echo "Skipping launcher creation for ${LAUNCHER_PATH}." >&2
fi

cat >"$STARTUP_SCRIPT_PATH" <<'EOF'
#!/bin/bash
set -euo pipefail

log_warn() {
  echo "[spaluter-linux-startup] $*" >&2
}

if command -v systemctl >/dev/null 2>&1; then
  if ! systemctl --user start wireplumber pipewire pipewire-pulse >/dev/null 2>&1; then
    log_warn "Could not start one or more user services: wireplumber pipewire pipewire-pulse"
  fi
fi

if command -v aconnect >/dev/null 2>&1; then
  if ! aconnect -l >/dev/null 2>&1; then
    log_warn "ALSA MIDI sequencer is unavailable (aconnect -l failed)."
  fi
else
  log_warn "MIDI utility 'aconnect' not found; install alsa-utils."
fi

if command -v pactl >/dev/null 2>&1; then
  if ! pactl info >/dev/null 2>&1; then
    log_warn "PipeWire/PulseAudio control path is unavailable (pactl info failed)."
  fi
else
  log_warn "Audio utility 'pactl' not found; install pulseaudio-utils."
fi

if ! command -v sclang >/dev/null 2>&1; then
  log_warn "SuperCollider binary 'sclang' not found in PATH."
elif ! sclang -v >/dev/null 2>&1; then
  log_warn "SuperCollider did not respond correctly to version probe."
fi
EOF
chmod 755 "$STARTUP_SCRIPT_PATH"

cat >"$SETUP_SCRIPT_PATH" <<'EOF'
#!/bin/bash
set -euo pipefail

STAMP_DIR="/var/lib/spaluter"
STAMP_FILE="${STAMP_DIR}/rpi-setup.done"
AUTO_MODE=0
FORCE_MODE=0

for arg in "$@"; do
  case "$arg" in
    --auto) AUTO_MODE=1 ;;
    --force) FORCE_MODE=1 ;;
  esac
done

if [ "$AUTO_MODE" -eq 1 ]; then
  sleep 20
fi

if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo "$0" "$@"
  fi
  echo "This script requires root privileges. Re-run as root." >&2
  exit 1
fi

ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
case "$ARCH" in
  arm64|armhf|aarch64|armv7l) ;;
  *)
    echo "Skipping Raspberry Pi setup on unsupported architecture: $ARCH"
    exit 0
    ;;
esac

if [ "$FORCE_MODE" -eq 0 ] && [ "$AUTO_MODE" -eq 1 ] && [ -f "$STAMP_FILE" ]; then
  echo "Spaluter RPi setup already completed; skipping."
  exit 0
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This setup script currently supports Raspberry Pi OS / Debian (apt-get required)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
APT_ARGS=(-o DPkg::Lock::Timeout=600)

apt-get "${APT_ARGS[@]}" update
apt-get "${APT_ARGS[@]}" install -y --no-install-recommends \
  supercollider supercollider-language supercollider-server \
  pipewire pipewire-pulse pipewire-jack wireplumber pulseaudio-utils

if command -v systemctl >/dev/null 2>&1; then
  if ! systemctl --global enable pipewire.service pipewire-pulse.service wireplumber.service >/dev/null 2>&1; then
    echo "Warning: failed to globally enable PipeWire/WirePlumber user services." >&2
  fi
fi

mkdir -p "$STAMP_DIR"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$STAMP_FILE"

echo "Spaluter Raspberry Pi dependency setup completed."
echo "Launch command: pw-jack \"/opt/Spaluter Desktop/spaluter-desktop\""
EOF
chmod 755 "$SETUP_SCRIPT_PATH"

ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
if command -v apt-get >/dev/null 2>&1 && [[ "$ARCH" =~ ^(arm64|armhf|aarch64|armv7l)$ ]]; then
  SETUP_LOG_PATH="/var/log/spaluter-rpi-setup.log"
  if nohup "$SETUP_SCRIPT_PATH" --auto >"$SETUP_LOG_PATH" 2>&1 & then
    echo "Started Raspberry Pi dependency bootstrap in background (${SETUP_LOG_PATH})."
  else
    echo "Warning: failed to start automatic Raspberry Pi dependency bootstrap." >&2
    echo "Run '${SETUP_SCRIPT_PATH}' manually to install dependencies." >&2
  fi
fi

if ! command -v sclang >/dev/null 2>&1; then
  echo "Spaluter Desktop installed, but SuperCollider (sclang) was not found in PATH." >&2
  echo "Install it with: sudo apt install supercollider" >&2
  echo "Or set SCLANG_PATH before launching the app." >&2
fi

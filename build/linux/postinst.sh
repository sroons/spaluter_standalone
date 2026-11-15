#!/bin/bash
set -euo pipefail

LAUNCHER_PATH="/usr/local/bin/spaluter-desktop"
STARTUP_SCRIPT_PATH="/usr/local/bin/spaluter-linux-startup"
SETUP_SCRIPT_PATH="/usr/local/bin/spaluter-rpi-setup"
PIN_SCRIPT_PATH="/usr/local/bin/spaluter-pin-scsynth"
MEASURE_SCRIPT_PATH="/usr/local/bin/spaluter-measure"
IRQ_SCRIPT_PATH="/usr/local/bin/spaluter-irq-affinity"
IRQ_UNIT_PATH="/etc/systemd/system/spaluter-irq-affinity.service"
PIPEWIRE_DROPIN_PATH="/etc/pipewire/pipewire.conf.d/50-spaluter.conf"
WIREPLUMBER_RULE_PATH="/etc/wireplumber/main.lua.d/51-spaluter-disable-onboard-audio.lua"
APP_BINARY=""
PAYLOAD_DIR=""

ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
IS_PI_ARCH=0
if [[ "$ARCH" =~ ^(arm64|armhf|aarch64|armv7l)$ ]]; then
  IS_PI_ARCH=1
fi

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
PIN_SCRIPT='$PIN_SCRIPT_PATH'

# Core plan on a 4-core Raspberry Pi: Electron (every process) and sclang on
# CPUs 0-2, scsynth on CPU 3. The app is started under taskset so its children
# inherit the UI mask; spaluter-pin-scsynth then moves scsynth's threads to
# the DSP core as they appear. Override with SPALUTER_UI_CPUS / SPALUTER_DSP_CPUS,
# or set either to "none" to leave placement to the kernel. Nothing here
# changes scheduling priorities: scsynth's audio thread already runs
# SCHED_FIFO under pipewire-jack.
UI_CPUS="\${SPALUTER_UI_CPUS:-0-2}"
DSP_CPUS="\${SPALUTER_DSP_CPUS:-3}"

if [ -x "\$STARTUP_SCRIPT" ]; then
  if ! "\$STARTUP_SCRIPT"; then
    echo "Spaluter startup bootstrap reported issues; continuing launch." >&2
  fi
fi

launch=()
if [ "\$(nproc 2>/dev/null || echo 1)" -ge 4 ] && command -v taskset >/dev/null 2>&1; then
  if [ "\$UI_CPUS" != "none" ]; then
    launch=(taskset -c "\$UI_CPUS")
  fi
  if [ "\$DSP_CPUS" != "none" ] && [ -x "\$PIN_SCRIPT" ]; then
    "\$PIN_SCRIPT" "\$\$" "\$DSP_CPUS" &
  fi
fi

if command -v pw-jack >/dev/null 2>&1; then
  exec "\${launch[@]}" pw-jack "\$APP_BINARY" "\$@"
fi

echo "pw-jack not found in PATH; launching Spaluter Desktop without PipeWire JACK wrapper." >&2
exec "\${launch[@]}" "\$APP_BINARY" "\$@"
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

# Runtime payload shipped in resources/linux-payload (see build/linux/payload
# in the source tree): the scsynth core-pin watcher and the measurement script
# on every Linux install; the PipeWire quantum drop-in, the WirePlumber rule
# that disables the Pi's unused onboard audio cards, and the IRQ-affinity unit
# on Raspberry Pi (ARM) installs only. None of these steps may fail the install.
for candidate in \
  "/opt/Spaluter Desktop/resources/linux-payload" \
  "/opt/spaluter-desktop/resources/linux-payload"; do
  if [ -d "$candidate" ]; then
    PAYLOAD_DIR="$candidate"
    break
  fi
done

if [ -n "$PAYLOAD_DIR" ]; then
  install -m 755 "$PAYLOAD_DIR/spaluter-pin-scsynth" "$PIN_SCRIPT_PATH" 2>/dev/null \
    || echo "Warning: could not install ${PIN_SCRIPT_PATH}." >&2
  install -m 755 "$PAYLOAD_DIR/spaluter-measure" "$MEASURE_SCRIPT_PATH" 2>/dev/null \
    || echo "Warning: could not install ${MEASURE_SCRIPT_PATH}." >&2

  if [ "$IS_PI_ARCH" -eq 1 ]; then
    if install -D -m 644 "$PAYLOAD_DIR/50-spaluter.conf" "$PIPEWIRE_DROPIN_PATH" 2>/dev/null; then
      echo "Installed ${PIPEWIRE_DROPIN_PATH} (PipeWire graph quantum). Takes effect after 'systemctl --user restart pipewire wireplumber' or a reboot."
    else
      echo "Warning: could not install ${PIPEWIRE_DROPIN_PATH}." >&2
    fi
    install -D -m 644 "$PAYLOAD_DIR/51-spaluter-disable-onboard-audio.lua" "$WIREPLUMBER_RULE_PATH" 2>/dev/null \
      || echo "Warning: could not install ${WIREPLUMBER_RULE_PATH}." >&2
    install -m 755 "$PAYLOAD_DIR/spaluter-irq-affinity" "$IRQ_SCRIPT_PATH" 2>/dev/null \
      || echo "Warning: could not install ${IRQ_SCRIPT_PATH}." >&2
    if install -m 644 "$PAYLOAD_DIR/spaluter-irq-affinity.service" "$IRQ_UNIT_PATH" 2>/dev/null \
      && command -v systemctl >/dev/null 2>&1; then
      systemctl daemon-reload >/dev/null 2>&1 || true
      if ! systemctl enable --now spaluter-irq-affinity.service >/dev/null 2>&1; then
        echo "Warning: could not enable spaluter-irq-affinity.service (no systemd or no /proc/irq?)." >&2
      fi
    fi
  fi
else
  echo "Warning: linux-payload directory not found; skipping runtime tuning files." >&2
fi

if command -v apt-get >/dev/null 2>&1 && [ "$IS_PI_ARCH" -eq 1 ]; then
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

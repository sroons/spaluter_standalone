#!/bin/bash
set -euo pipefail

LAUNCHER_PATH="/usr/local/bin/spaluter-desktop"
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
  cat >"$LAUNCHER_PATH" <<EOF
#!/bin/bash
set -euo pipefail
APP_BINARY='$APP_BINARY'

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

if ! command -v sclang >/dev/null 2>&1; then
  echo "Spaluter Desktop installed, but SuperCollider (sclang) was not found in PATH." >&2
  echo "Install it with: sudo apt install supercollider" >&2
  echo "Or set SCLANG_PATH before launching the app." >&2
fi

#!/usr/bin/env bash
# Pi-side UI choreography for Spaluter: a scripted "guided tour" that drives the
# live Chromium UI with xdotool while a recording is in progress.
#
# It visits every screen (PERFORM -> EDIT -> MODS -> EFFECTS -> PRESETS -> home)
# and performs a few visible gestures on each. Every gesture is STATE-PRESERVING:
#   * faders are grabbed at their *detected* current handle pixel, swept to a
#     peak, then swept back to exactly that pixel, so the value is unchanged;
#   * toggle buttons are switched and then switched back;
#   * preset rows are only previewed (selected) -- never RECALL'd -- and the
#     original selection is restored at the end.
# So running the tour leaves the instrument exactly as it was found.
#
# Robustness: navigation is *verified* -- after each tab click we screenshot and
# confirm the tab actually became active (its background lights up), retrying a
# few times, because a single click is occasionally dropped.
#
# Normally launched by spaluter-pi-record.sh (CHOREO=...), but can be run alone:
#   DISPLAY=:0 ./spaluter-pi-choreography.sh
#
# Needs: xdotool, scrot, python3 + PIL (for verification/handle detection). If
# python/PIL are missing it degrades to best-effort clicks with fixed pixels.
# Coordinates are for the fixed 1024x600 touchscreen layout.
set -uo pipefail
export DISPLAY="${DISPLAY:-:0}"

if [ "${1:-}" = "--duration" ]; then echo 60; exit 0; fi

DET="${HANDLE_DETECT:-$(cd "$(dirname "$0")" && pwd)/spaluter-detect-handle.py}"
NAV_Y=573                          # navigation row
PARK_X=1015; PARK_Y=520            # neutral spot to rest the cursor between moves
NV=/tmp/_ch_nv.png; HP=/tmp/_ch_h.png

cleanup() { rm -f "$NV" "$HP" 2>/dev/null || true; }
trap cleanup EXIT

step() { printf '  · %s\n' "$1"; }
park() { xdotool mousemove "$PARK_X" "$PARK_Y"; sleep "${1:-0.4}"; }
tap()  { xdotool mousemove "$1" "$2" click 1; sleep "${3:-0.6}"; }

# Scroll the wheel over (x,y): w=5 scrolls down, w=4 scrolls up. Scrolling past an
# end is a harmless no-op, so an over-long scroll-up reliably restores the top.
scroll() { # x y w count pause
  local x="$1" y="$2" w="$3" n="${4:-5}" i
  for ((i=0; i<n; i++)); do xdotool mousemove "$x" "$y" click "$w"; sleep "${5:-0.18}"; done
}

# Is the tab whose centre is nav_x currently the active screen? Its background
# lights up (band brightness ~620+ active vs ~90 inactive). Empty => unknown.
is_active() {
  python3 - "$1" "$NV" <<'PY' 2>/dev/null
import sys
from PIL import Image
x = int(sys.argv[1])
p = Image.open(sys.argv[2]).convert("RGB").load()
b = sum(sum(p[x, yy]) for yy in range(556, 568)) // 12
print(1 if b > 300 else 0)
PY
}

# Navigate to a screen by nav-button x, verifying the switch (retry up to 5x).
goto() {
  local x="$1" i act
  for i in 1 2 3 4 5; do
    xdotool mousemove "$x" "$NAV_Y" click 1; sleep 1.0
    scrot -o "$NV" 2>/dev/null || { sleep 0.3; return 0; }   # no scrot: best effort
    act="$(is_active "$x")"
    [ "$act" = "1" ] && { sleep 0.25; return 0; }
    [ -z "$act" ] && { sleep 0.25; return 0; }               # no python/PIL: best effort
  done
  echo "    (warning: could not confirm screen ${x})"
  sleep 0.25
}

# Detect the current handle pixel of a fader row; fall back to $4 if unavailable.
detect() { # y x0 x1 fallback
  local y="$1" x0="$2" x1="$3" fb="$4" out=""
  if [ -f "$DET" ]; then
    scrot -o "$HP" 2>/dev/null && out="$(python3 "$DET" "$HP" "$y" "$x0" "$x1" 2>/dev/null)"
  fi
  case "$out" in (''|*[!0-9]*) echo "$fb";; (*) echo "$out";; esac
}

# Smoothly drag a horizontal fader at row y from x=a to x=b.
sweep() {
  local y="$1" a="$2" b="$3" steps="${4:-20}" i x
  xdotool mouseup 1 2>/dev/null || true          # clear any stuck button first
  xdotool mousemove "$a" "$y"; sleep 0.05; xdotool mousedown 1
  for ((i=1; i<=steps; i++)); do
    x=$(( a + (b - a) * i / steps ))
    xdotool mousemove "$x" "$y"; sleep 0.02
  done
  xdotool mouseup 1
}

# Demonstrate a fader: detect its current pixel, sweep to a peak and back, then
# verify it returned home -- correcting with a closed-loop drag if a mouse event
# glitched (events can drop under recording load). Net change: none.
fader_demo() { # y x0 x1 fallback peak
  local y="$1" x0="$2" x1="$3" fb="$4" peak="$5" origin i cur d
  origin="$(detect "$y" "$x0" "$x1" "$fb")"
  sweep "$y" "$origin" "$peak"; sleep 0.3
  sweep "$y" "$peak" "$origin"; sleep 0.2
  for i in 1 2 3 4; do
    cur="$(detect "$y" "$x0" "$x1" "$origin")"
    d=$(( cur - origin )); [ "${d#-}" -le 2 ] && break
    xdotool mouseup 1 2>/dev/null || true
    xdotool mousemove "$cur" "$y" mousedown 1; sleep 0.08
    xdotool mousemove "$origin" "$y"; sleep 0.08; xdotool mouseup 1; sleep 0.25
  done
}

echo "Choreography: guided tour starting"

# ---------------------------------------------------------------- PERFORM ----
# Live scope + the five performance macros. Sweep two NON-stereo macros to show
# audible, musical control, returning each to its starting value. We deliberately
# avoid M03 "Stereo Width" (it drives the formant pans) to leave the stereo field
# untouched.
step "PERFORM: macro sweeps"
goto 85
park 0.6
fader_demo 155 727 935 787 905    # M01 Brightness (F1.F2.DRIVE) up & back
sleep 0.4
fader_demo 240 727 935 735 900    # M02 Motion (jitter/glisson) up & back
park 0.6

# ------------------------------------------------------------------- EDIT ----
# Core engine / formant system. Sweep the three most sonically-impactful faders
# (PULSARET, WINDOW, FORMANT 2), each grabbed at its detected pixel and returned
# exactly. We never touch the PAN 1/2/3 faders (stereo field). Finish with a
# reversible Duty Mode toggle.
step "EDIT: pulsaret / window / formant 2 sweeps"
goto 235
park 0.6
fader_demo 256 105 430 193 400    # PULSARET up & back
sleep 0.3
fader_demo 291 105 430 135 400    # WINDOW up & back
sleep 0.3
fader_demo 231 600 925 667 875    # FORMANT 2 up & back
sleep 0.3
tap 395 361 0.9           # Duty Mode -> FORMANT
tap 202 361 0.7           # Duty Mode -> MANUAL (restore)
park 0.6

# ------------------------------------------------------------------- MODS ----
# Internal LFO bus. Preview a couple of LFO slots, then scroll the LFO list and
# the editor panel down and back up to reveal the full set, restoring the top.
step "MODS: browse LFO slots + scroll"
goto 397
park 0.5
tap 250 143 0.7           # focus L01
tap 250 199 0.7           # focus L03
scroll 500 190 5 5        # LFO list: scroll DOWN (reveal L06..L16)
sleep 0.5
scroll 500 190 4 7        # LFO list: scroll back UP to top
sleep 0.4
scroll 250 400 5 5        # editor panel: scroll DOWN
sleep 0.5
scroll 250 400 4 7        # editor panel: scroll back UP to top
tap 250 143 0.6           # focus L01 (restore)
park 0.6

# ---------------------------------------------------------------- EFFECTS ----
# Reverb / delay. Sweep the reverb mix and toggle the delay sync, both restored.
step "EFFECTS: reverb sweep + sync toggle"
goto 555
park 0.5
fader_demo 127 105 430 191 360    # Reverb Mix up & back
sleep 0.3
tap 202 459 0.9           # Sync -> FREE MS
tap 395 459 0.7           # Sync -> MIDI CLOCK (restore)
park 0.6

# ---------------------------------------------------------------- PRESETS ----
# Preset bank. Preview a few saved slots (shows snapshot waveform + detail),
# never recalling, then restore the original selection (slot 04).
step "PRESETS: browse slots"
goto 714
park 0.5
tap 250 127 0.8           # preview slot 01
tap 250 171 0.8           # preview slot 02
tap 250 217 0.8           # preview slot 03
tap 250 267 0.6           # reselect slot 04 (restore)
park 0.6

# -------------------------------------------------------------------- home ---
step "Return to PERFORM"
goto 85
park 0.3

echo "Choreography: done"

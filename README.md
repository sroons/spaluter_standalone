# Spaluter Desktop (Electron + SuperCollider)

Cross-platform desktop wrapper for the `spaluter_supercollider.scd` patch.

## What it does

- Launches `sclang`
- Boots `scsynth`
- Loads the Spaluter patch
- Starts the synth
- Provides a non-SuperCollider UI (HTML/CSS/JS in Electron)
- Sends parameter changes via OSC
- Handles MIDI CC mappings plus MIDI Note On/Off pitch+gate control (auto-switches from Free Run to MIDI-like gating so attack/release is honored)
- Startup order is enforced as: check SuperCollider -> install if missing -> start SuperCollider -> start synth -> start GUI

## Default MIDI channel values (CC mappings)

| Parameter | Default MIDI CC |
| --- | ---: |
| amp | 7 |
| drive | 71 |
| pulsaret | 20 |
| window | 21 |
| duty | 22 |
| dutyMode | 23 |
| formantCount | 24 |
| formantTrack | 25 |
| formant1 | 26 |
| formant2 | 27 |
| formant3 | 28 |
| pan1 | 29 |
| pan2 | 30 |
| pan3 | 31 |
| maskMode | 32 |
| perFormantMask | 33 |
| maskAmount | 34 |
| ampJitter | 35 |
| timingJitter | 36 |
| glisson | 37 |
| burstOn | 38 |
| burstOff | 39 |
| gateMode | 40 |
| voiceCount | 41 |
| chordType | 42 |
| basePitch | 43 |
| attackMs | 44 |
| releaseMs | 45 |
| glideMs | 46 |
| useSample | 47 |
| sampleRate | 48 |

## Requirements

- Node.js 18+
- SuperCollider is auto-detected on startup (`sclang` in `PATH` or `SCLANG_PATH`)
- If missing, startup attempts platform package-manager install:
  - macOS: Homebrew
  - Windows: winget (fallback choco)
  - Linux / Raspberry Pi: apt (fallback dnf/pacman/zypper)
  - You may be prompted for administrator privileges by your package manager

## Run

```bash
npm install
npm start
```

Note: this repo’s launcher clears `ELECTRON_RUN_AS_NODE` automatically before spawning Electron, because some shells/environments set it and break app startup.

## Platforms

- macOS: supported
- Windows: supported
- Linux / Raspberry Pi 4: supported

## Build installers

Installer artifacts are written to `installers/`.

```bash
npm install
npm run build:mac
npm run build:win
npm run build:pi
```

Or build all in one go:

```bash
npm run build:installers
```

Installer behavior:

- macOS build script outputs both Intel (`x64`) and Apple Silicon (`arm64`) installers.
- macOS (`.pkg` postinstall): creates `/usr/local/bin/spaluter-desktop` symlink to the app binary.
- Windows (`NSIS`): adds install directory to machine `PATH`.
- Raspberry Pi / Linux ARM64 (`.deb` postinst): creates `/usr/local/bin/spaluter-desktop` launcher that prefers `pw-jack`.
- Raspberry Pi / Linux ARM64 (`.deb` postinst): installs `/usr/local/bin/spaluter-linux-startup`, invoked on each launch to start audio services and probe MIDI/audio/SuperCollider prerequisites.
- Raspberry Pi / Linux ARM64 (`.deb` postinst): installs `/usr/local/bin/spaluter-rpi-setup` and starts it automatically in the background at install-time.
- All platforms: package app/runtime files and warn if `sclang` is not installed.

## OSC bridge details

Electron sends to `127.0.0.1:57130`, runtime replies to `127.0.0.1:57131`.

Runtime OSC endpoints:

- `/spaluter/start`
- `/spaluter/stop`
- `/spaluter/reset`
- `/spaluter/set` with `[paramName, value]`
- `/spaluter/load-sample` with `[absoluteSamplePath]`
- `/spaluter/quit`

Sample browsing defaults to `/spaluter/samples/` (intended USB mount path). You can change the folder in the UI and refresh the file list.

## MIDI handling architecture

The MIDI hot path is optimised for sustained high-rate CC traffic (e.g. simultaneous fader sweeps on Intech Grid + Pisound DIN) without losing resolution or backing up the IPC queue. See `midi-fix-plan.md` for the full design history and `midi-optimization-claude.md` / `midi-optimization-codex.md` for the analyses that drove it.

Flow:

1. Web MIDI dispatches to the renderer's `handleMidiMessage`.
2. CC values stage into an ordered `pendingCcEvents` array (every value preserved — no per-param coalescing).
3. A `queueMicrotask` drain flushes the staged batch via `setParamMany` (fire-and-forget IPC; never `invoke`). Canvas redraws are coalesced separately on rAF.
4. Main bundles the batch into a single OSC packet and sends it to `127.0.0.1:57130`.
5. `OSCdef(\spaluterSet)` in `sc/runtime.scd` calls `~spaluter.set` inline (no `.defer`), so updates reach scsynth without language-frame quantization.

A `[MIDI-DIAG]` line lands in `~/.local/state/spaluter/start.log` every second on Linux/Pi, showing `raw/s set/s peak/s compress% batches/s maxBatch inflight inflight-peak`. Use it to confirm the pipeline is healthy:

- `inflight-peak` should stay at 0 or 1 — anything higher means IPC backpressure.
- Negative `compress` is expected when CCs map to multiple params.
- A nonzero `inflight-peak` plus a rising `inflight` is the early-warning sign of the original crash mode.

### Raspberry Pi system tuning

For low jitter on Patchbox OS, the following are recommended (and applied automatically on the deployed device):

- CPU governor pinned to `performance` (systemd one-shot, `/etc/systemd/system/cpufreq-performance.service`).
- `vm.swappiness = 10` in `/etc/sysctl.d/60-spaluter-audio.conf`.
- `triggerhappy.service` and `triggerhappy.socket` disabled.
- udev rule at `/etc/udev/rules.d/65-intech-grid.rules` creating `/dev/intech-grid` for stable USB device identity.

## Troubleshooting

- If the app opens but synth never starts:
  - Check the in-app log panel for `Failed to launch sclang`.
  - Check for startup lines:
    - `[BOOT] runtime: ...`
    - `[BOOT] patch: ...`
    - `[STATUS] Starting sclang (...)`
  - Ensure `sclang` is installed and available in PATH.
  - Or launch with explicit path:
    - macOS/Linux:
      ```bash
      SCLANG_PATH=/absolute/path/to/sclang npm start
      ```
    - Windows (PowerShell):
      ```powershell
      $env:SCLANG_PATH="C:\Path\To\sclang.exe"; npm start
      ```
- Runtime listens for OSC on `127.0.0.1:57130` and reports status back to app on `127.0.0.1:57131`.
- If you see `Server 'localhost' exited` right after boot:
  - This is usually an audio device/sample-rate mismatch.
  - In SuperCollider IDE, verify server boots with your current default output device.
  - On macOS, check Audio MIDI Setup for consistent output sample rate.
- Raspberry Pi one-shot dependency setup (manual rerun):
  - `sudo /usr/local/bin/spaluter-rpi-setup --force`
- Linux startup bootstrap (manual run):
  - `/usr/local/bin/spaluter-linux-startup`

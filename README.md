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

## Requirements

- Node.js 18+
- SuperCollider installed (`sclang` available in `PATH`)
  - You can override binary path with `SCLANG_PATH`

## Run

```bash
npm install
npm start
```

Note: this repo’s launcher clears `ELECTRON_RUN_AS_NODE` automatically before spawning Electron, because some shells/environments set it and break app startup.

## Platforms

- macOS: supported
- Windows: supported (`sclang.exe` expected in PATH)
- Linux / Raspberry Pi 4: supported if Electron and SuperCollider are installed

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
- Raspberry Pi / Linux ARM64 (`.deb` postinst): creates `/usr/local/bin/spaluter-desktop` symlink.
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

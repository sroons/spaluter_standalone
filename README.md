# Spaluter Desktop (Electron + SuperCollider)

Cross-platform desktop wrapper for the `spaluter_supercollider.scd` patch.

## What it does

- Launches `sclang`
- Boots `scsynth`
- Loads the Spaluter patch
- Starts the synth
- Provides a non-SuperCollider UI (HTML/CSS/JS in Electron)
- Sends parameter changes via OSC
- Handles MIDI CC mappings plus MIDI Note On/Off pitch+gate control while respecting the currently selected Gate Mode (no forced mode switching)
- In **MIDI-like Gate Mode**, each incoming Note On retriggers active internal LFOs
- Startup order is enforced as: check SuperCollider -> install if missing -> start SuperCollider -> start synth -> start GUI

## The screens

The app opens on the Synth screen. The bottom bar `[01] Synth · [02] Mods · [03] Effects · [04] Presets` switches between the four screens; the button on the far right starts the synth, or stops it when it is running. (An earlier Perform screen with a live output scope, peak meter and five macro faders was removed: it was not used, and drawing the scope at 20 Hz cost the Pi most of a CPU core. The engine still has the scope stream, `/spaluter/scope`, but the app starts it disabled and never requests it.)

### Header (top row)

- **SPILUTER wordmark** — the "PI" is tinted in the shock orange accent.
- **Status chips** — live health of the runtime: `MIDI` (input device link), `SCLANG` (language runtime), `AUDIO` (output engine), and `POWER` (Pi under-voltage/throttle state). Green = healthy.
- **Status label** — the current engine status (e.g. `Synth started`); wraps to two lines for longer messages.
- **DSP** — scsynth's reported load, with the label on top and the value (bold) beneath.
- **Reset / Log / About** — utility buttons.

## The Synth screen

The Synth screen (internally still screen id `edit`) holds every engine parameter. It is built so that nothing scrolls on the 1024×600 display and every control is finger-sized:

- **Section rail (left).** Four tabs, Engine, Formants, Grain (mask + texture) and Voice, each with a live two-to-three-line summary of its key values, so the state of the whole patch can be read without opening each section. The selected section is remembered between sessions.
- **One section at a time (right)** as full-width rows: parameter name · `−` · slider · `+` · value. Rows are 48 px, sliders about 520 px long, segmented buttons 44 px. The `−`/`+` buttons step by the control's own step, or by 1 below 200 and 10 above for the wide Hz/ms ranges, and repeat while held. Double-tap a parameter name to reset it to its default (the row flashes). Chord is a two-row grid of chips instead of a dropdown.
- **Dependent controls follow the engine.** Burst On/Off only appear in Burst mask mode; Mask Amount is greyed unless the mask is Stochastic and Per-Formant unless a mask is on; Formant 2/3 and Pan 2/3 grey out beyond the formant count; Duty greys out in Formant duty mode; Chord greys out with one voice.
- **Quantized formants.** The **Quantize** switch in the Formants section (next to Track Pitch) locks Formants 2 and 3 to a consonant interval of Formant 1. Their Hz sliders are replaced by Interval rows of 14 just-intonation ratios (`1/2 · 3/4 · 1/1 · 6/5 · 5/4 · 4/3 · 3/2 · 5/3 · 2/1 · 5/2 · 3/1 · 4/1 · 5/1 · 6/1`), each row showing the Hz that results. Formant 1 then carries the other two with it, whether moved by its slider, an LFO, MIDI or a preset, and pitch tracking applies to the result. Tapping Quantize on snaps each interval to the ratio nearest the formant's current Hz; tapping it off writes the quantized Hz back into the sliders, so the switch never jumps the sound (presets and MIDI set the switch without snapping). LFOs on Formant 2 or 3 still apply in quantized mode, as a detune around the interval. The Interval rows have no CC of their own: the controller bound to Formant 2 (default CC 27) moves its Hz when free and steps through its ratios when quantized, and MIDI learn on an Interval row binds the formant's CC. The engine clips every formant at 8 kHz, so a high ratio on a high Formant 1 flattens there.
- **Previews.** The Engine section carries the pulsaret, window and duty previews across its top. Each reflects the current parameter values and, while an LFO drives one of them, animates with the modulation.
- **LFO badges.** A parameter that an LFO is driving shows an orange `LFO` tag under its name and a live marker on its slider at the modulated value. Tapping the tag opens the Mods screen with that LFO selected.
- **MIDI learn.** The **MIDI learn** button in the section header shows each row's CC assignment as a tag. Tap a parameter name (it reads "waiting for CC…"), move a controller on MIDI channel 1, and that CC is bound to the parameter; a CC that was bound to another parameter moves. Tap a `CC n ×` tag to clear it. Assignments persist in local storage and apply to every parameter, including the segmented ones (a CC sweeps through their options).

## The Mods screen

The Mods screen hosts 16 internal LFOs with per-LFO shape, rate, depth, target routing, and optional MIDI clock sync + div/mult. It is laid out as two side-by-side panes so that *watching* modulation and *editing* it never compete for the same space:

- **Monitor (left)** lists all 16 LFOs in two columns of touch-sized rows. Each row shows the LFO number (tap it to run/stop that LFO), its target, shape and effective rate, and a live bipolar meter of what the LFO is putting out right now. Tapping a row selects it for editing. Above the rows an optional **Scope** (toggle in the pane header, remembered between sessions) draws the last 4 s of every running LFO's output, the selected one highlighted, with one-second ticks and, when MIDI clock is present, beat and bar lines taken from the engine's beat position. Below the rows a live line shows the selected LFO's target as the engine sees it: `base → live`, this LFO's contribution, and the sum of every LFO on that target.
- **Editor (right)** edits the selected LFO (‹ › step through them; the Running/Off button in the header enables it). Controls sit in two accordion sections whose headers summarise their contents when collapsed: **Source** (shape as a row of seven glyph buttons, a MIDI-clock toggle that shows the incoming tempo, and either the free-rate fader or the clock div/mult fader, whichever applies) and **Destination** (target and bipolar depth, with the depth's native-unit range spelled out). Every control is at least 44 px tall.

Everything live on this screen comes from the engine, not from a client-side imitation of the LFO shapes: a small monitor synth (`\spaluterModScope`) runs right after the LFO group and, only while the Mods screen is showing (30 Hz with the scope up, 10 Hz without), reports each LFO's normalised output, the 20 summed mod-bus channels the synth actually receives, and the beat position (`/spaluter/modscope`). The rows, the scope and the live line all paint from those frames, so what is drawn is the modulation that is happening, including clock-locked phase, retriggers and the engine's own smoothing, and it animates on the Pi kiosk where renderer timers are throttled.

Further behaviour:

- **Synth-screen live markers**: when an LFO targets a parameter with a slider, a live marker overlays that slider to show the effective modulated value in real time while preserving the base setting.
- **Exponential rate fader**: in free-run mode (MIDI clock off), the LFO rate fader follows an exponential curve so the lower, more musical rates get most of the slider travel (≈ the bottom three-quarters covers up to ~3 Hz); the full range is still 0.01–20 Hz. In MIDI clock mode the LFO is phase-locked to the clock: the engine keeps a beat position (beats since the last MIDI Start) that the renderer resyncs from the counted ticks every sixteenth, and the LFO's phase is that position × the div/mult ratio, so `/4` completes one cycle every four beats and sits on the same beat every bar, `x2` runs two cycles per beat. MIDI Start snaps the position to zero (the downbeat); Continue resumes it; the Phase control offsets it. The S&H shape steps on the cycle boundary, so its steps land on the grid. Until a tempo has been estimated (8 ticks) a synced LFO free-runs at its last rate. The Monitor header and the clock line on the VERB/DLY screen show the incoming tempo live ("stopped" / "last tempo held" once ticks stop for 4 s), and the log gets a line when clock is first detected and when it stops. Start, Continue and Stop restart the tempo estimate without discarding the last value, so a synced delay does not jump back to Base Time at every transport start.

## The VERB/DLY screen

The VERB/DLY screen hosts a Mutable Instruments *Clouds*-style reverb plus a lightweight 4-tap rhythmic delay. Both run in a dedicated, persistent effect synth (`\spaluterReverb`) placed **after** the engine in the SuperCollider node order, so the tail keeps ringing while voices are gated/released. The Mods-screen monitor stream and the engine's output scope stream are pre-effect (they read the engine, not the effect output).

The controls are plain faders in the older two-column card layout (not yet converted to the Synth screen's rail layout):

| Control | Param | Range | Default | What it does |
| --- | --- | --- | ---: | --- |
| **Mix** | `revWet` | 0 – 1 | 0.0 | Reverb dry/wet blend. The FX node is fully bypassed only when **both** `revWet` and `dlyWet` are 0. |
| **Decay** | `revTime` | 0 – 0.95 | 0.6 | Feedback-loop gain — longer values give longer tails. Capped below self-oscillation. |
| **Diffusion** | `revDiff` | 0 – 1 | 0.7 | Smear/density of the input diffuser and in-loop allpass. |
| **Damping** | `revDamp` | 0 – 1 | 0.5 | High-frequency absorption inside the loop (higher = darker). |
| **Shimmer** | `revShimmer` | 0 – 1 | 0.0 | Octave-up branch injected into the reverb feedback network for classic shimmer bloom. |
| **Movement** | `revMod` | 0 – 1 | 0.3 | Delay-time modulation depth on the loop delays to de-metal and animate the tail. |
| **Pre-delay** | `revPreDelay` | 0 – 250 ms | 0 | Delay before the reverb onset. |
| **Low Cut** | `revLowCut` | 20 – 1000 Hz | 20 | High-pass filter on the reverb wet signal. |
| **Delay Mix** | `dlyWet` | 0 – 1 | 0.0 | 4-tap delay dry/wet blend. |
| **Delay Feedback** | `dlyFeedback` | 0 – 0.88 | 0.35 | Tail length for repeated taps (capped for stability). |
| **Tap Spread** | `dlySpread` | 0 – 1 | 0.45 | Spacing between the 4 taps; higher values widen the rhythm. |
| **Base Time** | `dlyTimeMs` | 20 – 2000 ms | 320 | Delay base time when Sync is in Free ms mode. |
| **Sync** | `dlySyncMode` | `Free ms` / `MIDI Clock` | Free ms | Chooses free time or MIDI-clock-locked timing. |
| **Clock Ratio** | `dlyClockRatio` | `/16 … x16` | x1 | Divides the beat length when Sync is MIDI Clock: `/N` lengthens (slows) the delay, `xN` shortens (speeds) it. |

Effect params are sent over the same `/spaluter/set` path as every other parameter; the runtime routes `rev*` and `dly*` keys to the effect synth. They are captured and restored by presets like any other control.

### Using the reverb

1. Raise **Mix** (`revWet`) to ~0.2–0.4 to blend the tail with the dry signal. At 0 the reverb is fully bypassed (and the whole FX node costs no DSP when **Delay Mix** is also 0).
2. Set **Decay** for tail length: short (~0.3) for room ambience, high (~0.85) for long washes. It is capped below self-oscillation, so it will not run away.
3. Use **Diffusion** for density — low gives discrete early-reflection character, high gives a smooth smear.
4. Pull **Damping** up to darken long tails (absorbs highs inside the loop); useful to keep washes from getting harsh.
5. Raise **Low Cut** (e.g. 150–300 Hz) when the wet signal muddies the low end.
6. Use **Pre-delay** (0–250 ms) to separate the dry transient from the tail for extra clarity and a sense of space.
7. Leave **Movement** around 0.3 to keep the tail alive (it modulates the loop delays and de-metals the ring); raise it for a more chorused tail.
8. Bring **Shimmer** up slowly with a longer Decay for the classic ascending octave bloom. Shimmer costs extra DSP only when above 0.

*Ambient pad wash:* Decay ~0.85, Diffusion ~0.8, Damping ~0.4, Movement ~0.4, Shimmer ~0.3, Low Cut ~200 Hz, Mix ~0.35.

### Using the delay

1. Raise **Delay Mix** (`dlyWet`) to bring the taps in. At 0 the delay is silent (and, with reverb also at 0, the FX node is bypassed).
2. Pick a timing mode with **Sync**:
   - **Free ms** — set **Base Time** (20–2000 ms) directly for a fixed delay time, independent of tempo.
   - **MIDI Clock** — the delay locks to incoming MIDI clock. **Base Time** is disabled and **Clock Ratio** chooses the note value instead.
3. In **MIDI Clock** mode, choose **Clock Ratio**: `x1` = one beat (quarter note), `/2` = eighth, `/4` = sixteenth, `x2` = half note. Remember `/N` lengthens (slows) the delay and `xN` shortens (speeds) it. (Requires a MIDI clock source; see the Mods/MIDI sections.)
4. Use **Tap Spread** to fan the 4 taps out from the base time:
   - At 0 all four taps collapse onto the base time (one tight echo).
   - Higher values push taps to later times for a rhythmic, cascading pattern.
   - In **MIDI Clock** mode the spread snaps taps onto whole clock divisions, so every tap stays locked to the grid.
5. Set **Delay Feedback** for repeat length (capped at 0.88 for stability): low for a couple of slaps, high for long trailing repeats.

*Tempo-synced rhythmic delay:* Sync = MIDI Clock, Clock Ratio = `/4` (sixteenths), Tap Spread ~0.6, Feedback ~0.45, Delay Mix ~0.3.

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
| formantQuant | 63 |
| formantInterval2 | shares formant2's CC |
| formantInterval3 | shares formant3's CC |
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
| revWet | 49 |
| revTime | 50 |
| revDamp | 51 |
| revDiff | 52 |
| revMod | 53 |
| revPreDelay | 54 |
| revLowCut | 55 |
| revShimmer | 56 |
| dlyWet | 57 |
| dlyFeedback | 58 |
| dlySpread | 59 |
| dlyTimeMs | 60 |
| dlySyncMode | 61 |
| dlyClockRatio | 62 |

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
- Raspberry Pi / Linux ARM64 (`.deb` postinst): creates `/usr/local/bin/spaluter-desktop` launcher that prefers `pw-jack` and, on a 4-core machine, starts the app under `taskset -c 0-2` with `spaluter-pin-scsynth` moving scsynth to CPU 3 (override with `SPALUTER_UI_CPUS` / `SPALUTER_DSP_CPUS`, or `none`).
- Raspberry Pi / Linux ARM64 (`.deb` postinst): installs the runtime payload from `build/linux/payload` (PipeWire quantum and data-loop drop-in, user-manager limits drop-in, WirePlumber onboard-card rule, `spaluter-irq-affinity.service`, `spaluter-measure`); see "Audio runtime tuning" below.
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

#### Audio runtime tuning (installed by the `.deb`, source in `build/linux/payload/`)

scsynth on the Pi is the Debian JACK-only build running as a pipewire-jack client, so period size, device and thread priority are PipeWire's decisions, not scsynth's. Its audio thread (`data-loop.0`) already runs `SCHED_FIFO 83`; the only priority this changes is PipeWire's own. What the postinst installs on ARM:

- `/etc/pipewire/pipewire.conf.d/50-spaluter.conf`: graph quantum 512 at 48 kHz (10.7 ms per period, about 21 ms output latency; the stock 1024 was 21.3 ms per period, about 43 ms). Takes effect after `systemctl --user restart pipewire wireplumber` or a reboot; check with `pw-metadata -n settings 0 | grep quantum`. 256 is not the default: on 2026-11-14 (stock PREEMPT kernel, PipeWire loop unpinned) it produced 2 xruns per minute with the UI idle, and re-measured on 2026-11-21 with the data loop pinned to CPU 3 it still produced 8 xruns in 5 min of heavy play (scsynth 48% average, 72% peak of a 5.3 ms period), where 512 produced none. Retry it with `spaluter-measure` once the synth graph is lighter or on a PREEMPT_RT kernel; 384 (`clock.power-of-two-quantum = false`) is the untested middle ground.
- The same drop-in pins PipeWire's own real-time data loop (the thread that drives the pisound node and wakes scsynth every period) to CPU 3 next to scsynth's audio thread (`thread.affinity = [ 3 ]`), so the whole audio path lives on the core Electron and Xorg never use. Measured 2026-11-21, 5 min of play with touch, screen on: 0 xruns, against 8 in the same scenario on 2026-11-15 without it.
- `/etc/systemd/system/user@.service.d/50-spaluter.conf`: `LimitRTPRIO=95` and `LimitNICE=-11` for the systemd user manager, which PipeWire inherits. module-rt only uses plain `SCHED_FIFO` (rt.prio 88 from pipewire.conf) when it can also set nice -11 itself; with the stock nice limit it falls back to RTKit, which capped the data loop at `SCHED_RR 20`, below scsynth's own thread. The drop-in alone is not enough: `user@.service` opens a PAM session through `/usr/lib/pam.d/systemd-user`, whose `pam_limits` resets the nice limit to 0 at every boot (it is also what grants rtprio 95 from `audio.conf`), so the postinst also installs `/etc/security/limits.d/50-spaluter.conf` with `@audio - nice -11`. Without it PipeWire came up after a reboot with an ordinary-priority data loop that scsynth starved on CPU 3 (1670 xruns in 4 h, found 2026-11-23). The postinst raises a running user manager's limits with `prlimit` as well, so `systemctl --user restart pipewire wireplumber` is enough to pick them up right after an install. Check with `ps -L -o tid,cls,rtprio,psr,comm -p $(pidof pipewire | tr ' ' ',')`: `data-loop.0` should read `FF 88` on CPU 3.
- `/etc/wireplumber/main.lua.d/51-spaluter-disable-onboard-audio.lua`: the bcm2835 headphone jack and both HDMI cards never get PipeWire nodes, so the pisound is the only ALSA card in the graph.
- `/usr/local/bin/spaluter-desktop` launcher: Electron (all processes) and sclang on CPUs 0-2, scsynth on CPU 3 via `/usr/local/bin/spaluter-pin-scsynth`, which re-checks every 2 s for threads created later by pipewire-jack.
- `spaluter-irq-affinity.service`: pisound SPI interrupt (`fe204000.spi`) to CPU 2 at boot, by name. It also tries to move USB (`xhci_hcd`, the Grid) to CPU 1, but on the Pi 4 that interrupt is a PCIe MSI whose controller refuses affinity changes, so USB stays on CPU 0 (logged, harmless). CPU 3 stays with scsynth.

Per-session measurement:

- The header **DSP** chip shows scsynth's own average CPU from its `/status` reply (peak in the label, amber above 60%, orange above 80%). The old chip read the Electron main process, which sits near 0% while scsynth is at 45%. Whole-UI CPU (every Electron process) is on the chip's tooltip.
- While the synth runs, the app writes one `[CPU]` line every 15 s (`SPALUTER_CPU_LOG_MS` to change) to the log drawer and to `~/.local/state/spaluter/start.log`: scsynth avg/peak CPU, UGen and synth counts, Electron CPU split by main/gpu/renderer/other, and scope frames per second received.
- `spaluter-measure [seconds] [interval]` (default 120 s, 5 s) samples per-process CPU, per-core busy %, scsynth thread placement and scheduling class, PipeWire quantum and ERR (xrun) deltas, interrupt counts per CPU, PSS memory and SoC temperature, then appends the window's `[CPU]` lines and prints a summary. Output lands in `~/.local/state/spaluter/measure-*.log`. Run it over ssh during a real play session; that is the baseline every later performance change is judged against.

## Performance work (branch `performance-rewrite`)

The instrument runs on a Raspberry Pi 4 (Model B, 2 GB) with a pisound HAT, a 1024x600 USB touchscreen and Patchbox OS on a stock `PREEMPT` kernel (not `PREEMPT_RT`). Everything below was measured on that device during real play with the screen on, using the tools in the measurement section, and is written up at length in `performance-rewrite-analysis.md` (plan and runtime findings) and `audio-quality-analysis.md` (DSP findings and click measurements). The headline numbers:

| | Before (2026-11-14) | After step 2 (2026-11-24) |
| --- | --- | --- |
| scsynth CPU, defaults (1 voice, 3 formants), UI idle | 38-45% of a core, the same at any voice or formant count | 10% average, 13.5% peak |
| UGens in the voice | 2,956 in one synth, all always computed | 17 synths; unused streams and clocks are paused |
| Output latency (PipeWire quantum) | about 43 ms (quantum 1024) | about 21 ms (quantum 512) |
| xruns in 5 minutes of heavy play | 8 | 0 |
| Clicks in a 3 s saw render with pulsaret 50 Hz | 329 | 0 |
| Saw energy above 16 kHz (aliasing) | -11 dB rel. total | -39 dB |
| 1000 Hz formant actually peaks at | 2000 Hz | 1000 Hz |

### Step 1: measure first, then tune the runtime (no app code)

The first finding was that the product had no instrument for the number that mattered: the header CPU chip read the Electron main process (0.4%) while scsynth sat at 45%. Step 1 added the **DSP** chip (scsynth's own `/status` average and peak, relayed as `/spaluter/cpu`), the `[CPU]` log line every 15 s, and the `spaluter-measure` script, then applied the runtime changes that cost nothing in code: PipeWire quantum 512 (256 measured and rejected twice: 2 xruns per minute idle, later 8 in 5 min of play against 0 at 512), a WirePlumber rule that keeps the onboard headphone and HDMI cards out of the graph, Electron and sclang on CPUs 0-2 with scsynth alone on CPU 3, and the pisound SPI interrupt on CPU 2. Rejected on the device: letting Chromium pace itself with vsync (Electron fell to 78% but Xorg rose from 4% to 55% and xruns went from 8 to 27), so the `--disable-gpu-vsync` / `--disable-frame-rate-limit` flags stay. Also deliberately not done: `chrt` on scsynth (its audio thread already runs `SCHED_FIFO 83` as a pipewire-jack client), `isolcpus`, and a direct-ALSA scsynth (the Debian build is JACK-only).

### Step 1b: PipeWire's own loop next to scsynth

With scsynth pinned, the remaining xruns came from PipeWire's driver thread, the one that services the pisound and wakes scsynth every period, running `SCHED_RR 20` on whichever core was free. It now runs `SCHED_FIFO 88` on CPU 3 above scsynth's 83. Getting there needed three pieces, because PipeWire's module-rt only takes the plain `SCHED_FIFO` path when it can also set nice -11, and otherwise falls back to RTKit or gives up: the `thread.affinity` line in the PipeWire drop-in, a `user@.service` drop-in raising the user manager's rtprio and nice limits, and a `/etc/security/limits.d` file, because `pam_limits` in the vendor `systemd-user` PAM stack resets the nice limit to 0 at every boot and silently undid the drop-in (found as 1,670 xruns in 4 hours after a reboot). All of it is installed by the `.deb` postinst and described file by file under "Audio runtime tuning" above. The check after any reboot or PipeWire restart is that `data-loop.0` reads `FF 88` on CPU 3.

### Step 2a: clicks that happen with zero xruns

A click detector on offline renders (third difference of the signal against its running level) and a sink-monitor capture on the Pi (`pw-record --target <sink> -P '{ stream.capture.sink = true }'`, which records exactly what PipeWire hands the pisound) separated DSP clicks from everything else. Fixed in `spaluter_supercollider.scd`: grain edges fade over 0.5 ms with a smoothstep instead of a boolean duty gate; every continuous control has a 20 ms lag; two `Hasher` range bugs (it outputs -1..1, the code assumed 0..1, which silently dropped half the grains in stochastic mask mode); +6 dB make-up with `LeakDC` and a 2 ms look-ahead `Limiter` on the final bus. The second round found the main click source: pulse phase and pulsaret phase were closed-form products of elapsed time and rate, so they jumped on every mid-grain pitch, chord, formant or duty change, and `Impulse` drifted against them whenever the pulse rate moved (jitter, glide, pitch LFO), truncating a grain at every pulse. Both phases are now integrated with `Phasor.ar`, the note envelope runs at audio rate, and Stop fades `amp` for 80 ms before freeing (a live capture showed it cutting to zero in one sample). 12 of 14 Grid notes clicked with the defaults before; 0 after.

**The crackle that was not digital.** A dense "old vinyl" crackle survived all of this. Its sink-monitor capture was clean, and it reproduced with the instrument stopped: a pure 880 Hz tone from `pw-play` crackled only while busy loops ran on CPUs 0-2 at the full 1.8 GHz clock, went away at 600 MHz, and followed the load within a second at steady temperature. The Pi was being fed from a power strip's USB-A port through an A-to-C cable while also powering the touchscreen and the Grid, and logged under-voltage at every boot. A dedicated 5.1 V 3 A supply fixed it. Judge any future click report on a sink-monitor capture before touching the DSP.

### Step 2: the synth graph

The old voice was one synth of 2,956 UGens: `Mix.fill` always built 12 grain streams, each `SelectX` over 10 pulsaret and 9 window generators ran all 19, and voice and formant counts multiplied finished signals by zero instead of removing work, so 1 voice / 1 formant cost exactly what 4 / 3 did. The new graph is a Group of 17 nodes:

- **4 clock synths**, one per voice: pulse `Phasor`, trigger, audio-rate ASR / percussive envelope with a lagged crossfade between gate modes, per-grain `TRand` amplitude and onset-jitter values and a pulse counter, published on a shared audio bus; the voice frequency on a control bus.
- **12 stream synths**, one per voice x formant: pulsaret and window read from wavetable buffers with a per-sample crossfade between neighbouring shapes, sample playback, the deterministic and stochastic masks, pan, summed on a stereo mix bus.
- **1 mixer** (`\spaluterSC`): `LeakDC`, normalisation by the lagged counts, drive, scope reply, make-up, output. It also `Pause`s every clock and stream the current voice and formant counts do not use, so CPU follows the counts.

The pulsaret shapes are 10 wavetables in 8 band-limited mip levels (2048 + 1 frames each, built once per session with `Signal.fft`, harmonics tapered with a raised cosine over the top third of each band so saw and square edges do not ring); the level is chosen from the pulsaret rate and latched per grain. Windows are 9 tables. Nothing in `sc/runtime.scd` changed: a Group answers `set`, `free` and `\addAfter` the way the single synth did, and the server ignores control names a node does not have.

Three DSP bugs from `audio-quality-analysis.md` were fixed in the same rewrite, and they change the sound: formant frequency no longer divides by duty, so formants sit an octave lower than before at duty 0.5 and a 1000 Hz formant peaks at 1000 Hz (presets sound different, on purpose); timing jitter now moves each grain's onset instead of multiplying in an aliasing noise source; the remaining instant switches (gate mode, sample on/off, mask mode, formant tracking, duty mode) are lagged. The shipped defaults measure about 6 dB quieter because the 20 Hz formant now completes half as many cycles per grain; the pure-formant case is level-identical.

One server behaviour cost most of a day: a control-rate value added to an audio-rate `BufRd` index is ramped across the 64-sample block by scsynth, so a control-rate table offset swept the read head through thousands of frames of the neighbouring tables on every pulsaret or window change (a 1.3 ms noise burst). The shape selector is converted to audio rate first and floored per sample. Measured on the Mac at equal load, the old graph costs 12.6-13.7% at every count setting; the new one 4.3% at 1 voice / 3 formants, 2.3% at 1 / 1, 4.9% at 2 / 2 and 11.9% at 4 / 3. On the Pi at the defaults: 10.1% average, 13.5% peak, 0 xruns, a 20 s capture with no click events, no clicks by ear. Four-voice play on the Pi is the next number to record; the Mac ratio predicts about 28%.

### How to measure

- Watch the **DSP** chip in the header during play (scsynth average, peak in the label; amber above 60%, orange above 80%).
- Read the `[CPU]` lines in `~/.local/state/spaluter/start.log`: scsynth average and peak, UGen and synth counts, Electron CPU by process, scope frames per second.
- Run `spaluter-measure 300` over ssh during a real five-minute session with the screen on. It records per-process and per-core CPU, scsynth thread placement, PipeWire quantum and xrun deltas, interrupts, memory and temperature into `~/.local/state/spaluter/measure-*.log`. That run is the baseline every later change is judged against.
- For clicks, capture the digital output first: `pw-record --target alsa_output.platform-soc_sound.stereo-fallback -P '{ stream.capture.sink = true }' out.wav`. If the capture is clean and you still hear it, the problem is downstream of the stream (power, cable, analog stage).
- After any reboot or PipeWire restart: `ps -L -o cls,rtprio,psr,comm -p $(pgrep -x pipewire) | grep data` must read `FF 88 3`, and `vcgencmd get_throttled` must read `0x0`.

### What remains

In the order the analysis recommends: measure four-voice play on the Pi and retry quantum 256 or 384 now that the DSP is lighter; drop sclang from the control plane (134 MB of RAM and a class-library compile on every launch, for an OSC router, LFOs and reverb spawning that Node can send to scsynth directly, with the wavetables computed in JS and the SynthDefs precompiled at build time); the renderer hot paths and the Xorg-free display stack (Electron is 65-70% of a core with the scope live, Xorg sits in the frame path); and only then decide whether a native engine or UI buys anything the Pi still cannot do. Sub-sample grain onsets and oversampling are the two things a native engine would add that SuperCollider cannot.

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

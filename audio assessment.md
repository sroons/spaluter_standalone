# Audio Assessment — UI Rendering vs. Audio Quality

**Branch analysed:** `main` @ `bb64fdc`
**Device:** Raspberry Pi 4 (4 cores), Patchbox OS, PipeWire → Pisound, `pw-jack` + scsynth
**Method:** static analysis of `spaluter_supercollider.scd`, `sc/runtime.scd`, `main.js`, `renderer/renderer.js`, plus live measurements on `patchbox.local` and local UGen-graph compilation in sclang.

---

## Executive summary

The synth is **CPU-starved at idle**, and a large, fixed share of that cost exists purely to feed the UI. The single biggest offender is not the renderer at all — it is the **oscilloscope capture network compiled into the main SynthDef**, which runs at audio rate on every sample whether or not the scope is visible or even enabled.

Measured on the device with **no notes playing, Perform screen idle**:

| Process | CPU (of one core) |
|---|---|
| `scsynth` | **35 – 44 %** |
| `spaluter-desktop` (renderer) | 6 – 24 % |
| `spaluter-desktop` (main) | ~12 % |
| `Xorg` | ~6 % |

Compiled UGen counts (sclang, `SynthDescLib`):

| SynthDef | Total UGens | Audio-rate |
|---|---:|---:|
| `\spaluterSC` | **2758** | **1987** |
| `\spaluterReverb` | 210 | 89 |
| `\spaluterReverbNoShim` | 195 | 76 |
| `\spaluterLfo` | 27 | 0 |

Isolating the scope block in a minimal SynthDef:

| Graph | Total UGens | Audio-rate |
|---|---:|---:|
| Stereo sine only | 3 | 2 |
| Same + the scope block | **268** | **263** |

**The scope capture costs ~265 UGens, 261 of them audio-rate — roughly 13 % of every audio-rate UGen in the main synth — and it never stops.**

---

## Finding 1 (CRITICAL) — The UI scope compiles into ~261 always-on audio-rate UGens

`spaluter_supercollider.scd:187-197`:

```supercollider
scopeFrames = 64;
scopeBufL = LocalBuf(scopeFrames, 1);
scopeBufR = LocalBuf(scopeFrames, 1);
scopeWritePos = Phasor.ar(0, 1, 0, scopeFrames, 0);
BufWr.ar(sig[0] * 0.9, scopeBufL, scopeWritePos, loop: 1);
BufWr.ar(sig[1] * 0.9, scopeBufR, scopeWritePos, loop: 1);
scopeReadPos = (scopeWritePos - Array.series(scopeFrames, scopeFrames - 1, -1)).wrap(0, scopeFrames - 1);
scopeValuesL = BufRd.ar(1, scopeBufL, scopeReadPos, loop: 1, interpolation: 1);
scopeValuesR = BufRd.ar(1, scopeBufR, scopeReadPos, loop: 1, interpolation: 1);
scopeTrig = Impulse.kr(scopeRate.clip(1, 60)) * (scopeEnabled > 0);
SendReply.kr(scopeTrig, "/spaluter/scope", scopeValuesL ++ scopeValuesR);
```

`scopeReadPos` is an **Array of 64 audio-rate signals**. Passing it to `BufRd.ar` multichannel-expands into **64 `BufRd` UGens per channel = 128 interpolating buffer readers**, plus 64 subtract + 64 wrap UGens, plus `Phasor` and 2 `BufWr`. Every one of them runs **every sample, on every block, forever** — at 48 kHz that is millions of interpolated buffer reads per second to produce 128 floats 20 times per second.

Two aggravating details:

1. **`scopeEnabled` does not disable any of it.** The flag only gates the `SendReply` trigger (`spaluter_supercollider.scd:196`). Turning the scope off saves the OSC message and nothing else — the DSP cost is unconditional.
2. **The renderer's throttle cannot help either.** `refreshScopeStreamingState` (`renderer/renderer.js:3518-3521`) only lowers the *send rate* to `MIN_SCOPE_RATE_HZ`, and it is gated on `document.visibilityState`/`hasFocus()` — on a fullscreen kiosk both are permanently true, so the rate stays at `ACTIVE_SCOPE_RATE_HZ = 20` on **every screen**, including Presets and VERB/DLY where nothing is drawn.

This is the highest-value fix available: the same 64-frame window can be captured with a **single `RecordBuf.ar` per channel** and read back via `/b_getn` or `SendReply` on the trigger only, reducing ~261 audio-rate UGens to ~2.

## Finding 2 (HIGH) — Electron is configured for uncapped rendering on a 4-core audio device

`main.js:8-18`:

```js
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-gpu-vsync");
app.commandLine.appendSwitch("disable-frame-rate-limit");
```

The comment explains the motive — Chromium mis-detects the openbox kiosk window as occluded and throttles everything to ~1 fps. But the chosen remedy is the most aggressive one available, and it has three consequences on this hardware:

- **`disable-gpu-vsync` + `disable-frame-rate-limit` remove the frame cap entirely.** The compositor is free to present as fast as it can, which on an unaccelerated Pi means the renderer and `Xorg` will consume whatever CPU is left.
- **It silently breaks the codebase's own throttling strategy.** Several hot paths deliberately coalesce work with `requestAnimationFrame` — `scheduleOutputScopeRedraw` (`renderer/renderer.js:1171`), `scheduleWaveformViewsRedraw` (`:2042`), `lfoCursorTick` (`:3092`). Those are written on the assumption that rAF fires at most ~60 Hz. With the frame limit lifted, "one paint per frame" is no longer a bound on anything.
- **`disable-renderer-backgrounding` guarantees full-rate rendering even when the UI is not being looked at.**

Meanwhile the audio path is *not* correspondingly protected — see Finding 5.

The correct fix is narrow: keep the occlusion/backgrounding workarounds (they solve the real 1 fps bug) but **drop `disable-gpu-vsync` and `disable-frame-rate-limit`**, which are not needed to fix occlusion and only remove the safety cap.

## Finding 3 (HIGH) — Animation is driven by a main-process timer at ~45 Hz, bypassing every renderer-side throttle

Because rAF is unreliable on the kiosk, animation was moved into the **main process** (`main.js:440-468`):

```js
paramAnimInterval = setInterval(() => {
  mainWindow.webContents.send("param-anim-tick");
}, paramAnimTickMs);
```

`PARAM_ANIM_TICK_MS_RESPONSIVE = 22` and `DEFAULT_RESPONSIVE_PREVIEW_MODE = true` (`renderer/renderer.js:69-72, 118`), so the default cadence is **~45 ticks/second**. Each tick is a main→renderer IPC message that wakes both processes and runs (`renderer/renderer.js:2463-2473`):

- `redrawModulatedParamViews(nowSec)` — recomputes waveform values and redraws the Pulsaret / Window / Duty / Formant / Mask canvases (`:2408-2422`);
- `updateEditLfoMarkers(nowSec)` — iterates **every** marker, and for each one calls `getControlMeta`, `currentParamValue`, and `lfoModOffset` (which scans all 16 LFOs), then writes `marker.style.left` and toggles two classes (`:2361-2378`).

That last one is the expensive part: ~30 params × a 16-LFO scan ≈ 480 iterations per tick, **plus up to 30 inline style mutations per tick**, forcing a style-recalc/layout pass ~45 times a second.

Mitigating factor: this only runs while `currentMainScreen === "edit"` **and** an LFO targets a previewed parameter (`paramModNeedsAnim`, `:2434-2437`). That matches the reported symptom — the synth degrades specifically while the Edit screen is showing live modulation.

## Finding 4 (MEDIUM) — The 20 Hz scope stream does per-message work on every screen

`main.js:342-346` forwards each `/spaluter/scope` OSC message straight to the renderer over IPC. The renderer's handler (`renderer/renderer.js:1184-1204`) runs on **all** screens:

- `computeScopePeaksFromPayload` — 128-element scan;
- `normalizeScopeSamples` ×2 — 128 elements plus a zero-crossing search;
- two `textContent` writes (peak dB label, scope label).

Canvas painting *is* correctly gated to `currentMainScreen === "perform"`, and the buffers are preallocated (`scopeSampleBuffers` / `scopeRenderBuffers`) — this part of the code is well optimised. But 20 IPC wakeups/second with a 128-float structured clone, plus two DOM writes, continue on Presets, Mods and VERB/DLY where the data is never shown.

## Finding 5 (MEDIUM) — scsynth's command thread sits at the *lowest* real-time priority

Measured on the Pi (`chrt` / `ps -Lo`):

| Thread | Policy | RT priority |
|---|---|---:|
| PipeWire `data-loop.0` (where the DSP callback runs) | SCHED_FIFO | **83** |
| `scsynth` main/command thread | SCHED_FIFO | **1** |
| other `scsynth` threads | SCHED_FIFO | 50 |
| `spaluter-desktop` (main, renderer) | SCHED_OTHER | 0 |
| `Xorg` | SCHED_OTHER | 0 |

The DSP callback itself is well protected at 83. But scsynth's **command thread runs at FIFO 1**, the lowest real-time priority there is — barely above the UI. That thread is what processes `/s_new`, `/n_free` and `/n_set`, i.e. **everything the UI sends**. Under renderer load it is the first thing to be squeezed, which shows up as late or bunched parameter updates and stuttering modulation rather than clean xruns.

This matters more than it looks because of Finding 6.

## Finding 6 (MEDIUM) — Every LFO edit frees and recreates a synth node

`sc/runtime.scd:190-211, 236-265`: `applyLfo` unconditionally calls `spawnLfo`, which calls `releaseLfo` (ramp + `AppClock.sched(0.12, { old.free })`) and then creates a new `Synth`. The renderer fires this from the `input` event on the rate and depth sliders, so a **single drag produces dozens of node free/create pairs per second**, each with a 120 ms window where the outgoing and incoming LFO both write to the mod bus.

The result is audible as phase jumps and momentary doubled modulation depth, and it lands squarely on the FIFO-1 command thread identified above. `\spaluterLfo` already exposes `rate`, `depth` and `shape` as control-rate arguments (`spaluter_supercollider.scd:212`), so an in-place `synth.set(...)` is sufficient for everything except a target/enable/phase change.

## Finding 7 (MEDIUM) — All voices and formants are computed regardless of the active count

`spaluter_supercollider.scd` builds `Mix.fill(4, ...)` voices × `Mix.fill(3, ...)` formants — **12 grain chains always run**, with inactive ones multiplied by zero (`vActive`, `fOn`) rather than skipped. This is the bulk of the 1987 audio-rate UGens and explains why `scsynth` sits at 35–44 % of a core with nothing playing. It is not a UI issue, but it is the reason there is no headroom left to absorb UI spikes.

## Finding 8 (LOW) — Mods screen redraws 16 LFO thumbnails at 20 Hz

`lfoCursorTick` (`renderer/renderer.js:3092-3130`) walks all 16 strips every ~50 ms, calling `refreshLfoStripImpact` and `drawLfoThumb` for each visible, running LFO. Visibility culling is in place (`isLfoStripVisible`), and thumbnails are cached, so this is comparatively cheap — but it is another uncapped-rAF consumer (Finding 2) layered on top of an already saturated CPU.

---

## Why this presents as "the UI is breaking the audio"

No single item above is fatal on its own. The failure mode is cumulative:

1. `scsynth` already consumes **35–44 % of a core at idle** (Findings 1 and 7), so there is very little headroom.
2. The UI is configured to render **without a frame cap** (Finding 2), so it will expand into whatever CPU remains.
3. On the Edit screen with live modulation, a **45 Hz main-process timer** adds canvas redraws plus per-tick layout thrash (Finding 3).
4. Every slider gesture additionally triggers **node churn on scsynth's lowest-priority RT thread** (Findings 5 and 6).

So the audio degrades precisely when the UI is doing the most work — which is why it reads as a UI-caused problem, even though the largest single cost (the scope network) is inside the synth itself.

Current device state is otherwise healthy: `clock.force-quantum = 0`, quantum 1024 @ 48 kHz (~21 ms), `pw-top` reporting 0 errors while idle. So this is a headroom/contention problem, not a misconfigured audio stack.

---

## Recommendations, in order of impact-per-effort

1. **Rewrite the scope capture** (Finding 1). Replace the 64-element `BufRd` array with a single `RecordBuf.ar` per channel plus a trigger-time readback. Expected saving: **~260 audio-rate UGens (~13 % of the synth's audio-rate graph)**, permanently.
2. **Make the scope genuinely disableable.** Gate the capture UGens themselves, or move the scope into a separate synth that is paused when not on Perform — so leaving the Perform screen actually returns DSP.
3. **Remove `disable-gpu-vsync` and `disable-frame-rate-limit`** (Finding 2), keeping the occlusion/backgrounding switches that fix the real 1 fps bug. This restores the frame cap that the rAF-coalescing code already assumes.
4. **Make LFO updates non-destructive** (Finding 6): `synth.set(\rate, \depth, \shape)` for a running LFO; respawn only on target/enable/phase change. Also coalesce the `input`-driven `sendLfo` calls.
5. **Reduce the anim tick and its per-tick cost** (Finding 3): default `responsivePreviewMode` to `false` on Linux/ARM (33 ms instead of 22 ms), and make `updateEditLfoMarkers` iterate only *targeted* params, caching `getControlMeta` and batching style writes.
6. **Gate the scope stream by screen, not just by focus** (Finding 4): drop to `MIN_SCOPE_RATE_HZ` whenever `currentMainScreen !== "perform"`.
7. **Raise scsynth's command-thread priority** (Finding 5) to sit meaningfully above the UI but below the PipeWire data loop.
8. **Longer term, make voice/formant count structural** (Finding 7) — separate SynthDefs, or spawn per-voice synths — so a 1-voice patch costs 1 voice.

## How to verify

- **Headroom baseline:** `top -b -n 1 | grep scsynth` with the synth idle. Today: 35–44 %. After recommendation 1, expect a clear drop.
- **Scope cost isolation:** re-run the UGen count after the rewrite; `\spaluterSC` should fall from 2758 toward ~2500, with audio-rate UGens dropping from 1987 by ~260.
- **UI contention:** `pw-top -b` while sweeping a fader on the Edit screen with an active LFO — the `ERR` column should stay at 0.
- **Scheduling:** `chrt -p $(pgrep -x scsynth)` and `ps -Lo pid,tid,cls,rtprio,pcpu -p $(pgrep -x scsynth)`.
- **Confirm the audio stack is clean:** `pw-metadata -n settings | grep force-quantum` should report `0`.

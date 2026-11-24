# Performance Rewrite Analysis — Spaluter

Branch: `performance-rewrite`. Date: 2026-11-14.

Scope: every source file in the repo (`main.js`, `preload.js`, `renderer/*`,
`sc/runtime.scd`, `spaluter_supercollider.scd`, installers, scripts), the prior
audits (`audio-quality-analysis.md`, `review.md`, `midi-optimization-*.md`,
`midi-fix-plan.md`, `steamdeck-port-assessment.md`), git history, and a
read-only snapshot of the deployed Pi (`patch@patchbox.local`) taken today while
the synth was stopped. Under-load scsynth figures are from the August audit;
they were not re-measured because starting the synth remotely would make sound.

Everything marked **(measured)** came from the Pi or from the August renders.
Everything marked **(estimate)** or **(by reading)** did not.

---

## 1. Where the machine goes today (Pi 4, 2 GB, idle, synth stopped)

| Process | PSS | Idle CPU | Under load | Role |
| --- | ---: | ---: | --- | --- |
| Electron GPU process | 144 MB | 0.5% | unmeasured | compositing (has `/dev/dri` open; `vc4`+`v3d` loaded) |
| Electron main | 110 MB | 0.6% | unmeasured | spawns sclang, OSC bridge, IPC |
| Electron renderer | 84 MB | 1.0% | **unmeasured** | the entire UI |
| Electron utility + 3 zygotes | ~90 MB | 0% | | |
| sclang | **134 MB** | 0.2% | low | interpreter: OSC router, LFO/reverb/MIDI logic |
| scsynth | 28 MB | 1.8% | **45–55% of one core (measured, Aug)** | all DSP |
| Xorg | 43 MB | 0.3% | unmeasured | |
| PipeWire + WirePlumber | ~30 MB | 0.5% | | graph at quantum 1024 |
| **Total app-related** | **~660 MB of 1845 MB** | | | |

Other facts from the snapshot **(measured)**:

- Kernel `6.12.87+rpt-rpi-v8`, `PREEMPT` (not `PREEMPT_RT`). Governor `performance`. `throttled=0x0`. Uptime 97 days.
- scsynth threads (corrected after per-thread inspection): the main thread and the two pipewire-jack `pw-pisound` threads are `SCHED_FIFO 1`, two NRT/OSC threads `FIFO 50`, and the **actual audio thread, `data-loop.0`, is already `SCHED_FIFO 83`** (pipewire-jack's client-rt default). PipeWire's own driver loop was `SCHED_RR 20` on whatever core was free (module-rt falls back to RTKit when it cannot set nice -11; since 2026-11-21 it is `SCHED_FIFO 88` pinned to CPU 3, see §2.2 item 2), WirePlumber's `RR 20`. sclang: `SCHED_OTHER`. There is no priority inversion to fix; the earlier claim of "scsynth at FIFO 1" came from reading the process, not the thread.
- scsynth is launched as `scsynth -u 57110 -a 1022 -i 0 -o 2 -m 32768 -w 4096 -H pisound -R 0 -C 1 -l 1` with `LD_LIBRARY_PATH=/usr/${LIB}/pipewire-0.3/jack`, i.e. it is a **pipewire-jack client**. The `-H pisound` device pin is not in effect; the comment in `sc/runtime.scd:63-68` is wrong.
- PipeWire `clock.quantum = 1024` (21.3 ms per period, ~43 ms output latency). Node graph (corrected): the only ALSA driver node is `alsa_output.platform-soc_sound.stereo-fallback`, which **is the pisound** (`api.alsa.card.name = pisound`, `hw:5`), `ERR 102`. The node called `pisound` (`ERR 77`) is **scsynth itself**: with the JACK backend the `-H pisound` device string becomes the JACK client name. The bcm2835 headphone and both HDMI cards exist as devices but have their profiles switched off by the user unit `set-pisound-default.service`, so there was never a second driver. `/proc/cmdline` still contains both `snd_bcm2835.enable_headphones=0` and `=1`.
- 77 xruns is the count accumulated over the **97-day uptime**, not per session. `start.log` (5,961 lines) contains **zero** scsynth `late` lines. The xrun picture is milder than the August write-up implies; the margin is still poor at 45% CPU on a 21 ms quantum.
- xHCI IRQ 30 affinity `0-3` (not pinned). No `isolcpus`, no `threadirqs`. The guarded launcher (`~/.local/bin/spaluter-start-guarded.sh`) applies no `chrt`/`taskset`; it waits for pisound, forces 1024x600, then `exec`s `/usr/local/bin/spaluter-desktop` (which wraps the app in `pw-jack`).
- Of the earlier `midi-fix-plan.md` Phase 4 items: 4.1 rt limits ✓, 4.3 governor ✓, 4.5 triggerhappy ✓, 4.6 swappiness ✓; **4.7 IRQ pin ✗, 4.8 isolcpus ✗, PipeWire quantum ✗** (scsynth priority turned out to be fine, see above).
- The app is supervised by the **system** unit `spaluter-kiosk.service` (User=patch, `xinit` → openbox → `spaluter-start-guarded.sh` → `/usr/local/bin/spaluter-desktop`), not by the inactive user unit `spaluter.service`. Restarts go through `sudo systemctl restart spaluter-kiosk.service`.
- The in-app **CPU chip reads Electron main-process CPU only** (`process.getCPUUsage()` in `main.js:732`). It shows 0.4% while scsynth is at 45%. There is currently no instrument in the product for the number that matters. *(Fixed in step 1: the chip now shows scsynth's `/status` avg/peak.)*
- **Measured with the new tooling (2026-11-14, synth running, no notes, quantum 512):** scsynth 38% of a core (`/status` avg 34%, peak 50%, 2957 UGens, 3 synths); Electron **45% of a core summed over all its processes** while the Perform screen is live (scope stream at 20 Hz + meters), versus **2%** when the scope stream is off; Xorg 2.4%, sclang 0.8%, PipeWire 1.5%. PSS: Electron 318 MB, sclang 130 MB, scsynth 24 MB, Xorg 43 MB. The UI is a whole core's worth of work when it is drawing, which is the number step 4 has to bring down.

---

## 2. Findings by layer, ranked by impact

### 2.1 Synthesis graph: the dominant cost (measured)

`spaluter_supercollider.scd` builds **2,956 UGens** and costs **45% of a core for 1 voice / 1 formant**, unchanged at 4 voices / 3 formants.

Causes, by reading `spaluter_supercollider.scd:64-183`:

1. `Mix.fill(4, …)` × `Mix.fill(3, …)` always instantiates **12 grain streams**; `vActive` and `fOn` multiply finished signals by 0 instead of removing work.
2. Inside each stream, `SelectX.ar(pulsaret, [10 waveforms])` and `SelectX.ar(window, [9 windows])` run **all 19 generators** (SC has no lazy evaluation). That is 228 always-on waveform generators, including 12 `sinc`, 12 `BufRd` sample readers, 36 `Hasher`s, and 12 Blackman-Harris 3-cosine sums.
3. `LFNoise0.kr(freq)` is a control-rate noise source asked to run at up to 14 kHz (`:74`).

What is **not** the problem (measured deltas from the August `/status` polls): the reverb+delay FX synth adds ~1%, 16 LFOs add ~1%, the scope adds well under 1% after the control-rate reader change.

**Fix in place (SC):**

- Precompute the 10 pulsaret shapes and 9 window shapes into one wavetable `Buffer` each at boot (tables can be made band-limited and forced to zero at both ends, which also fixes the click-by-design default from the August audit §2.2). Each stream then needs **2 `BufRd.ar` + one crossfade** per role instead of 19 generators.
- Make counts structural. Simplest: generate **12 SynthDef variants** (voices 1–4 × formants 1–3) in a loop at boot and swap the running synth on count change. Alternative: one synth per (voice, formant) stream writing to a per-voice bus, spawned/freed on demand.
- Replace `LFNoise0.kr(freq)` with `TRand.ar(…, trig)` sampled per grain.

**Expected result (estimate):** a 4v/3f patch of roughly 300 UGens, 1v/1f under 100. Single-digit CPU percent at the current block size. Since every generator line is being rewritten anyway, fix the formant÷duty, `Hasher` range, and parameter-lag bugs from `audio-quality-analysis.md` §3 in the same pass rather than porting them.

**Ceiling of staying in SC (by reading):** grain onsets stay sample-quantised (`Impulse.ar` + `Sweep.ar`), oversampling means running the whole server at 96 k, and mip-mapped tables for alias control are awkward to express. Those three are the only things a native engine buys that SC cannot.

### 2.2 Audio runtime on the Pi (measured; cheapest fixes in the whole list)

1. ~~**Priority inversion.**~~ **Withdrawn.** scsynth's audio thread already runs `SCHED_FIFO 83` under pipewire-jack (see §1). Do not `chrt` scsynth: raising the FIFO 1 housekeeping threads buys nothing, and lowering the 83 thread would create the problem this item imagined.
2. **Quantum 1024.** `/etc/pipewire/pipewire.conf.d/50-spaluter.conf` now sets `default.clock.quantum = 512` (`min-quantum 512`, `max-quantum 1024`): 10.7 ms per period, about 21 ms output latency, half of before. **Measured:** at 256 the pisound sink logged 2 xruns in a 60 s window with the synth running and the UI idle (scsynth busy 2.3 ms of the 5.3 ms period, so any scheduling spike over ~3 ms on the non-RT kernel is an xrun); at 512, 0 xruns in 90 s with the UI live and scsynth at 38%. The `min-quantum = 1024` rule at `pipewire.conf:72` only applies inside VMs and needs no override. **Follow-up, measured 2026-11-21:** PipeWire's own data loop now runs on CPU 3 at `SCHED_FIFO 88`, above scsynth's `FIFO 83` on the same core (`thread.affinity = [ 3 ]` in the drop-in, plus a `user@.service` drop-in granting `LimitNICE=-11`/`LimitRTPRIO=95`; without the nice limit module-rt falls back to RTKit at `RR 20`). Five minutes of play with touch, screen on, quantum 512: 0 xruns against 8 in the same scenario on 2026-11-15. **256 re-measured 2026-11-21 with the pinned loop:** 8 xruns in 5 min of heavy play with touch (5 in one burst in the first seconds, 3 during a passage with scsynth at 58% average and 72% peak of the 5.3 ms period, Electron at 180%), where 512 gave 0 in the same session; scsynth's average also rose from 41% to 48% from per-period overhead. 512 stays until step 2 cuts the DSP time; 384 with `clock.power-of-two-quantum = false` is the untested middle ground. **Done in step 1.** Boot-time caveat found 2026-11-23: `LimitNICE=-11` in the `user@.service` drop-in is undone by `pam_limits` (`/usr/lib/pam.d/systemd-user`), so after a reboot PipeWire had RLIMIT_NICE 0 and module-rt left `data-loop.0` as an ordinary thread on CPU 3, where scsynth starved it (1670 xruns in 4 h). The deb now also installs `/etc/security/limits.d/50-spaluter.conf` (`@audio - nice -11`), verified through the same PAM path with `systemd-run -p PAMName=systemd-user`. Check after every reboot or PipeWire restart: `data-loop.0` must read `FF 88` on CPU 3.
3. ~~**Second driver node.**~~ **Withdrawn as a finding**, kept as hygiene: the "second driver" was the pisound sink itself (the node named `pisound` is scsynth's JACK client). A WirePlumber rule (`51-spaluter-disable-onboard-audio.lua`) now keeps the bcm2835 and HDMI cards out of the graph permanently instead of relying on the login-time profile switch. **Done in step 1.**
4. ~~**Pick one audio server.**~~ **Decided:** the Debian `scsynth` links only libjack (no ALSA/PortAudio backend), so direct ALSA is not available without a rebuild. pipewire-jack stays; the misleading `-H pisound` comment in `sc/runtime.scd` is fixed and the name is kept because it is the JACK client name visible in `pw-top`. **Done in step 1.**
5. **Core placement.** Launcher runs the app under `taskset -c 0-2`; `spaluter-pin-scsynth` moves every scsynth thread to CPU 3 as they appear. `spaluter-irq-affinity.service` pins the pisound SPI interrupt (`fe204000.spi`, the MIDI/control path, 311 M interrupts over the uptime) to CPU 2 by name. The `xhci_hcd` line **cannot** be moved on a Pi 4: it is a PCIe MSI through the brcmstb controller, which rejects affinity writes, so USB MIDI interrupts stay on CPU 0 (the unit logs this and carries on). `isolcpus=3 nohz_full=3 rcu_nocbs=3` only after a measured session says the above is not enough. **Done in step 1.**
6. **Measure per session.** `pidstat` is not installed on the Pi, so `spaluter-measure` (installed by the `.deb`) samples /proc deltas instead: per-process CPU, per-core busy, scsynth thread placement, `pw-top` ERR delta, IRQ counts per CPU, PSS, temperature. The app itself logs a `[CPU]` line every 15 s while the synth runs (scsynth avg/peak from `/status`, Electron CPU by process type, scope frames/s), and the header chip now shows scsynth's avg/peak instead of the Electron main process. **Done in step 1.**

### 2.3 sclang as the control plane (measured memory; structural)

- **134 MB PSS** (7% of the Pi's RAM) for a 680-line control script. Compare scsynth at 28 MB doing all the work.
- The SC class library is compiled on **every launch**. On a Pi 4 that is tens of seconds and is the bulk of the 90 s startup budget the app allows (`STARTUP_WAIT_TIMEOUT_MS`). Verify from `start.log` timestamps.
- Every parameter change takes **two UDP hops** (Electron → sclang → scsynth) through an interpreted single language thread. The MIDI work in June already spent effort removing `.defer` serialisation here; the hop itself remains.
- The `apt install supercollider` dependency pulls in Qt and the IDE; it is the reason the installer has a 20-minute background bootstrap and why "duplicate runtime on port 57130" was a failure mode worth a commit.
- Everything `sc/runtime.scd` does is expressible as raw scsynth OSC from Node: spawn `scsynth` directly; `/d_load` SynthDefs **precompiled to `.scsyndef` at build time** (one `writeDefFile` run on the dev Mac); `/b_alloc` + `/b_setn` for wavetables (computed in JS, where the UI previews already compute them); `/s_new`, `/n_set`, `/n_run`, `/n_free` for the main synth, LFOs and reverb variants; `/b_allocReadChannel` for samples; `/notify 1` so `SendReply` scope frames and `/status.reply` (which carries the **real CPU figure**) arrive in Node directly. MIDI notes move to the main process via a native ALSA module (`@julusian/midi`, which runs its input on its own thread). Roughly 500–800 lines of Node replacing 680 lines of sclang.
- One risk item: the native MIDI module needs an `arm64` prebuilt for Electron 33 (`npmRebuild: false` is currently set in `package.json`).

### 2.4 Electron / Chromium (memory measured; CPU under load unmeasured)

- **~430 MB PSS across seven processes** plus 43 MB for Xorg. That is 25% of RAM on this board. Memory, not CPU, is Electron's measured cost here; 1.1 GB remained available at idle.
- `main.js:17-18` passes `--disable-gpu-vsync` and `--disable-frame-rate-limit`. These were added to defeat the Xorg occlusion-throttling bug, but they remove the frame cap **globally**, so any persistent `requestAnimationFrame` loop spins as fast as the compositor allows. There is one: `lfoCursorTick` (`renderer.js:3092`) re-schedules itself every frame while Mods is showing and any LFO is running. Its work is throttled to 50 ms internally; the rAF and the composite are not. **Likely a hidden CPU burner on the Mods screen; measure before and after removing the flags.**
- The occlusion workaround (five Chromium switches plus a main-process tick stream for animation) exists because of Xorg + openbox with no compositor. Running Electron under a Wayland kiosk compositor (`cage`) with `--ozone-platform=wayland` would very likely remove the root cause. This is an afternoon's experiment and should precede any UI-rewrite decision.
- GPU: the GPU process has `/dev/dri` open and `vc4`/`v3d` are loaded, so hardware compositing is plausibly active. Confirm raster/WebGL status via `app.getGPUFeatureStatus()` logged at startup.

Renderer hot paths, **by reading** (none measured):

| # | Location | Problem | Fix |
| --- | --- | --- | --- |
| R1 | `lfoCursorTick` → `isLfoStripVisible` (`:3083`) | Reads `offsetTop`/`offsetHeight`/`scrollTop` for each of 16 cards every 50 ms → 16 forced layouts per tick, plus ~48 `textContent` writes and 16 bar style writes | `IntersectionObserver` for visibility; update only visible cards; skip text writes when the string is unchanged |
| R2 | `setParamValue` → `updateEditLfoMarkers()` (`:2118`, `:2361`) | On the Edit screen **every** param change iterates all ~30 markers × 16 LFOs and writes 30 `style.left`s. A 200 CC/s sweep is ~100k inner iterations/s and 6,000 style writes/s | Update only the changed param's marker; use `transform` instead of `left` |
| R3 | `drawScopeTrace` (`:682`) | Interpolates 64 real samples up to ~300 path points per channel, strokes each channel twice, with `lighter` compositing on a 600×300 canvas at 20 Hz | Draw 64 (or 128) points; make the bloom underlay optional on Pi; move scope painting to an `OffscreenCanvas` in a Worker so a slow paint can never block MIDI/IPC handlers |
| R4 | `refreshSliderFill` (`:3872`) | Rebuilds a CSS gradient string on every `input` event | Drive the fill with a CSS custom property and a static gradient |
| R5 | `refreshStatusChips` (`:3995`, every 750 ms) | Removes and re-adds classes unconditionally → style invalidation when nothing changed | Compare before writing |
| R6 | Mods screen DOM | Each LFO card is ~40 nodes with 3 range inputs; 16 cards always in the DOM | Fine for now; relevant only if R1 is not enough |

Structural note: `renderer.js` is a single 4,020-line file with no modules and no tests. That is not a runtime cost, but it is the main cost of *changing* the UI, which bears on the rewrite question below.

### 2.5 Main process and IPC (already optimised; small items)

- Fire-and-forget IPC, OSC bundles, and the zero-allocation scratch pool are in place and correct. Nothing on the hot path needs work.
- The renderer heartbeat watchdog (`main.js:714`) relaunches the **entire app**, including sclang and scsynth, if the renderer stalls for 8 s. During a performance that converts a UI hiccup into an audio drop. Reload the `webContents` first; relaunch only if that fails.
- The `/spaluter/scope` payload is re-parsed in sclang (`forwardScope`) and again in main (`getScopeSamplesForRenderer`). Disappears with 2.3.

### 2.6 Correctness items that read as "performance" (from the August audit, verified in code)

Formant frequency lands at `formant ÷ duty` (`:110-114`); `Hasher` is bipolar but treated as 0..1 (`:130`, `:166`); `LFNoise0.kr` at audio rate (`:74`); no `Lag` on any continuous control except `freq`; factory defaults are 50/50 crossfades of incompatible shapes. These make the instrument sound worse under modulation and under the Texture macro. They are not re-derived here; see `audio-quality-analysis.md` §3. **Any rewrite must not port them, and the in-place restructure should fix them in the same pass.**

---

## 3. The rewrite question

### 3.1 Synthesis layer options

| | Option | Effort | What you get | What you give up |
| --- | --- | --- | --- | --- |
| **S0** | Keep SC, restructure the graph (§2.1) | 1–2 wk | 45% → single digits (est.); DSP bugs fixed; nothing else changes | Sample-quantised grains, no oversampling, awkward mip-mapping |
| **S1** | Keep scsynth, **drop sclang** (§2.3) | 1–2 wk | −134 MB; boot from tens of seconds to a few; one hop fewer; real CPU meter; bundle a ~20 MB scsynth instead of the SC metapackage | Need `.scsyndef` precompile step and a native MIDI module |
| **S2** | **Native engine process** (C++ or Rust), same OSC surface, Electron untouched | 4–8 wk | Sub-sample grain onsets, band-limited mip-mapped tables, 2–4× oversampling, per-grain polyphony, SIMD; direct ALSA/PipeWire client; single static aarch64 binary; boots in <1 s; no SC dependency at all. Mutable's reverb is MIT-licensed C++ in the `eurorack` repo, so the "Clouds-style" tank can become the actual Clouds tank | All DSP is hand-written; cross-compile pipeline; a second language in the repo |
| S2′ | Csound `partikkel` behind the same OSC surface | 1–2 wk | Most of S2's grain correctness for a fraction of the work | A Csound runtime dependency (lighter than SC's, still a dependency) |
| S3 | Faust for FX/filters + hand-written grain scheduler | ≈ S2 | Less hand DSP than S2 | Two toolchains |

**Verdict:** S0 + S1 are the cheap 90% and should be done regardless. S2 is the only route to *maximum* synthesis performance and quality headroom, and it is a bounded job because the OSC surface (`/spaluter/set`, `/spaluter/lfo/*`, `/spaluter/scope`) already decouples it from everything else. If you choose S2, do it **instead of** S0 (do not spend two weeks optimising a graph you then discard), but do S1's control-plane work either way because the native engine replaces sclang by construction.

### 3.2 UI layer options

| | Option | Effort | What you get | Notes |
| --- | --- | --- | --- | --- |
| **U0** | Keep Electron; fix R1–R5; drop the frame-limit flags; try `cage`/Wayland | days | Removes the likely spin loop and the occlusion hacks | Must measure renderer CPU under play first |
| U1 | Keep Electron; split `renderer.js` into modules; `OffscreenCanvas` worker for the scope; optional WebGL scope | 1–2 wk | Isolation of paint from input; maintainability | Modest CPU gain on Pi |
| U2 | Lighter web shell (Tauri/WebKitGTK, or a bare Chromium kiosk) | 2–3 wk | Little | WebKitGTK is slower than Chromium on Pi; a Chromium kiosk is the same engine. **Not recommended.** |
| **U3** | Native UI, GPU-direct, no X server: Flutter (`flutter-pi` on DRM/KMS), Qt Quick (`eglfs`), LVGL, or egui/ImGui | 4–8 wk | −430 MB Electron, −43 MB Xorg, no occlusion bug, 60 fps scope on v3d, boot in seconds, ALSA MIDI directly | Full rewrite of five screens (~4k lines JS → similar Dart/QML), new preset storage and migration, new installers, loses the Tomato-styled CSS |

**Verdict:** not for performance alone. Electron's measured cost on this board is memory, and there is 1.1 GB free. The renderer's CPU under play is unknown; measure it (§2.2 item 6). Do U3 only if that measurement shows the renderer taking more than ~30% of a core during play, or as a later "appliance" phase when sub-5-second boot and a single-binary product become goals in themselves.

### 3.3 Both layers: one native binary

C++/Qt or Rust/egui with the engine on a real-time thread and the UI in the same process. A lock-free parameter queue replaces OSC, UDP, IPC and all four processes between a slider and a UGen. DRM/KMS output, ALSA/PipeWire direct. This is the true maximum: the whole Pi belongs to the instrument. It costs 8–14 weeks and discards the debugged MIDI pipeline, presets, installers and three platforms' worth of packaging. Justified only if the product goal is a boot-to-play appliance with sub-3-second boot and sub-5-millisecond latency. It is not justified by the problems found here, every one of which has a cheaper fix.

---

## 4. Recommended sequence (performance per unit of effort)

**Phase 0 — runtime and instrumentation (1–2 days, no app code) — implemented as "step 1" on branch `performance-rewrite`:**
PipeWire quantum 512 (drop-in; 256 measured and rejected for now, see §2.2); WirePlumber rule keeping the onboard cards out of the graph; `taskset` Electron to 0–2 and scsynth to 3 (launcher + `spaluter-pin-scsynth`); IRQ affinity unit (SPI → CPU 2, xHCI → CPU 1); CPU chip replaced with scsynth `/status` avgCPU/peakCPU relayed as `/spaluter/cpu`; `[CPU]` session log line; `spaluter-measure`. **Not done, on purpose:** no `chrt` on scsynth (already FIFO 83), no direct-ALSA scsynth (JACK-only build), no `isolcpus`, and the Chromium flags (`--disable-frame-rate-limit`/`--disable-gpu-vsync`) stay for step 4 because removing them is a renderer-behaviour change that needs its own A/B on the device. Next: play a real session with `spaluter-measure` running and record the numbers before touching the synth graph.

**Phase 0 follow-ups (2026-11-15 to 2026-11-21), both judged with 5-minute `spaluter-measure` runs during real play with the screen on:**
- **Rejected:** removing `--disable-gpu-vsync` and `--disable-frame-rate-limit` (vsync-paced rendering). Electron fell from 150% to 78% of a core, but Xorg rose from 4% to 55% (CPU-side presentation on the compositor-less Xorg kiosk) and xruns went from 8 to 27 in five minutes. The flags stay. The display-stack work in step 4 has to take Xorg out of the frame path (Wayland/cage) rather than throttle Chromium.
- **Kept:** PipeWire's data loop pinned to CPU 3 at `SCHED_FIFO 88` (details in §2.2 item 2). 0 xruns in five minutes against 8 before, with scsynth at 41% and Electron at 71% average. Shipped by the .deb as the `thread.affinity` line in `50-spaluter.conf` and the new `user@.service` limits drop-in.
- **Step 2a (DSP, 2026-11-21):** surgical pass on `spaluter_supercollider.scd` for the clicks that happen with zero xruns: smoothstep grain edges replacing the boolean duty gate, 20 ms lag on every continuous control, the two `Hasher` range bugs, +6 dB make-up and a `LeakDC` + `Limiter` final stage. Measured before/after with offline renders; table in `audio-quality-analysis.md`. A second round the same evening found the remaining click source with a third-difference detector: pulse and pulsaret phase were closed-form (elapsed x rate, `tp x ratioF`) and jumped on every mid-grain pitch, chord, formant or duty change (12 of 14 Grid notes clicked with the defaults); both are now integrated with `Phasor.ar` and the note ASR runs at audio rate (0 of 14). A live sink-monitor capture on the Pi (`pw-record --target <sink> -P '{ stream.capture.sink = true }'`) is now the acceptance test for this class of fault; it also showed Stop cutting to zero in one sample, so `sc/runtime.scd` fades `amp` for 80 ms before freeing. The crackle still audible after round 2 turned out not to be digital at all: a pure `pw-play` tone with the kiosk stopped crackled only under CPU load at the full clock while its sink-monitor capture stayed a perfect sine, and the Pi was running from a power strip's USB-A port while also powering a USB touchscreen and the Grid (under-voltage logged at every boot). A dedicated 5.1 V 3 A supply fixed it on 2026-11-23; details and the discriminating runs are in `audio-quality-analysis.md`. Judge every future click report on a sink-monitor capture before touching the DSP. The always-on graph and band-limited pulsarets (the CPU and aliasing work) remain the real step 2.
- **Step 2 (synth graph, 2026-11-23/24, on the Pi by hand, uncommitted at the time of writing):** `spaluter_supercollider.scd` is restructured into a Group of 17 nodes: 4 `\spaluterClock` synths (one per voice: pulse `Phasor`, trigger, audio-rate ASR/perc envelope with a lagged mode crossfade, per-grain `TRand` amplitude and timing values, pulse counter, written to a shared audio bus), 12 `\spaluterStream` synths (one per voice x formant: pulsaret and window read from wavetable buffers with a per-sample shape crossfade, sample playback, masks, pan, summed on a mix bus) and one `\spaluterSC` mixer (LeakDC, count normalisation, drive, scope reply, make-up, output) that also `Pause`s every clock and stream the current voice and formant counts do not use. Pulsarets are 10 shapes x 8 band-limited mip levels (2048 + 1 frames each, built with `Signal.fft` at load, harmonics tapered with a raised cosine over the top third so saw and square edges do not ring), windows are 9 tables; the level is latched per grain. The runtime did not change: a Group answers `set`, `free` and `\addAfter` the same way the single synth did, and unknown control names are ignored by the server. Folded in from `audio-quality-analysis.md`: the formant / duty bug (a 1000 Hz formant now peaks at 1000 Hz, not 2000), real per-grain onset jitter in place of the aliasing noise multiplier, and lags on the remaining instant switches. **Measured on the Mac** (same machine load, back to back): the old graph costs 12.6-13.7% whatever the counts; the new one 4.3% at 1v/3f, 2.3% at 1v/1f, 4.9% at 2v/2f, 11.9% at 4v/3f. **Measured on the Pi** at the shipped defaults, screen on, UI idle: `[CPU] dsp avg=10.1% peak=13.5%` against 40-44% with step 2a, 0 xruns, a 20 s sink-monitor capture with 0 click events. Offline renders: the saw case went from 329 click events to 0 and from -11 dB to -39 dB above 16 kHz, the pitch-slide case from 21 to 0 (above 16 kHz -26 -> -87 dB), the preset-switch case from 1 to 0. The one new fault found on the way: a control-rate wavetable offset added to an audio-rate index is ramped across the block by the server, which swept the read head through neighbouring tables on every shape change (1.3 ms noise burst); the shape selector is converted to audio rate first and floored per sample. Audible changes to expect: formants an octave lower than before at duty 0.5 (presets will sound different), timing jitter now moves grain onsets instead of adding noise, and the defaults measure about 6 dB quieter (the pure-formant case is level-identical, so this is content, not gain). Four-voice play on the Pi still to be measured with `spaluter-measure`; the Mac ratio predicts about 28%.

**Phase 1 — synth graph (1–2 weeks):** S0 with the §2.6 bug fixes folded in. Target: 4v/3f + FX + 16 LFOs under 10% of a core. Measure with `/status`. **Done as step 2 (see above): 10% at the defaults on the Pi; 4v/3f still to be measured there.**

**Phase 2 — control plane (1–2 weeks):** S1. Target: app ready in under 10 s on the Pi; sclang gone; real CPU meter; scsynth bundled in the installers.

**Phase 3 — renderer hot paths (2–3 days):** R1–R5, then the `cage`/Wayland experiment to delete the occlusion workaround.

**Decision gate (measure):**
- Want sub-sample grain scheduling, oversampling, or per-grain polyphony → **Phase 4: native engine (S2)**, keeping Electron and the OSC surface.
- Want a boot-to-play appliance, or the renderer measures >30% of a core during play → **Phase 5: native UI (U3)**.
- Neither → stop; the instrument is now bounded by the Pi, not by the code.

## 5. What not to do

- Rewrite the UI first, or rewrite it to fix an audio problem.
- Port the current SynthDef line-for-line to C++/Rust; it carries the always-on architecture and five DSP bugs with it.
- Oversample before fixing grain windowing (August audit §3.2: windowing matters more).
- Trust the current CPU chip, or any Pi-side change made without a per-process measurement before and after.
- Treat the 77 xruns as a per-session figure; it is a 97-day total.

## 6. Mac and Windows

Nothing in §2.1–2.4 is binding on desktop hardware except sclang's boot time and the DSP correctness items. Phases 1, 2 and 4 improve all three platforms; Phase 0 and 3 are Pi-specific; Phase 5 would need a desktop build path (Flutter and Qt provide one; LVGL effectively does not).

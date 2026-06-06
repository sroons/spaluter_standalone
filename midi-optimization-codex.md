# MIDI Optimization Review (Codex)

**Scope:** Full review of MIDI handling paths in this codebase, with optimization recommendations only.  
**No runtime/code changes were executed as part of this review.**

## Files reviewed

- `renderer/renderer.js`
- `preload.js`
- `main.js`
- `sc/runtime.scd`
- `spaluter_supercollider.scd`
- `build/linux/postinst.sh`
- `README.md`

## Current MIDI signal path

1. MIDI input is captured in the Electron renderer via Web MIDI:
   - `navigator.requestMIDIAccess()` and `input.onmidimessage` in `renderer/renderer.js` (around lines 1405-1428 and 1384-1394).
2. Each MIDI event is handled on the renderer UI thread:
   - `handleMidiMessage` (around lines 1358-1382).
3. MIDI CC and notes call `setParamValue(..., send=true)`:
   - line ~1374 for CC
   - line ~1219 and ~1224-1225 for note/gate
4. `setParamValue` updates UI state and then calls:
   - `window.spaluterApi.setParam(param, value)` (line ~1492)
5. Preload bridges this to `ipcRenderer.invoke("sc:set-param", ...)`:
   - `preload.js` line 4
6. Main process receives each call in `ipcMain.handle("sc:set-param", ...)` and forwards each to OSC:
   - `main.js` lines ~674-679
7. SuperCollider runtime receives `/spaluter/set` and defers each update:
   - `sc/runtime.scd` lines ~178-187 (`OSCdef(\spaluterSet, ...)` + `.defer`)

---

## Key bottlenecks and likely queue-backup sources

## 1. MIDI is on the renderer/UI thread (critical)

- MIDI parsing runs in the same thread as canvas rendering, DOM work, and input handling.
- Under heavy UI activity or redraw load, MIDI handling latency and backlog risk increase.
- This is the largest architectural risk to sustained high-rate MIDI ingest.

## 2. High-frequency param updates use `ipcRenderer.invoke` (critical)

- `invoke` creates request/response promise traffic per event.
- `setParamValue` does not await the promise, so bursts can produce many in-flight invocations.
- For MIDI-rate traffic, fire-and-forget IPC is lower overhead than invoke/reply.

## 3. Every MIDI event can trigger heavy UI work (critical)

- `setParamValue` may call `updateWaveformViews()` for many parameters (line ~1488).
- `updateWaveformViews` redraws multiple canvases and labels (lines ~822-907).
- This couples control-rate MIDI to expensive UI rendering, increasing event-loop pressure.

## 4. Runtime `/spaluter/set` handler defers every message (high)

- In `sc/runtime.scd`, each incoming set message creates a deferred closure (`.defer`).
- Under bursty MIDI, this can create AppClock backlog and memory pressure.

## 5. Main process forwards each set as individual OSC message (high)

- No batching/coalescing in `main.js` before `sendOsc`.
- Event storms become OSC message storms.

## 6. Scope stream competes with control path (medium)

- Scope data continuously travels from SC runtime to app (`/spaluter/scope`) even during heavy MIDI performance.
- This is separate traffic on the same app process/event loop budget.

---

## Recommended target architecture (most efficient, no MIDI resolution loss)

## A. Move MIDI capture off the renderer thread (primary recommendation)

Use a dedicated MIDI control plane:

1. **Dedicated MIDI worker process** (preferred), or
2. **Main-process MIDI input implementation** if worker process is not yet available.

Then route:

- MIDI process -> main process (lightweight IPC)
- main process -> SuperCollider runtime (OSC)
- renderer receives only throttled visual/state updates (not full MIDI event stream)

This decouples MIDI from UI and prevents renderer jank from backing up MIDI.

## B. Keep audio and MIDI separate but coordinated

- `scsynth` remains audio engine.
- MIDI/control should not depend on renderer frame rate.
- Renderer should become observer/controller, not the real-time MIDI pipeline.

---

## Queue-management techniques to apply

All below can preserve incoming MIDI resolution.

## 1. Bounded ring buffer for MIDI events

- Store full events `{timestamp, status, data1, data2, source}`.
- Fixed-size ring prevents unbounded memory growth.
- Add telemetry: current depth, max depth, overrun count.

## 2. Micro-batching to OSC bundles

- Flush queue every 0.5-2 ms (or by max batch size).
- Send OSC bundles with event order preserved.
- Reduces syscall/IPC overhead while preserving all event values.

## 3. Duplicate-value suppression only (safe)

- If the same param receives identical value repeatedly, suppress duplicate sends.
- This does **not** reduce MIDI resolution; it only removes redundant repeats.

## 4. Split control path from UI path

- Audio/control path: full-rate event handling.
- UI path: sampled snapshots (e.g., 30-60 Hz repaint budget).
- Never block control path on UI repaint.

## 5. High-watermark backpressure signals

- Emit warnings when queue depth exceeds threshold.
- Optional emergency behavior: temporarily reduce nonessential traffic (e.g., scope stream), not MIDI precision.

---

## Concrete code-level recommendations by file

## `renderer/renderer.js`

1. Remove renderer from critical MIDI path.
   - Keep Web MIDI only as fallback/dev mode.
2. If renderer path remains:
   - Avoid calling heavy `updateWaveformViews()` per MIDI event.
   - Mark dirty and repaint in `requestAnimationFrame`.
3. Keep note handling logic but send via low-overhead fire-and-forget channel.
4. Add local value-change checks before emit (`if newValue !== lastSentValue`).

## `preload.js`

1. Add fire-and-forget API for high-rate param writes (e.g., `setParamFast`) using `ipcRenderer.send`.
2. Keep `invoke` for request/response operations only (sample browsing, initial state).

## `main.js`

1. Add `ipcMain.on("sc:set-param-fast", ...)` path (no reply).
2. Add MIDI/control queue and micro-batch flush.
3. Batch OSC sends (bundle) where possible.
4. Add metrics:
   - messages/sec in
   - queue depth and peak
   - flush latency
   - dropped/redundant counts

## `sc/runtime.scd`

1. Rework `/spaluter/set` handling to avoid per-message deferred closure churn.
2. Apply updates in a controlled scheduler loop or direct-safe path, preserving order.
3. Keep `~spaluter.set` traffic lean; avoid extra allocations in hot path.

## `spaluter_supercollider.scd`

1. No direct MIDI ingest currently; synth control is OSC-driven.
2. Optional high-efficiency path: ingest MIDI directly in runtime layer and map to synth params there, bypassing renderer.

---

## Threading options considered

## Option 1 (best): Dedicated MIDI process

- Pros: strongest isolation from UI stalls; independent scheduling/priority; easiest monitoring.
- Cons: adds one process and IPC boundary.

## Option 2: Main-process MIDI

- Pros: fewer moving parts than separate process; still removes MIDI from renderer thread.
- Cons: main process still handles other app responsibilities.

## Option 3: Runtime-level MIDI (SuperCollider side)

- Pros: shortest control path to synth; renderer fully out of loop for realtime control.
- Cons: requires mapping/config protocol between UI and runtime.

---

## Patchbox/Linux system configuration recommendations

These are host-level tuning options to reduce queue buildup and jitter:

1. **Realtime scheduling**
   - Ensure audio/MIDI daemons have RT priority permissions (rtkit/limits).
   - Raise scheduling priority for dedicated MIDI process/control service.

2. **CPU governor**
   - Use `performance` governor during performance sessions.

3. **IRQ prioritization**
   - Prioritize audio and USB-MIDI related IRQs (especially on Pi where USB and audio compete).
   - Consider `threadirqs` + IRQ priority tuning.

4. **USB stability**
   - Disable USB autosuspend for MIDI interface(s).
   - Prefer direct port / powered hub to avoid bus contention.

5. **Service affinity/isolation**
   - Pin UI/Electron and MIDI/control services to separate CPU sets when possible.
   - Keep scsynth/audio on a stable core set.

6. **Socket/buffer tuning**
   - Increase local UDP buffer limits for OSC if burst loss/backlog is observed.

7. **PipeWire/JACK stability checks**
   - Keep PipeWire/WirePlumber healthy and avoid parallel audio stacks competing for devices.

---

## Implementation order (recommended)

1. Move MIDI capture off renderer (dedicated process or main process).
2. Replace invoke-per-event with fire-and-forget + queue/micro-batching.
3. Decouple UI redraws from MIDI/control update cadence.
4. Remove per-event `.defer` pressure in runtime `/spaluter/set` handler.
5. Apply system-level RT/IRQ/governor tuning and add queue telemetry.

---

## What not to do (to preserve MIDI resolution)

- Do not downsample CC to coarse steps.
- Do not global-rate-limit MIDI events in a way that drops unique values.
- Do not tie control event processing to UI frame rate.
- Do not leave unbounded queues without depth monitoring.

---

## Expected result after applying recommendations

- Stable high-rate MIDI input without UI-induced backlog.
- Lower event-loop pressure in renderer and main.
- Lower risk of queue growth leading to process instability/crash.
- Full incoming MIDI value resolution preserved.

---

# Claude's Review of Codex's Proposals

**Bottom line:** Codex's diagnosis of the hot path is correct and we agree on
~80% of the prescriptions. There are four places where I'd push back or
re-prioritise, and a handful of omissions worth filling in. Going
section-by-section.

## Diagnosis (sections 1–6)

- **Sections 1, 2, 3, 4, 5 — all correct.** These are the same five
  problems my own review identified and ranked the same way. Section 3
  (heavy UI work per event) is in practice the loudest contributor on this
  hardware — `updateWaveformViews()` fires for **14 specific param
  symbols** (`pulsaret`, `window`, `duty`, `dutyMode`, `formantCount`,
  `formantTrack`, `formant1..3`, `maskMode`, `perFormantMask`, `maskAmount`,
  `burstOn`, `burstOff`). Worth naming them so the eventual fix knows
  exactly which paths trigger the redraw.
- **Section 6 (scope competes with control)** — agree it's medium-severity,
  but I'd add: the scope stream is the only path that runs *constantly*
  even when no MIDI is moving, so under steady state it's the bigger
  contributor; under burst load it's marginal. Solution is the same in
  both cases (auto-suppress scope when in MIDI-burst mode, or just when the
  scopes screen is off-screen — the code already does the latter).

## A. "Move MIDI capture off the renderer thread"

Strong agreement on the direction. Two correctness pushbacks:

- **"Dedicated MIDI worker process (preferred)"** — I'd flip this. On a
  Pi 4 with 4 cores, a separate OS process adds a scheduler entity, ~30 MB
  resident memory, and a serialised IPC boundary that has to copy every
  event. A **`worker_threads` worker inside the existing main process** is
  strictly better here: same isolation from UI stalls, postMessage with
  transferable Uint8Arrays, no extra process accounting. Reserve a
  separate process for things that genuinely need crash isolation (the
  audio engine, which is already separate via sclang/scsynth).
- **Codex does not flag the Web MIDI / Worker constraint.**
  `navigator.requestMIDIAccess` is **not** exposed in `Worker`,
  `SharedWorker`, or `AudioWorkletGlobalScope`. The only way to move MIDI
  off the renderer main thread is to open the device from Node in the main
  process (native module like `@julusian/midi`). Any plan that says
  "renderer worker for MIDI" without naming this is a footgun. Worth
  adding explicitly.

## B. "Keep audio and MIDI separate but coordinated"

Agree. Nothing to add.

## Queue-management techniques (1–5)

- **#1 Bounded ring buffer** — agree on telemetry, push back on
  framing. The crash isn't caused by accumulated 3-byte MIDI events
  (those are negligible); it's caused by accumulated **Promise reply
  registrations** from `ipcRenderer.invoke` and accumulated **canvas redraw
  work**. A ring buffer for MIDI events is sound hygiene but won't move the
  needle unless A3 (`invoke` → `send`) is also done. Suggest re-ordering or
  noting this.
- **#2 Micro-batching every 0.5–2 ms** — I disagree on the cadence.
  0.5–2 ms is JACK-block territory; you do not need it for CC delivery on
  a Pi 4, and it defeats the point of batching (most bursts will produce
  1-event batches at 1 kHz). **rAF (~16 ms) is the right cadence for CCs**
  bound to UI. For audio-only paths (no UI element), one PipeWire quantum
  (~2.7 ms at 128/48k) is plenty. Critically: **Note On/Off must not be
  batched at any cadence** — send immediately, preserve order. Codex says
  this generally but the 0.5–2 ms framing buries it.
- **#3 Duplicate-value suppression** — agree, cheap and safe, and there's
  another free win adjacent: skip DOM write if the normalized value didn't
  change either, not just the OSC send.
- **#4 Split control path from UI path** — strongly agree. This is the
  single most useful framing in Codex's document.
- **#5 High-watermark backpressure** — agree on telemetry. On the
  "emergency behavior" point: rather than reactive degradation when
  depth crosses a threshold, the renderer should *unconditionally* defer
  non-audio work (scope draws, log appends, knob label re-layout) while
  any MIDI is in flight in the current frame. Reactive degradation is hard
  to test and confusing to users.

## Concrete code-level recommendations

- **renderer/renderer.js #2 "Mark dirty and repaint in rAF"** — this is
  the highest-ROI single change in the whole document. It should not be
  filed as "if renderer path remains" — it's worth doing even on the way
  to ripping renderer MIDI out, because the same canvases get redrawn from
  knob drags, preset loads, and `updateRealtimeParamValue` too. Promoting
  it.
- **renderer/renderer.js #4 "local value-change checks before emit"** —
  agree, but worth noting that there's also a redundant double-emit in
  `updateGateFromMidiNotes` which sends `gate` *and* `trigIn` as two IPC
  invokes per note event. That should collapse to one OSC bundle or a
  single `/spaluter/note` verb.
- **preload.js `setParamFast`** — agree. Suggest also exposing
  `setParamMany(entries)` so the renderer can hand the main process an
  already-coalesced batch instead of forcing the main process to do the
  coalescing.
- **main.js #3 "Batch OSC sends (bundle) where possible"** — agree.
  Worth specifying: OSC bundles with `timeTag(0)` (immediate) are
  dispatched atomically by scsynth in the same audio block, which is a
  bonus — it eliminates the micro-zipper artefacts you currently get
  when two related CCs change a block apart. Underselling this.
- **sc/runtime.scd #1 "avoid per-message deferred closure churn"** —
  agree. Concretely: the `.defer` in `OSCdef(\spaluterSet)` (line 178) is
  defensive copy-pasta; `~spaluter.set` is safe to call from sclang's OSC
  responder thread because it just hands an OSC message to scsynth. Drop
  the `.defer`, drop the `{ }.()` wrapper. Adding `/spaluter/set-many` is
  also straightforward (`~spaluter.set(*msg.drop(1))`).
- **spaluter_supercollider.scd #2 "Optional high-efficiency path: ingest
  MIDI directly in runtime layer"** — **this is the best path on this
  hardware, not optional.** sclang has `MIDIClient.init` +
  `MIDIFunc.cc/noteOn` built in; the language thread parses each event
  and turns it into one `n_set` (or `bus.set`) with no IPC, no UDP
  loopback, no Electron round-trip. Filing it as "optional" massively
  understates its impact. The trade-off is just where the CC-to-param
  mapping lives — push a snapshot of the map from JS to sclang each time
  the user edits it (rare), and the hot path no longer touches JS at all.

## Threading options considered

- **Option 1 "Dedicated MIDI process" labelled best** — disagree on this
  Pi 4. `worker_threads` inside main (Codex's Option 2 + a worker) gets
  you the same isolation at much lower cost. Reserve separate processes
  for crash boundaries you actually need.
- **Option 3 "Runtime-level MIDI (SuperCollider side)"** — this is the
  *best* option on Pi for steady-state performance, for the reasons above.
  Codex lists it last almost as an afterthought; I'd promote it to "best
  for pure performance, ship if you can afford the mapping-sync
  protocol."

## Patchbox/Linux system configuration

Codex's list is correct but light. Missing items I'd add:

- **CPU isolation.** `isolcpus=3 nohz_full=3 rcu_nocbs=3` on
  `/boot/firmware/cmdline.txt` + `taskset -pc 3 $(pgrep scsynth)`. This is
  the single biggest worst-case-latency win on the Pi 4 and Codex omits
  it. "Service affinity/isolation" (Codex #5) hints at it but doesn't
  give the mechanism.
- **systemd unit limits.** Codex's "rtkit/limits" needs to show up in the
  app's own `spaluter.service`: `LimitRTPRIO=95`, `LimitMEMLOCK=infinity`.
- **Swap.** PatchboxOS ships swap on; with Electron + scsynth + sclang
  resident, paging is fatal. `vm.swappiness=1`, or disable
  `dphys-swapfile` if RAM headroom allows.
- **USB autosuspend (Codex #4)** — concrete persistence: udev rule keyed
  on the Grid's `idVendor=303a, idProduct=8123`. Just saying "disable
  autosuspend" leaves the user to figure out persistence.
- **`triggerhappy.service`** — consumes input events and competes for IRQ
  servicing on Pi; safe to disable on a dedicated device. Codex doesn't
  mention it.

## Implementation order

Codex puts "move MIDI off renderer" as step #1. I'd flip:

1. The tactical, in-place fixes first: dirty-flag the canvas redraws, drop
   `.defer` in sclang, switch `invoke` → `send`, combine `gate+trigIn`,
   add the no-op early-out. All <100 lines, fully reversible, addresses
   the proximate cause directly.
2. Measure with a Grid sweep test (60 s, watch `top`, scsynth late count,
   renderer heartbeat).
3. Only then commit to either main-process MIDI (`@julusian/midi`) or
   sclang-owned MIDI (`MIDIFunc.cc`). One of the two — not both. My pick
   is sclang-owned for this hardware.
4. System tuning (limits, isolcpus, swap, USB autosuspend) in parallel
   with #1; it's independent of any code change.

This ordering protects you from doing the expensive architectural move
and then discovering the proximate cause was a 10-line fix. Codex's
order risks the opposite.

## What not to do — additions

Codex's list is good. I'd add:

- Do not move CC mapping into the OSC-receiving thread of sclang while
  also keeping JS as the authoritative store; pick one. Two stores get out
  of sync, silently.
- Do not coalesce Note On/Off under any circumstance. (Codex implies this
  but it's worth stating outright in the "what not to do" list.)
- Do not assume Web MIDI is available in Workers; it isn't.

## One-line summary of the disagreements

| # | Codex | Claude |
|---|---|---|
| Best threading | Separate process | worker_threads inside main |
| Best perf option | sclang-direct (optional) | sclang-direct (recommended) |
| Batch cadence | 0.5–2 ms | rAF for UI, immediate for Notes |
| Implementation order | Architecture first | Tactical fixes first, measure, then architecture |
| Missing | `isolcpus`, swap, udev rule, Web MIDI/Worker limitation | — |


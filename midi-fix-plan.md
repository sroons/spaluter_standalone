# MIDI Fix Plan

**Status legend:** ✅ done · 🟡 in-progress · ⏸ blocked / awaiting user · ⬜ pending

Synthesises the proposals in `midi-optimization-claude.md` and
`midi-optimization-codex.md` (including the Claude review of the Codex
doc) into a single execution plan. Ordered so cheap, reversible fixes
land first, with a measurement step after each phase. Stop after any
phase if metrics show the queue backup is resolved.

**Constraints carried over from the user:**
- Do not sacrifice resolution of the incoming MIDI stream. Every CC
  value is captured; the merging strategy keeps the latest value of every
  CC between flushes. Notes are never coalesced or reordered.
- Macbook: changes made directly. Raspberry Pi: changes made over SSH.
- Nothing in this plan has been executed.

---

## Phase 0 — Baseline & instrumentation (do first, do not skip)  ✅

**Goal:** capture today's behaviour so every subsequent phase can be
judged on numbers, not vibes.

0.1 ✅ Passive baseline captured on Pi: process state, xhci IRQ delta
(33.7/s idle on CPU0), kernel 6.12.87, governor `ondemand`, rtprio 95,
audio cards (Grid + CVThing + pisound visible).
Sweep-driven baseline (Grid moving) is **not** captured — that
requires a controller-in-hand session and is best done as the
post-Phase-1 measurement, immediately compared to before/after.

0.2 ✅ `main.js` diagnostic added: per-second `/spaluter/set` rate +
peak + in-flight counter, logged via existing `sendLog` so it appears
in the renderer log panel.

0.3 ✅ Saved at
`~/.copilot/session-state/6e5e8d0f-…/files/midi-baseline-20260606-112328.txt`.

**Exit criterion:** baseline captured. No code changed beyond 0.2.

---

## Phase 1 — Renderer-side tactical fixes (no architecture change)  ✅ code · ⏸ awaiting user relaunch + sweep test

Each step is independently revertable. After each, restart the app and
repeat the Phase 0.1 sweep. Stop the whole plan early if the queue
backup is gone.

### 1.1 ✅ No-op early-out in `setParamValue`
**File:** `renderer/renderer.js` (function `setParamValue`)
**Implemented:** added `lastSentValueByParam` Map; if the normalized
value matches what we last sent for that param **and** `send=true`,
return immediately before touching DOM/IPC. `send=false` callers
(state-restore paths) bypass the early-out so they can still update UI.

### 1.2 ✅ rAF-coalesce `updateWaveformViews()`
**File:** `renderer/renderer.js`
**Implemented:** replaced the inline `updateWaveformViews()` call
inside `setParamValue` with `scheduleWaveformViewsRedraw()`, which
sets `waveformViewsDirty=true` and rAF-schedules a single redraw.
Cancelled on `beforeunload`.

### 1.3 ✅ CC coalescing per animation frame
**File:** `renderer/renderer.js` (`handleMidiMessage`)
**Implemented:** CC branch writes into `pendingCcParamValues:
Map<param, value>` via `stagePendingParam()`; the rAF drain iterates
and calls `setParamValue` once per `(param, frame)`. Notes still go
through the immediate path (no coalescing). Hot path also switched
from `Number(data[i])` to `data[i] | 0` to avoid the slow numeric path.

### 1.4 ✅ Collapse `gate`/`trigIn` double emit
**File:** `renderer/renderer.js` (`updateGateFromMidiNotes`, `applyMidiNotePitch`)
**Implemented:** `gate`, `trigIn`, and the note-derived `basePitch` now
all route through `stagePendingParam()`, so a Note On/Off produces
**one** rAF-flushed batch instead of three immediate IPC invokes.
Phase 2's `setParamMany` will collapse that batch into a single OSC
bundle; for now each staged value still goes through `setParamValue` →
`spaluterApi.setParam` independently.

### Phase 1 deploy ✅
- Build worktree at `/tmp/spaluter-build-1780770404` (detached HEAD =
  `f5876ee` + uncommitted Phase 0.2 + 1.1–1.4 patches + `homepage` injection).
- `npm install` (353 packages, 11 s) + `npm run build:pi` produced
  `Spaluter Desktop-0.1.0-linux-arm64.deb` (68 MB).
- `scp` to `patch@patchbox.local:/tmp/spaluter-midi-phase1.deb`,
  installed via `sudo apt install`.
- Pisound device pin re-injected into the new
  `app.asar.unpacked/sc/runtime.scd` (the .deb install wipes it).
- Killed running app chain (PID 1651 xinit) so next launch picks up the
  new build.

### Phase 1 measure ✅
Captured 108 one-second samples during a Grid sweep on
`spaluter-desktop` PID 2576 (started 19:38:16 BST).

| metric | value |
|---|---|
| `/spaluter/set` rate p50 | 62/s |
| `/spaluter/set` rate p90 | 97/s |
| `/spaluter/set` rate p99 | 111/s |
| `/spaluter/set` rate peak | 132/s |
| IPC in-flight peak | 1 |
| scsynth xrun/late markers | 0 |
| App restarts during sweep | 0 |
| CPU: electron / sclang / scsynth | 18% / 9% / 41% |

132/s peak ≈ 60 Hz × ~2 simultaneously-moved params, exactly matching
the rAF-coalescing model. In-flight=1 confirms IPC drains instantly.
No xruns or restarts.

**Caveat:** the `rate` value is *post-coalescing*; a raw-incoming
counter would be a 5-line add in Phase 2 to compute the compression
ratio directly.

**Verdict:** Phase 1 has eliminated the queue-backup mechanism for
this workload. Decision gate (Phase 5) is the next step unless the
user wants Phase 2 anyway for the IPC cleanup + telemetry upgrade.

### Operational notes from this deploy
- `main.js` lives inside `app.asar`; in-place hot-patches require
  `asar extract` → modify → `asar pack`. Use this if the `[MIDI-DIAG]`
  log line needs `console.log` parity for SSH visibility.
- `.deb` install **wipes** the pisound device pin in
  `app.asar.unpacked/sc/runtime.scd`. Re-injection step is mandatory
  after every reinstall (or commit the pin to `main`).
- Kiosk session is launched by `xinit` (no shell rc hook, no systemd
  service). Restarting it requires `kill <xinit-pid>` and a manual
  relaunch from the user's tty1 session.

**End of Phase 1 — measure.** If queue backup is gone, you may stop.

---

## Phase 2 — IPC transport (fire-and-forget)

### 2.1  Add `spaluterApi.setParamFast` and `setParamMany`
**File:** `preload.js`
**Change:**
- `setParamFast: (key, value) => ipcRenderer.send("sc:set-param-fast", { key, value })`
- `setParamMany: (entries) => ipcRenderer.send("sc:set-param-many", entries)`
- Keep `setParam` (invoke) for callers that genuinely need a reply (none
  currently do — `setParamValue` doesn't await it — so this is dead
  weight but leave it for backwards compat for now).

### 2.2  Add `ipcMain.on("sc:set-param-fast", …)` and `…-many`
**File:** `main.js`
**Change:** new `ipcMain.on` handlers (note: `on`, not `handle`).
`sc:set-param-many` accepts `Array<[key, value]>` and calls a new
`sendOscBundle()` helper (Phase 3.1).

### 2.3  Switch renderer to `setParamMany` from the rAF drain
**File:** `renderer/renderer.js`
**Change:** in the rAF loop introduced in 1.3, collect all
`(param, value)` pairs from the drain and call
`spaluterApi.setParamMany(entries)` instead of one `setParam` per pair.
**Why:** one IPC + one UDP packet per frame instead of N.
**Risk:** low — pure perf.

**End of Phase 2 — measure.** Renderer should be quiet during sweeps.

---

## Phase 3 — OSC bundling + sclang cleanup

### 3.1  `sendOscBundle()` helper in main
**File:** `main.js`
**Change:** add helper that wraps `osc.UDPPort.send({ timeTag:
osc.timeTag(0), packets: [...] })`. One bundle = one UDP datagram = one
audio block on the SC side. Use it from the `sc:set-param-many`
handler.
**Why:** atomic dispatch on scsynth eliminates micro-zipper artefacts
when related CCs change a block apart.

### 3.2  `/spaluter/set-many` in sclang
**File:** `sc/runtime.scd`
**Change:** add `OSCdef(\spaluterSetMany, { |msg| ~spaluter.set(*msg.drop(1)) }, "/spaluter/set-many")`.
**Why:** one server roundtrip instead of N.

### 3.3  Drop `.defer` in `/spaluter/set` (and `/spaluter/set-many`)
**File:** `sc/runtime.scd` (line 178)
**Change:** remove `.defer` wrapper. `~spaluter.set` is safe from
sclang's OSC responder thread — it just hands an OSC message to scsynth.
**Why:** removes AppClock serialisation backlog under burst.
**Risk:** low, but worth one targeted soak test.

### 3.4  (Optional) `/spaluter/note` verb
**Change:** dedicated OSC address `(note, vel)` that sclang handles by
setting `gate`/`trigIn` + `basePitch` in one server call. Replaces 1.4's
staged path with a direct one. Skip if 1.4 is already adequate.

**End of Phase 3 — measure.** sclang `AppClock` backlog should be gone.

---

## Phase 4 — Pi system tuning (run in parallel with code phases; SSH)

These are independent of the JS changes. They reduce kernel-side worst
case and protect against jitter. Each is a separate change with its own
verify step. All applied over SSH to `patch@patchbox.local`.

### 4.1  RT limits for the audio user
- `/etc/security/limits.d/95-spaluter.conf` (new) with `rtprio 95`,
  `memlock unlimited`, `nice -19` for `patch` and `@audio`.
- Verify: log out / log in, `ulimit -r` returns 95.

### 4.2  Systemd unit RT properties
- Edit `~/.config/systemd/user/spaluter.service` add
  `LimitRTPRIO=95`, `LimitMEMLOCK=infinity`, `Nice=-10`.
- Reload + restart unit.

### 4.3  CPU governor = performance
- `cpufreq-set -g performance` on all cores.
- Make persistent via a small systemd unit.
- Verify: `cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor`.

### 4.4  Disable USB autosuspend for the Grid
- `/etc/udev/rules.d/90-intech-grid.rules` (new) keyed on
  `ATTR{idVendor}=="303a", ATTR{idProduct}=="8123"` setting
  `ATTR{power/control}="on"`.
- `udevadm control --reload && udevadm trigger`.
- Verify: `cat /sys/bus/usb/devices/<id>/power/control` returns `on`.

### 4.5  Disable competing services
- `systemctl disable --now bluetooth hciuart triggerhappy avahi-daemon
  ModemManager` (only those present; verify before disabling).
- Verify with `systemctl list-units --state=running`.

### 4.6  Swap pressure
- `vm.swappiness=1` in `/etc/sysctl.d/95-spaluter.conf`.
- Verify: `sysctl vm.swappiness`.
- Optionally `dphys-swapfile swapoff && systemctl disable
  dphys-swapfile` (only if free RAM stays above ~1 GB under load).

### 4.7  Pin xHCI IRQ to a non-audio core
- Find IRQ: `grep xhci /proc/interrupts`.
- Set affinity: `echo 2 > /proc/irq/<N>/smp_affinity` (bit 1 → CPU 1).
- Persist via systemd one-shot.

### 4.8  (Bigger) CPU isolation for the audio core
- Append `isolcpus=3 nohz_full=3 rcu_nocbs=3` to
  `/boot/firmware/cmdline.txt`.
- Reboot.
- Post-reboot: `taskset -pc 3 $(pgrep scsynth)` (wire into the launcher
  so it sticks).
- Biggest worst-case-latency win; do this last in Phase 4 because it
  requires a reboot and changes scheduling semantics.

**End of Phase 4 — measure.** Compare against Phase 0 baseline.

---

## Phase 5 — Decision gate

After Phases 1–4, repeat the Phase 0.1 sweep. Three possible outcomes:

1. **Queue backup resolved, no crashes, latency acceptable.** Stop here.
   Phases 6/7 become future work.
2. **Mostly resolved but heavy bursts still cause UI jank.** Skip to
   Phase 7 (telemetry + scope auto-suppress). Do not go to Phase 6 yet.
3. **Still backing up under sustained burst.** Proceed to Phase 6.

---

## Phase 6 — Architectural move: sclang-owned MIDI (if needed)

This is the highest-performance option on Pi 4 hardware. JS leaves the
hot path entirely. Only do this if Phase 5 says it's warranted; it
introduces a mapping-sync protocol that is more code to maintain.

### 6.1  Add `MIDIClient.init` + `MIDIFunc.cc/noteOn` to runtime
**File:** `sc/runtime.scd`
**Change:** after server boot, call `MIDIClient.init; MIDIIn.connectAll;`
and register `MIDIFunc.cc` / `MIDIFunc.noteOn` / `MIDIFunc.noteOff`
that look up the (cc → param) mapping and call `~spaluter.set` (or
`bus.set` if Phase 6.4 is done).

### 6.2  Mapping-sync protocol JS → sclang
**Files:** `preload.js`, `main.js`, `sc/runtime.scd`
**Change:** when the user edits a CC mapping in the UI, JS pushes the
whole map to sclang via `/spaluter/midi-map` (rare event, so cheap).
sclang stores it in a `Dictionary` keyed by CC, value = (paramSymbol,
min, max, type, step). sclang becomes the authoritative store **for the
hot path**; JS keeps its persisted copy as the source of truth and
publishes on change.

### 6.3  Renderer becomes observer
**File:** `renderer/renderer.js`
**Change:** drop `navigator.requestMIDIAccess` (keep behind a dev flag
for non-Pi development). To keep the UI in sync, sclang can send
`/spaluter/param-changed` snapshots at a coalesced rate (e.g. 30 Hz)
that the main process forwards to the renderer as a single state diff.

### 6.4  (Optional) control-rate buses for the busiest params
**Files:** `sc/runtime.scd`, `spaluter_supercollider.scd`
**Change:** rewire selected params (`basePitch`, formant1..3, etc.) to
read from `In.kr(bus)`; `MIDIFunc.cc` writes the bus with `bus.set`
instead of `n_set`. Pairs naturally with 6.1.

**End of Phase 6 — measure.** Should be the steady-state ceiling.

---

## Phase 7 — Telemetry + backpressure

Useful after any of the earlier phases; cheap to add.

### 7.1  Queue-depth telemetry in main
- `/spaluter/set-many` flush count, max bundle size, max queue depth,
  last-flush latency. Expose via a renderer IPC + a small DevTools
  overlay (or log once/sec).

### 7.2  Auto-suppress scope when off-screen *or* when MIDI is bursting
**File:** `main.js`, `renderer/renderer.js`
**Change:** when the scopes screen is not visible, scope streaming is
already disabled — keep that. Additionally: if the current rolling
1-second MIDI event rate exceeds a threshold (e.g. 200 events/sec),
temporarily suspend `/spaluter/scope-config` until the burst ends.

### 7.3  High-watermark warnings
- Log a single-line warning when queue depth crosses a threshold and
  again when it recovers. No silent runaway.

---

## Logical groupings & dependencies

```
Phase 0 (baseline) ──┐
                     ├──► Phase 1 (renderer tactical)
                     │      └── 1.1 → 1.2 → 1.3 → 1.4
                     │
                     ├──► Phase 4 (system tuning, SSH; parallel to 1-3)
                     │      └── 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
                     │
                     └──► Phase 2 (IPC fire-and-forget; after 1)
                             └──► Phase 3 (OSC bundle + sclang clean; after 2)
                                     └──► Phase 5 (decision gate)
                                             ├──► Phase 6 (sclang MIDI; if needed)
                                             └──► Phase 7 (telemetry; anytime)
```

Hard ordering constraints:
- 1.2 before 1.3 (rAF drain depends on the dirty-flag pattern).
- 2.2 before 2.3 (renderer can't call a handler that doesn't exist).
- 3.1 before 3.2/3.3 (bundle helper used by the new handler).
- 4.8 last in Phase 4 (requires reboot).
- 6.1 before 6.3 (don't take MIDI away from JS until sclang owns it).

Phases 1, 2, 3 each end with a measure step. Re-run Phase 0.1's sweep,
compare against the baseline file, decide whether to continue.

## Out of scope (explicit non-goals)

- Changing the SynthDef in `spaluter_supercollider.scd` beyond optional
  Phase 6.4.
- Dropping/reordering Note On/Off events at any layer.
- Adding new lint/build/test tooling.
- Replacing Electron, scsynth, or PipeWire.
- Reflashing or reinstalling PatchboxOS.

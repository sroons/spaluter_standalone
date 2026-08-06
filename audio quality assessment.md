# Audio Quality Assessment

Scope: recent commits on `mods_update` (merge-base `bb64fdc` → `fa1a2a9`) plus the preceding audio-engine work on `main`. Findings below are ordered by how likely they are to produce an audible degradation, with the evidence that supports each one.

---

## Key mechanism that makes UI changes audible — **FIXED**

> **Status:** fixed in `sc/runtime.scd` (`applyLfo`). A running LFO now absorbs
> `rate`/`depth`/`shape` in place via `synth.set(...)`; a free+respawn happens only
> when the target, enable state, or phase actually changes. Built and deployed to
> the Pi (`patchbox.local`), verified with `Synth started` and 0 `SC-ERR`.

Every LFO parameter update **was** destructive on the engine side. `OSCdef(\spaluterLfoSet)` → `applyLfo` → `spawnLfo`, and `spawnLfo` frees and recreates the LFO synth:

```supercollider
// sc/runtime.scd:180-211
releaseLfo = { |idx|
    old.set(\enabled, 0);
    AppClock.sched(0.12, { old.free; nil });   // 120 ms ramp-down overlap
};
spawnLfo = { |idx|
    releaseLfo.value(idx);
    lfoSynths[idx] = Synth(\spaluterLfo, [... \phase, cfg[\phase] ...], lfoGroup, \addToTail);
};
```

Consequences of each update: the LFO **phase is reset** to `cfg.phase`, and the old synth keeps running for ~120 ms alongside the new one, so the modulation bus briefly sums **two** LFOs. Any code path that sends LFO updates rapidly therefore produces modulation stair-stepping, phase jumps, and doubled modulation depth — which is heard as warble, zipper noise, and instability, plus node churn on the Pi.

This made the renderer's update *rate* a direct audio-quality factor. The fix removes
that coupling: slider drags now stream `set` messages into the live LFO instead of
recreating it dozens of times per second.

**Note on the previous "restore the `disabled` lock" recommendation:** that is
deliberately *not* applied. In the new panel the same input doubles as the Ratio
control in MIDI-clock mode, so disabling it would remove the intended feature.
With the engine fix in place the churn is gone regardless, and the UI writer and
`syncMidiClockLockedLfos` both derive the rate from the same clock × ratio, so they
agree rather than conflict.

---

## 1. HIGH — The rate/ratio slider is no longer locked in MIDI-clock mode (new in `03e9761`) — **mitigated**

> **Status:** the harmful part (respawn churn during drags) is resolved by the
> `applyLfo` fix above. The slider intentionally stays enabled because it is now
> the Ratio control in MIDI-clock mode.

**Before (`bb64fdc`, `refreshLfoStrip`):**
```js
r.rateEl.disabled = Boolean(c.useMidiClock);
r.rateEl.classList.toggle("is-locked", Boolean(c.useMidiClock));
```

**After (`renderer/renderer.js:2969-2982`, current):** the `disabled` / `is-locked` handling was **removed entirely**. The new panel aliases one input for both roles (`const ratioEl = rateEl;`, `renderer/renderer.js:2791`) and mutates `min`/`max`/`step` at runtime.

Why this hurts sound quality:

- The control is now always draggable, and it is wired to the high-frequency `input` event (`renderer/renderer.js:2934`), so a single drag emits dozens of `onChange` → `sendLfo(index)` calls per second.
- Each of those is a **free + respawn** of that LFO synth (see mechanism above): repeated phase resets and 120 ms double-LFO overlaps for the whole duration of the drag.
- In MIDI-clock mode this now also fights `syncMidiClockLockedLfos` (`renderer/renderer.js:1626-1655`), which independently rewrites `cfg.rate` from the incoming clock and pushes its own IPC updates. Two writers now drive the same LFO rate, where previously the UI writer was locked out.

This is the clearest *newly introduced* path to audible modulation glitching.

## 2. HIGH — Wasted per-frame canvas rendering to a detached canvas (new in `03e9761`, still present)

`createLfoStrip` no longer creates a real waveform canvas, but keeps a throw-away one in the refs:

```js
// renderer/renderer.js:2827-2833
const dummyCanvas = document.createElement("canvas");
const refs = { ..., canvas: dummyCanvas, // Removed the real canvas!
               impactDeltaEl: document.createElement("div"), // unused
```

The RAF loop still renders into it ~20×/s for every active LFO:

```js
// renderer/renderer.js:3247-3261
for (let i = 0; i < LFO_MAX; i += 1) {          // LFO_MAX = 16
  ...
  refreshLfoStripImpact(i, now);
  drawLfoThumb(r.canvas, c, i, cursorT);        // draws to the detached canvas
}
```

`drawLfoThumb` → `ensureLfoThumbCache` (`renderer/renderer.js:2510-2530`) does `getContext`, `clearRect`, `drawImage`, and can allocate an offscreen canvas. Because the dummy canvas is never laid out, its measured metrics are degenerate, so the cache key is unstable and the base render can repeat every tick instead of being cached.

On the Raspberry Pi 4 target — where Electron and `scsynth` share the same CPU — this is pure wasted work in a hot loop and directly raises xrun/dropout risk while the Mods screen is open. `refreshLfoStripImpact` additionally writes `impactDeltaEl`, an element that is never in the DOM.

## 3. MEDIUM — `sampleRate` became an LFO target (`a0de697`)

```supercollider
// spaluter_supercollider.scd:136
(wphase * BufFrames.kr(bufnum) * (sampleRate + mod[19]).max(0.01)).wrap(...)
```
with `\sampleRate, 1.0` as the mod depth cap (`sc/runtime.scd:138`) and `{ name: "sampleRate", label: "Sample Rate", cap: 1.0 }` in the renderer (`renderer/renderer.js:2184`).

At high depth the sample read rate swings between ~0.01× and ~2×, i.e. extreme pitch/warble and near-stall playback. It is *additive and off by default*, so it only degrades sound when a preset or LFO route actually targets it — but it is the single most destructive target available, and it is new.

Note that pairing this with issue #1 is the worst case: dragging the depth/rate control on a `sampleRate`-routed LFO respawns the LFO repeatedly while it is sweeping the sample read rate.

## 4. MEDIUM — Bulk LFO re-push respawns all 16 LFOs at once

`fa1a2a9` correctly restored the engine push that `03e9761` had dropped:

```js
// renderer/renderer.js:3118-3124
window.spaluterApi.setLfoCount(lfoCount);   // lfoCount = LFO_MAX = 16
sendAllLfos();
```

`sendAllLfos` sends **all 16** configs unconditionally, and each one goes through `applyLfo` → `spawnLfo`. So every preset load (`applyLfoState`, `renderer/renderer.js:3229`) and every synth restart triggers 16 simultaneous free+respawn cycles, each with a 120 ms overlap window. This is a burst of modulation discontinuity and node churn at exactly the moment the user is auditioning a new sound.

This restores pre-`03e9761` behaviour rather than being a new regression, but it is the amplifier that makes the other issues worse, and it is worth making incremental (send only changed entries).

## 5. LOW/MEDIUM — Recording scripts can leave the system in a degraded audio state (`d3b9930`, `5c99d1e`)

`scripts/spaluter-pi-record.sh` forces the PipeWire quantum up for the duration of a capture:

```bash
REC_QUANTUM="${REC_QUANTUM:-2048}"   # ~43 ms
pw-metadata -n settings 0 clock.force-quantum "$REC_QUANTUM"
```

It is reverted via a `cleanup` trap on `EXIT INT TERM`. If the recorder is killed with `SIGKILL`, or the SSH session dies, the trap never runs and **`clock.force-quantum` stays pinned at 2048**, leaving the whole device at ~43 ms latency with noticeably sluggish/soft response until it is manually reset. It also pins `ffmpeg` to cores `2,3` (`REC_CPUS` default), which is only correct if `scsynth` is not on those cores.

Recovery: `pw-metadata -n settings 0 clock.force-quantum 0`.

## 6. LOW — Effects colouration is expected, not a defect (`4aa2177`, `7ca27fe`)

The Clouds-style reverb and the 4-tap delay both apply deliberate band-limiting and a limiter on the wet path:

```supercollider
// spaluter_supercollider.scd:347-350
dlyWetSig = LeakDC.ar(LPF.ar(HPF.ar([dlyTapL, dlyTapR], 70), 6800));
dlyWetSig = Limiter.ar(dlyWetSig, 0.97, 0.005);
sig = (sig * (1 - (dlyMix * 0.35))) + (dlyWetSig * dlyMix);
```

Note that the delay **ducks the dry signal** by up to 35 % as `dlyMix` rises, and the wet path is rolled off at 70 Hz / 6.8 kHz. A preset with a high `dlyWet` will therefore sound duller and quieter in the dry component than the same patch with the delay bypassed. Both effects default to fully dry (`revWet: 0.0`, `dlyWet: 0.0`, `sc/runtime.scd:272-275`), so this only applies to presets that engage them.

---

## Recommended fixes, in priority order

1. ~~**Re-lock the rate/ratio slider under MIDI clock**~~ — superseded. **Done instead:**
   `applyLfo` in `sc/runtime.scd` now updates a running LFO in place with
   `synth.set(\rate, \depth, \shape)` and only respawns on target/enable/phase changes,
   eliminating the phase resets and the 120 ms double-LFO overlap during drags.
2. **Optionally coalesce `input`-driven `sendLfo` calls** (rAF or short debounce) to trim
   IPC/OSC traffic — no longer audio-critical now that updates are non-destructive.
3. **Stop rendering into the detached canvas** — drop the `drawLfoThumb(r.canvas, ...)` call and the `impactDeltaEl` writes from `lfoCursorTick` / `refreshLfoStripImpact`, and prune the dead refs.
4. **Make the bulk push incremental** — have `sendAllLfos` send only changed configs so preset loads do not respawn all 16 LFOs.
5. **Harden the recorder** — verify `clock.force-quantum` is 0 on startup as well as on exit, so an earlier hard-killed capture cannot leave the device at 43 ms latency.
6. **Consider capping the `sampleRate` mod depth** (currently `1.0`) to a musically useful range.

## Verification suggestions

- Reproduce #1: enable MIDI clock on an LFO, drag the rate control, and watch for the LFO synth being recreated repeatedly (node churn in the SC log).
- Reproduce #2: open the Mods screen with several LFOs running on the Pi and compare CPU/xruns against the Perform screen.
- Confirm #5: `pw-metadata -n settings | grep force-quantum` on the Pi should report 0 when not recording.

# Polyphony Plan — Concurrent Independent Voices (Layer A / Layer B)

**Status:** proposal only. No build changes made.
**Target device:** Raspberry Pi 4B, 4 cores, 2 GB RAM, Patchbox OS, PipeWire → Pisound, 48 kHz / 1024 quantum (21.3 ms).
**Baseline measured on `patchbox.local`, one instance idle:** `scsynth` 52.9 % of a core; pisound graph node **busy/quantum = 0.53**; ~1040 xruns accumulated; load average 3.8–5.5.

---

## 1. Goal and terminology

The request is a **second, entirely different voice running concurrently** with the first.

This document treats that as **bi-timbral layering**: two fully independent engine instances (`Layer A`, `Layer B`), each with its own complete parameter set, its own modulation, its own MIDI assignment, and its own level/pan — summed into a shared FX and output stage.

Two distinctions worth fixing before any code is written:

| Model | What it gives you | Cost on this Pi |
|---|---|---|
| **Bi-timbral layers** (this plan) | 2 independent timbres, 2 independent pitches at once. Each layer still stacks up to 4 chord ratios × 3 formants internally. | Feasible **after** the prerequisite work in §3 |
| **Per-note polyphony** (N voices, same timbre) | N simultaneous notes of one patch | Same mechanism, `layerCount = N`; CPU caps this at ~2–3 on a Pi 4 |

The architecture below is written so `layerCount` is a **variable, not a constant** — Layer B is just index 1. Per-note polyphony later is then a configuration change, not a rewrite. But the honest ceiling on this hardware is **2 layers**.

Note what "true polyphony" already partly exists: `voiceCount` (1–4) with `chordType` builds a chord stack inside one synth (`spaluter_supercollider.scd:64`, `Mix.fill(4, ...)`). What it cannot do is give those voices *different parameters*. That is exactly what a second layer adds.

---

## 2. Why you cannot simply spawn a second `\spaluterSC`

The current runtime is built around exactly one synth node. Seven concrete blockers:

| # | Blocker | Location |
|---|---|---|
| 1 | `~spaluter` is a single global node reference; start/stop/set/MIDI all assume it | `sc/runtime.scd:110, 439-442, 475-477, 553-554` |
| 2 | One global 20-channel mod bus + one LFO group shared by all LFOs | `sc/runtime.scd:172-175` |
| 3 | Reverb is an **insert** that does `In.ar(0)` → `ReplaceOut.ar(0)` and is placed `\addAfter ~spaluter` | `spaluter_supercollider.scd:384, 528`; `sc/runtime.scd:317` |
| 4 | Both synth and reverb write straight to hardware bus 0 — there is no submix stage, so no per-layer level/pan/mute | `spaluter_supercollider.scd:198` |
| 5 | Scope replies are hardcoded to `/spaluter/scope` with no layer discriminator | `spaluter_supercollider.scd:197`; `sc/runtime.scd:44-52` |
| 6 | `/spaluter/set` is `[paramName, value]` — no layer address | `sc/runtime.scd:536-558`; `main.js:21, 840-890` |
| 7 | MIDI note handling is monophonic and drives the one node directly | `sc/runtime.scd:382-401` |

None of these is hard to fix individually. The real obstacle is §3.

---

## 3. The CPU budget — this is the whole problem

`\spaluterSC` compiles to **2758 UGens, 1987 of them audio-rate**, and it costs that whether one voice sounds or none do.

A naive second instance doubles the audio graph:

| Configuration | Audio-rate UGens | Predicted busy/quantum | Result |
|---|---:|---:|---|
| Today, 1 layer | 1987 | **0.53** (measured) | works, no headroom |
| 2 layers, as-is | ~3974 | **~1.06** | **continuous xruns — unusable** |

So **Layer B cannot be added on top of the current engine. It has to be paid for first.** The good news: the engine currently wastes most of its budget, and once that waste is removed, *two* layers can cost **less than today's single layer**.

### 3.1 Waste item 1 — the scope network (~261 always-on audio-rate UGens)

`spaluter_supercollider.scd:187-197` expands `BufRd.ar` over a 64-element array → 128 interpolating buffer readers + 64 subtract + 64 wrap, running every sample forever, to produce 128 floats 20×/sec. That is **~13 % of the audio graph**, and it is compiled into the synth — so a second layer would pay for it *twice*, for a scope that displays one thing.

**Fix:** extract the scope into its own `\spaluterScope` synth that reads an audio bus and uses `RecordBuf.ar` + trigger-time readback. Then exactly **one** scope network exists no matter how many layers run, it can be pointed at Layer A / Layer B / the mix, and it can be **freed entirely** when the Perform screen is not visible.

Saving: ~261 ar UGens per layer, plus it becomes genuinely disableable.

### 3.2 Waste item 2 — 12 grain chains always run

`Mix.fill(4, ...)` voices × `Mix.fill(3, ...)` formants = **12 grain chains always computed**, with inactive ones multiplied by zero (`vActive`, `fOn`) rather than skipped (`spaluter_supercollider.scd:64, 91, 181`). At the default `voiceCount = 1` you are paying for 12 chains to hear 3.

SuperCollider cannot skip UGens in a compiled graph, so the only fix is **SynthDef variants**: `\spaluterSC_v{1..4}_f{1..3}`, each compiling only the chains it needs. Rough per-chain cost is ~125 ar UGens.

| Layer config | Chains | Approx. ar UGens |
|---|---:|---:|
| Today (any setting) | 12 | 1987 |
| `v1_f1` | 1 | ~325 |
| `v1_f3` | 3 | ~575 |
| `v4_f3` (full) | 12 | ~1726 (post-scope-fix) |

**Two `v1_f3` layers ≈ 1150 ar UGens — about 58 % of today's single-layer cost.** That is the headroom that makes this project viable. Two `v4_f3` layers (~3450) remain out of reach and the UI must not pretend otherwise.

### 3.3 Prerequisites are mandatory, not optional

Phase 0 (§5) is not cleanup — it is the funding for Layer B. Do not start Phase 1 until §3.1 and §3.2 are measured on the device.

Also fold in, before doubling anything:

- **LFO node churn** (`sc/runtime.scd:192-211, 236-265`): every LFO edit frees and respawns a node, so one slider drag emits dozens of free/create pairs onto scsynth's command thread — which runs at **SCHED_FIFO priority 1**, the lowest there is. `\spaluterLfo` already exposes `rate`, `depth`, `shape` as control-rate args, so in-place `.set()` is sufficient for everything except target/enable/phase changes. Fix this *before* there are two banks of LFOs.
- **Renderer frame cap**: the UI runs uncapped and will consume whatever CPU the audio engine leaves.

---

## 4. Target architecture

### 4.1 Node graph

```
RootNode
├─ layerGroup[0] ──────────────── Group
│   ├─ modClear   (\modClear,  modBus[0])          head
│   ├─ lfo[...]   (\spaluterLfo → modBus[0])
│   └─ synth[0]   (\spaluterSC_vXfY, out: layerBus[0], modBus[0])   tail
├─ layerGroup[1] ──────────────── Group
│   ├─ modClear   (\modClear,  modBus[1])
│   ├─ lfo[...]   (\spaluterLfo → modBus[1])
│   └─ synth[1]   (\spaluterSC_vXfY, out: layerBus[1], modBus[1])
└─ fxGroup ─────────────────────── Group
    ├─ \spaluterMix    In.ar(layerBus[n]) × gain[n] × pan[n] × mute[n] → Out.ar(0)
    ├─ \spaluterScope  taps layerBus[0] | layerBus[1] | bus 0, SendReply → UI
    └─ \spaluterReverb In.ar(0) → ReplaceOut.ar(0)      ← UNCHANGED SynthDef
```

**Key property:** because the reverb is an insert on bus 0 and the new mixer writes to bus 0, **the reverb SynthDef needs no changes at all** — it simply becomes a shared global insert after the mix. That preserves the tank/delay state and avoids a second 210-UGen reverb instance.

New resources per layer: one `Bus.audio(s, 2)`, one `Bus.control(s, 20)`, one `Group`.

### 4.2 New SynthDefs

| Def | Purpose | Est. UGens |
|---|---|---:|
| `\spaluterMix` | N stereo ins → gain/pan/mute/solo → bus 0 | ~20 |
| `\spaluterScope` | single shared scope capture (replaces the in-synth network) | ~10 |
| `\spaluterSC_v{1..4}_f{1..3}` | chain-count variants | 325–1726 ar |

Variant compilation on a Pi is slow and memory-hungry. **Compile lazily and cache**, precompiling only the default (`v1_f3`); do not compile all 12 at boot.

### 4.3 Structural vs. continuous parameters

`voiceCount` and `formantCount` stop being live `.set()` targets and become **structural**: changing them selects a different SynthDef, which means free + respawn.

This has real consequences and must be designed for, not discovered:

- Respawn is audible. Spawn the new node, ramp amp across ~30 ms, then free the old one.
- **Never trigger this from a slider `input` event.** Apply on release / debounce (~250 ms), or these become a node-churn firehose on the FIFO-1 command thread.
- They must be excluded from LFO targets and from macro sweeps.
- A held note must survive the swap — copy the full param set and gate state to the new node.

---

## 5. Phased implementation

Each phase is independently shippable and independently measurable. **Gate: `pw-top` busy/quantum must not regress at any phase boundary.**

### Phase 0 — Fund the budget (no user-visible change)
1. Extract the scope into `\spaluterScope`; remove the capture network from `\spaluterSC`.
2. Free the scope synth when Perform is not the active screen.
3. Convert LFO rate/depth/shape edits to in-place `.set()`.
4. Cap the renderer frame rate.
- **Exit criteria:** busy/quantum drops from 0.53 to ≤ 0.45; scope still correct; leaving Perform measurably returns CPU.

### Phase 1 — SynthDef variants
1. Parameterise the patch to emit `\spaluterSC_v{V}_f{F}`; lazy-compile + cache.
2. Add crossfaded structural respawn with full state transfer.
3. Debounce `voiceCount` / `formantCount`; exclude from LFO/macro targets.
- **Exit criteria:** `v1_f3` measures ≤ 0.25 busy/quantum; identical sound to today at `v4_f3`; no click on voice-count change; held notes survive.

### Phase 2 — Layer container (still one layer)
1. Replace globals with arrays: `~spaluterLayers`, `modBus[]`, `lfoGroup[]`, `layerBus[]`, `layerGroup[]`.
2. Add `\spaluterMix`; route layer 0 through it to bus 0; reverb `\addAfter` the mixer.
3. Make `startSynth` / `stopSynth` / `reset` iterate layers (`sc/runtime.scd:435-477`).
- **Exit criteria:** byte-for-byte identical behaviour with `layerCount = 1`. This is a pure refactor — verify before adding anything.

### Phase 3 — Layer addressing in the protocol
1. Extend `/spaluter/set` to `[layerIdx, paramName, value]`. Detect by type: if `msg[1]` is an Integer, it is the layered form; otherwise fall back to layer 0. This keeps every existing sender working unchanged.
2. Same for the batched set path (`main.js:856-890`) and `/spaluter/lfo/*`.
3. Add `/spaluter/layer/count`, `/spaluter/layer/mix [idx, gain, pan, mute, solo]`.
4. Add a `layer` field per LFO; respawn into the correct group/mod bus on change (reuses the existing retarget path).
5. Add `replyID` to scope replies so the UI knows which layer it is seeing.
- **Exit criteria:** old 2-arg messages still work; new 3-arg messages address layer 1.

### Phase 4 — Turn on Layer B
1. `layerCount = 2`; instantiate group/buses/synth/LFOs for index 1.
2. Split the 16 LFOs across layers (total stays 16 to bound CPU).
3. MIDI routing modes (§6).
- **Exit criteria:** two independently editable timbres sound simultaneously; **busy/quantum ≤ 0.70 with both layers at `v1_f3`; zero xruns over a 10-minute run**.

### Phase 5 — UI, presets, polish
See §7 and §8.

### Phase 6 — optional, only if measurements allow
Refactor the reverb from a post-mix insert into a true send/return with per-layer send amounts. Deferred deliberately: an insert with an internal dry/wet cannot do per-layer wet levels, and a second reverb instance costs another ~89 ar UGens.

---

## 6. MIDI routing model

Current handling is monophonic with `midiSoundingNote` / `midiVoiceActive` (`sc/runtime.scd:382-401`). With two layers, add an explicit mode:

| Mode | Behaviour |
|---|---|
| **Layer** (default) | Every note goes to both layers — one gesture, two timbres stacked |
| **Split** | Notes below the split point → A, above → B; split point user-set |
| **Dual channel** | Layer A listens on MIDI ch *n*, Layer B on ch *m* |
| **Rotate** | Successive notes alternate A → B → A: genuine 2-note polyphony |

Voice state (`midiSoundingNote`, `midiVoiceActive`, `currentGateMode`) becomes per-layer. Rotate mode needs note-stealing: track which layer holds which note and steal oldest-first when both are busy.

CC handling gains a destination: focused layer / both / a specific layer.

---

## 7. UI changes

- **Layer selector** in the header (`A` / `B`, plus a `LINK` toggle that mirrors edits to both). This is the single most important control — every existing screen becomes "the focused layer's" view.
- **Edit / Mods screens** operate on the focused layer. The renderer's parameter mirror and the Edit-screen live LFO markers must become per-layer.
- **Perform screen** gains a compact per-layer strip: level, pan, mute, solo — and the scope gains an `A / B / MIX` source selector.
- **Macros**: `MACRO_TARGETS` applies to the focused layer, honouring `LINK`.
- **Cost indicator**: since `voiceCount` × `formantCount` now has a real DSP price, show the current chain count and warn when the combined total is unaffordable. Users must be able to see why the audio is about to break.

---

## 8. Presets and migration

Current presets are a flat parameter object in `localStorage` under `spaluter-presets-v1` (`renderer/renderer.js:60, 3927-3954`).

New v2 schema:

```json
{
  "version": 2,
  "layers": [ { "params": {}, "lfos": [], "mix": { "gain": 1, "pan": 0, "mute": false } },
              { "params": {}, "lfos": [], "mix": { "gain": 1, "pan": 0, "mute": false } } ],
  "fx": {},
  "midi": { "mode": "layer", "splitPoint": 60 }
}
```

Migrate on read: a v1 preset becomes `layers[0]`, with `layers[1]` set to defaults and **muted**, so every existing preset sounds exactly as before. Write under `spaluter-presets-v2`; leave v1 data intact for rollback.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| **CPU** — the entire project depends on Phase 0/1 delivering | Measure at every phase gate; abandon or reduce scope if `v1_f3` does not come in ≤ 0.25 |
| **2 GB RAM** — a second Chromium-side state tree plus more SynthDefs | Lazy variant compilation; no second Electron process; watch RSS (already ~1.2 GB) |
| **Command thread at FIFO 1** — doubling node churn hits the weakest link | Phase 0 item 3 is a hard prerequisite; debounce structural changes |
| **Node order errors** — mixer before layers, or reverb before mixer, silently breaks audio | Explicit groups, never bare `\addToHead` on the root; assert order at boot |
| **Variant respawn clicks** | 30 ms crossfade + full state transfer; never on `input` events |
| **UI complexity** — every screen doubles its state space | `LINK` mode on by default so the instrument behaves like today until the user opts in |

---

## 10. Rejected alternatives

- **Two app instances / two `scsynth` processes.** Independently verified as non-viable: `scsynth` binds a fixed `-u 57110` with `-l 1`, `sclang` binds `0.0.0.0:57130` (`sc/runtime.scd:70`), and the ALSA device is hard-pinned to `pisound` (`sc/runtime.scd:67`) — all three tested `EADDRINUSE` on the device. Worse, `main.js` has no single-instance lock, so a second GUI launches and silently drives the *first* instance's engine. Even with ports fixed, it would need two Electron stacks (~122 % CPU each) on a 2 GB Pi.
- **A dual-layer `\spaluterSC`** (layer as an internal dimension). Doubles UGens unconditionally with no way to run an asymmetric cheap layer, and explodes the parameter namespace. Strictly worse than two nodes.
- **`voiceCount` up to 8 with per-voice parameters.** Same UGen cost as layers but no independent modulation, gating, or FX routing — it does not deliver "an entirely different voice".

---

## 11. Verification

Measure on the device, not on the Mac. Per phase:

```bash
ssh -i .ssh/rpi_ed25519 patch@patchbox.local \
  "timeout 12 pw-top -b -n 4 | grep -E 'pisound|scsynth'; ps -eo pcpu,rss,comm --sort=-pcpu | head -8"
```

Record `busy/quantum` (`B/Q`) and the `ERR` (xrun) delta over a fixed 10-minute idle run, plus a 2-minute stress run (both layers sounding, Mods screen open, LFOs running, a macro being swept).

**Ship gate for Phase 4:** both layers at `v1_f3`, `B/Q ≤ 0.70`, zero new xruns over 10 minutes, and no audible click on layer switching, preset load, or voice-count change.

---

## 12. Summary

Layer B is affordable — but only by first reclaiming what the engine currently wastes. The sequence is:

1. **Phase 0** removes ~13 % of the audio graph that exists purely to draw a scope.
2. **Phase 1** stops paying for 12 grain chains when 3 are wanted.
3. Together those make a layer cost ~575 ar UGens instead of 1987 — so **two layers land at ~58 % of today's single-layer load**.
4. **Phases 2–4** then add the second layer as a container change, not a rewrite, keeping the reverb SynthDef and the existing OSC protocol backward-compatible throughout.

Attempting Phase 4 without Phases 0 and 1 produces continuous dropouts and nothing else.

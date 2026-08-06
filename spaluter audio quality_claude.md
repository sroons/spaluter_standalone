# Spaluter — Audio Quality Review of Recent Changes

Repo: `sroons/spaluter_standalone`, evaluated at `bb64fdc` (main, 2026-07-13).
Scope: audio-affecting commits from the June 14–28 window — the reverb branch merge (`4aa2177`), the true gated ASR (`467eb0e`), MIDI-note LFO retrigger (`fd1d68a`), the performance audit (`71d69e8`), the new LFO mod targets (`a0de697`), the multitap delay (`7ca27fe`), and the Pi recording work (`d3b9930`, `5c99d1e`).

The short version: the two changes most likely to be audibly hurting things are the **shimmer SynthDef swap** and the **FX dry-bypass pause** — both hard-cut reverb/delay tails mid-performance. The new **MIDI-clock-synced delay** also has a zipper-noise problem baked into its choice of `CombN`. Details below, ranked by impact.

---

## 1. Shimmer zero-crossing swap destroys the entire FX tail — HIGH

**Introduced:** `71d69e8` (perf audit, Phase A, Jun 27)

To save PitchShift CPU, the runtime now swaps between two SynthDefs (`\spaluterReverb` / `\spaluterReverbNoShim`) whenever `revShimmer` crosses zero. The swap is done in `spawnReverb` (sc/runtime.scd:308–321) via **free + respawn**:

```supercollider
~spaluterReverb.free;          // old tank, pre-delay, delay-line state all discarded
~spaluterReverb = Synth(defName, [\out, 0], ~spaluter, \addAfter);
```

The reverb tank state lives in `LocalIn`/`LocalOut` feedback plus the `DelayL`/`AllpassL` lines, and the multitap delay tails live in `CombN` buffers inside the *same* synth. Freeing the node silences all of it instantly. The commit message claims "identical sound when it is [engaged]" — true in steady state, but the transition itself is destructive:

- Sweeping the shimmer fader down to 0 (a natural performance move) hard-cuts the full reverb *and* delay tail to silence.
- Sweeping it up from 0 does the same.
- Since `7ca27fe` put the delay in this synth too, delay tails of up to 12 s decay are also killed by touching shimmer.

**Fix direction:** don't free on the transition. Options: keep the shim synth and only swap when the wet path has decayed to silence (schedule the swap); crossfade two parallel nodes; or accept PitchShift cost whenever `revWet > 0` and only use the NoShim def when the FX are fully dry (where the swap is already inaudible thanks to the bypass).

## 2. Dry-bypass pause truncates tails and can click — HIGH

**Introduced:** reverb bypass in the reverb branch (Jun 20); extended to the delay in `7ca27fe` (Jun 28)

`updateReverbBypass` (sc/runtime.scd:299–306) pauses the FX node (`.run(false)`) the moment both `revWet` and `dlyWet` reach 0:

- Turning reverb wet to zero while the tank is ringing chops the tail instantly instead of letting it decay. The `Lag.kr(revWet, 0.05)` crossfade inside the synth never gets to finish — the output jumps from "blended" to "pure dry" within the same control pass, which is a click risk on program material.
- Same for the delay: with feedback at 0.88 the comb decay is up to 12 s; wet→0 hard-cuts it.
- On resume (`.run(true)`), the paused delay lines still hold the frozen tail from pause time, so the *old* tail bursts back out when you re-engage the effect seconds or minutes later.

**Fix direction:** defer the pause — when wet reaches 0, schedule `.run(false)` after the worst-case tail time (e.g. `dlyDecaySec` / reverb RT), and clear state (or briefly gate the output) before resuming.

## 3. `CombN` + continuously-updated tap times = zipper noise in the new delay — HIGH (clock mode), MEDIUM (free mode)

**Introduced:** `7ca27fe` (Jun 28)

The multitap delay uses non-interpolating `CombN` for all 8 taps, but its delay times are *moving targets*:

- `dlyTapBase` is smoothed with `Lag.kr(…, 0.04)`, so every base-time change is a continuous ramp — and `CombN` follows it in whole-sample jumps with no interpolation and no resampling of buffered audio. That's audible stepping/graininess/clicks in the echoes.
- In MIDI Clock mode it's constant: the renderer re-sends `dlyClockHz` whenever the BPM estimate moves by more than `DELAY_CLOCK_HZ_EPSILON = 0.0005` Hz (~0.03 BPM — renderer.js:84, 1607–1612). MIDI clock timing measured via `performance.now()` in a browser renderer jitters far more than that, so tap times are being nudged continuously while synced, and every nudge crackles through `CombN`.

Note the reverb side of the same commit family got this right (`DelayL`/`AllpassL`, interpolating). The delay didn't.

**Fix direction:** use `CombL`/`CombC` (interpolating) for the taps, and/or add hysteresis to the clock estimate — only re-send `dlyClockHz` when the tempo has moved by something musically meaningful (e.g. >0.5 BPM) and stayed there for several ticks.

## 4. Engaging the delay ducks the whole mix by up to 3.7 dB — MEDIUM

**Introduced:** `7ca27fe` (Jun 28)

Final mix line (both reverb defs, e.g. spaluter_supercollider.scd:350):

```supercollider
sig = (sig * (1 - (dlyMix * 0.35))) + (dlyWetSig * dlyMix);
```

At full delay wet the dry+reverb bed is attenuated to 0.65 (−3.7 dB). Combined with the reverb's equal-linear (not equal-power) wet/dry blend, riding the delay fader produces a perceptible overall level dip — if "the synth got quieter / pumps when I use the delay" is one of the symptoms, this is it. Also worth knowing: the delay taps feed from the **pre-reverb dry** signal (`in`), so echoes are always dry — reverb never appears in the repeats. If that's not intentional, that changed character too.

## 5. MIDI notes quantized to whole Hz — up to ~26 cents out of tune in the bass register — MEDIUM

**Present in renderer mapping earlier; re-implemented in sclang-owned MIDI, `71d69e8` (Jun 27)**

```supercollider
midiNoteToBasePitch = { |note|
    var hz = 440.0 * (2 ** ((note.clip(0, 127) - 69) / 12.0));
    hz.round(1.0).clip(20.0, 1000.0);   // <- integer Hz
};
```

This mirrors the UI slider's `step="1"`, but the instrument's default register is C1 ≈ 32.70 Hz, where 1 Hz ≈ 52 cents. C1 rounds to 33 Hz (+15.7 c sharp); the error can reach ~±26 cents below ~40 Hz and stays >±8 cents through the second octave. MIDI playing in the bass register is systematically out of tune. Fix: keep fractional Hz for the note path (and drop the slider step to 0.01, or bypass the quantize for note-derived values).

## 6. LFO retrigger overlap on every note-on — MEDIUM-LOW

**Introduced:** `fd1d68a` (Jun 21), fired per-note from sclang since `71d69e8`

In gateMode 0, each note-on calls `retriggerLfos` → free+respawn of every active LFO synth. `releaseLfo` ramps the old synth to zero over ~20 ms (its `Lag`) and frees it 120 ms later, while the replacement starts writing immediately — both **add** into the same mod-bus channel, so each note attack gets a transient of up to 2× modulation depth, plus a phase-reset discontinuity smoothed only by the 20 ms lag. With deep LFOs on pitch/formants this is audible as a blip on every note attack; fast trills stack several decaying LFO synths at once. Fix direction: retrigger phase inside a persistent LFO synth (`\phase` trigger input + `Sweep`/`Phasor` reset) instead of free/respawn.

## 7. Control-rate ASR envelope in MIDI/CV gate modes — LOW

**Introduced:** `467eb0e` (Jun 14)

`envASR = EnvGen.kr(...)` + `K2A` means attack/release in gate modes 0/2 are quantized to control blocks (~1.5 ms at 64/44.1k). Short attacks (the param floor is 0.1 ms) step rather than ramp → clicky note onsets compared to the audio-rate `Env.perc` used in Free Run. `EnvGen.ar` on the ASR is a cheap fix.

## 8. Smaller observations

- **Envelope-time LFO mod can pin release at 1 ms** (`a0de697`): depth caps of ±500/±800 ms on attack/release additively can drive `rel` to the 1 ms floor → clicks each grain. Working as designed, but easy to hit accidentally from the Mods screen.
- **Mod-bus widening 16→20 was done consistently** (`a0de697`): `Bus.control(s, 20)`, `\modClear` 20-wide, `In.kr(modBus, 20)` all match — no bug; only the `\modClear` comment still says "16-channel".
- **Recording scripts** (`d3b9930`, `5c99d1e`): raising the PipeWire quantum to 2048 during capture adds ~43 ms of live monitoring latency while recording, in exchange for the measured xrun reduction (~11/10 s → ~1/12 s). Reasonable trade; capture-only, reverts on exit.
- **Scope frames 128→64** (`71d69e8`): visualization payload only — no audio-path impact.
- **`s.options.device = "pisound"`** hard-pin (reverb branch): a quality *win* on the Pi (bypasses the ALSA `plug` resampling layer), but scsynth will fail to boot on any other Linux machine. Consider a fallback if the device is absent.
- The sclang-owned note handling (`71d69e8`) was checked against the old renderer path: the renderer now ignores note messages (no double-driving), duplicate ALSA note-ons are deduped, and the release-on-note-off semantics match the renderer's previous behavior — no regression found there.

---

## Suggested priority

1. Stop freeing the FX synth on shimmer zero crossings (#1) — most audible, trivially triggered.
2. Defer/fade the bypass pause (#2).
3. Swap `CombN` → `CombL` and add clock-update hysteresis (#3).
4. Un-quantize note-derived basePitch (#5) — one-line fix, real tuning impact.
5. #4, #6, #7 as polish.

# Plan: Mutable Instruments Clouds-Style Reverb for Spaluter

This document outlines the implementation plan for adding a lush, diffused, and modulated feedback delay network (FDN) reverb to the Spaluter synthesizer, mimicking the classic reverb topology used in Mutable Instruments Clouds.

---

## 1. DSP Architecture (SuperCollider)

Mutable Instruments Clouds' reverb is based on a classic Olivier Gillet design: an input diffuser followed by a feedback loop of modulated delay lines, allpass filters, and low-pass damping filters.

```
Input -> [Diffuser: 4x Series Allpass] 
            |
            v
     +---> (+) ---> [Delay Line 1 & 2] ---> [LPF Damping] ---> [Allpass 1 & 2] ---> Output/Feedback (Cross-mixed)
     |      |
     +<-- (Feedback * revTime) <----------------------------------------------------+
```

### A. Input Diffuser
* Route the stereo or mono sum input through 4 series `AllpassC.ar` filters.
* Delay times should be prime-number-based and relatively short (e.g., 4.7ms, 22.1ms, 29.3ms, 37.0ms) to smear transients without creating distinct echoes.
* Control the diffusion coefficient (`revDiff`) of these allpass filters.

### B. Feedback Loop (Late Repercussions)
* **Delay Lines:** Two or four modulated delay lines (e.g., using `DelayC.ar` or `MultiTapDelay`).
* **LFO Modulation:** Modulate the delay times using slow, uncorrelated `LFNoise1.kr` generators (frequencies around 0.1Hz to 1.0Hz) with extremely small depth (a few samples) to wash out metallic resonances and build rich, chorus-like movement.
* **Low-Pass Damping:** Insert a one-pole low-pass filter (`OnePole.ar` or `LPF.ar`) inside the loop to simulate absorption. Cutoff frequency is controlled by `revDamp`.
* **Additional Allpass Filters:** Place modulated allpass filters inside the feedback loop to increase echo density over time.
* **Feedback Gain:** Controlled by `revTime` (feedback loop coefficient close to 1.0 for infinite wash, but capped at ~0.98 to avoid self-oscillation/blowup).

### C. FX Integration (`\spaluterReverb` SynthDef)
* Create a separate `SynthDef` named `\spaluterReverb` rather than embedding it into `\spaluterSC`.
* Run the reverb synth directly after the synthesizer group (`addAction: \addAfter`) on a dedicated stereo bus.
* This keeps DSP usage modular and allows the reverb to stay active even when synthesizer voices are gated/released (preventing cutoff tails).

---

## 2. Exposed Parameters

| Parameter | Type | Default | Range | Description |
|---|---|---|---|---|
| `revWet` | Continuous | `0.0` | `0.0` to `1.0` | Mix between dry and fully wet signal |
| `revTime` | Continuous | `0.5` | `0.0` to `0.98` | Feedback/decay time (decay length) |
| `revDamp` | Continuous | `0.5` | `0.0` to `1.0` | Absorption/high-frequency damping |
| `revDiff` | Continuous | `0.5` | `0.0` to `1.0` | Diffusion coefficient (smear factor) |

---

## 3. Implementation Steps

### Phase 1: SuperCollider Core
1. Open `spaluter_supercollider.scd` and define the `\spaluterReverb` SynthDef.
2. Update the boot/initialization blocks to allocate a dedicated stereo audio bus for the dry/synth output.
3. Update the `~spaluterStart` helper function to boot both the dry synth and the reverb synth in the correct order.

### Phase 2: Runtime & OSC Routing
1. Update `sc/runtime.scd` to handle the new parameters via the `/spaluter/set` OSC command.
2. Ensure that resetting the synthesizer (`/spaluter/reset` or `/spaluter/stop`) clears the feedback delay lines of the reverb to prevent leftover tails.

### Phase 3: GUI & Controls
1. Add four new knobs or sliders to the HTML UI layout.
2. Register the four parameters in `renderer.js` (`allParamNames`, `PREFERRED_MIDI_CC_BY_PARAM`, `controlMetaByParam`).
3. Add default MIDI CC mappings (e.g., CC 49 for `revWet`, CC 50 for `revTime`, CC 51 for `revDamp`, CC 52 for `revDiff`).

---

## 4. CPU & Memory Impact Assessment (with RPi4 Optimizations)

### A. CPU Impact
* **Interpolation Overhead:** Modulated delay lines (`DelayC` and `AllpassC` with cubic interpolation) are computationally heavy. Running multiple channels on a resource-constrained platform like a Raspberry Pi 4 could lead to audio dropouts (clicks).
* **CPU Optimizations:**
  * **No-Interpolation Diffuser:** Use `AllpassN.ar` (no interpolation) for the initial 4-allpass input diffuser since their delay times are static.
  * **Linear Feedback Delay:** Use `AllpassL.ar` and `DelayL.ar` (linear interpolation) inside the feedback loop. This reduces the FX DSP footprint by approximately 40% compared to cubic interpolation with negligible quality difference in highly diffused washes.
  * **Dynamic Bypassing:** When `revWet == 0`, dynamically bypass or pause the `\spaluterReverb` synth using `Group` pausing or control gates to free up all CPU cycles when the effect is not active.

### B. Memory Impact
* **Real-time Memory Pool:** Delay lines consume very little system RAM (~1–2 MB), but they allocate memory blocks from SuperCollider's real-time memory pool (`s.options.memSize`).
* **Memory Optimizations:**
  * **Increase memSize:** Add or ensure `s.options.memSize = 65536;` (64 MB, up from default 8 MB) is set in `sc/runtime.scd` to prevent scsynth `alloc failed` errors on boot when delay lines are allocated.
  * **Buffer Constraints:** Cap the maximum delay lines to `1.5` seconds to prevent memory fragmentation and over-allocation.


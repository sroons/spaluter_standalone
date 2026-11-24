# Audio Quality Analysis — Spaluter

Evidence-based audit of why the instrument sounds bad, and what to do about it.

> **Status, 2026-11-21.** Tier 1 (runtime) is superseded by the work on the
> `performance-rewrite` branch, recorded in `performance-rewrite-analysis.md`: the
> scsynth audio thread was in fact already `SCHED_FIFO 83` (the "priority 1" reading
> below was the process, not the thread), the quantum is 512 (256 re-measured and
> rejected), Electron is pinned to CPUs 0-2, and PipeWire's own data loop now runs
> `SCHED_FIFO 88` on CPU 3 beside scsynth. Keep §1 only as history.
>
> **Done from Tier 3 in the same commit as this note:** §3.1 grain edge (smoothstep
> fade over the first and last 0.5 ms of every grain, replacing the boolean duty gate;
> a cosine version measured identically but cost 5 points of scsynth CPU on the Pi),
> §3.4 both `Hasher` range bugs, §3.6 parameter smoothing (20 ms `Lag` on amp, drive,
> duty, formants, pans, pulsaret, window, mask amount, glisson, sample rate; 10 ms on
> formant on/off, tracking and duty-mode switches), and §3.7 (+6 dB make-up after the
> drive stage, `LeakDC` + 2 ms look-ahead `Limiter` at 0.95 on the final bus).
> Verified with the offline render method above (3 s per case, 48 kHz, before/after):
>
> | Case | Measure | Before | After | Reads as |
> | --- | --- | --- | --- | --- |
> | default (pulsaret 2.5, window 0.5) | energy above 8 kHz, rel. total | -40.8 dB | -49.5 dB | grain-edge steps gone |
> | saw + rectangular window | one-sample jumps > half peak | 5291 | 5005 | -286 = 55 grains/s x 2 edges x 2.6 s; the rest are the saw's own wraps (§3.2, still open) |
> | saw + Hann window | same | 3575 | 3575 | Hann already reached zero; only saw wraps remain |
> | stochastic mask, amount 0 | RMS | -29.1 dBFS | -20.1 dBFS | +3 dB from no longer dropping half the grains, +6 dB make-up |
> | noise pulsaret | DC offset | +0.0043 | -0.0001 | offset removed; level now matches the other shapes |
> | formant stepped 90x during 3 s | one-sample jumps > half peak | 1474 | 1384 | -90 = one zipper step per `set` removed; the rest is the 4.8 kHz sine's own slope (§3.3) |
>
> **Second round, same evening.** Listening on the Pi still gave clicks after the
> pass above, with the xrun counter flat. The "jumps > half peak" metric had missed
> them: every pitch change that landed inside a grain was a step larger than the peak,
> because the pulse phase was computed as elapsed time x current rate and the pulsaret
> phase as `tp x ratioF`, so both jumped whenever `basePitch`, a chord ratio, a formant
> or the duty changed mid-grain (every Grid note in free run, every legato note, every
> chord or preset change, every timing-jitter step). Both phases are now integrated
> (`Phasor.ar`, reset at the pulse and at the duty-region start), so a rate change bends
> the slope and the waveform stays continuous; the note ASR runs at audio rate (its
> 10 ms attack was eight control-block steps), the voice/formant count divisors are
> lagged, and amp smoothing runs at audio rate. Re-measured with a third-difference
> transient detector (flags samples more than 10x the local level), shipped defaults
> (free run, formants 20/200/400, pulsaret 2.5, window 0.5), 3 s per case:
>
> | Case (defaults) | Original | After pass 1 (was on the Pi) | After round 2 |
> | --- | --- | --- | --- |
> | 14 note steps, free run | 274 events, largest 4.4x peak | 12 events at the note changes, largest 3.9x peak | 0 |
> | 14 notes in MIDI gate mode | 276 | 9, largest 1.5x peak | 0 |
> | 11 chord changes, 4 voices | 484 | 6, largest 0.8x peak | 0 |
> | preset recall (9 params at once) and back | 58 | 2 | 0 |
> | 60-step slider drag (formant + duty) | 46 | 0 | 0 |
> | steady | 194 (rectangular half of window 0.5) | 0 | 0 |
>
> The detector also flags ~0.06x peak kinks every 1.25 ms inside each grain in all three
> versions: those are the slope discontinuity of the sinc pulsaret at its wrap (half of
> pulsaret 2.5), not clicks. Cost on the Pi: scsynth idle 42 -> about 44% of a core.
>
> A 180 s capture of the Pi's own output (PipeWire sink monitor, pass 1 running, user
> playing) confirmed the picture: xrun counter flat, limiter never reached (peak -2.3 dBFS),
> 271 transients in the digital signal, 265 of them grain truncations clustered in the
> passages with jitter or pitch movement (the `Impulse`/`Sweep*pulseFreq` desync above),
> one mid-grain pitch step, and one cut to exact zero when Stop was pressed. The last one
> is a runtime bug, not a patch bug: `sc/runtime.scd` freed the synth outright; Stop and
> restart now set `amp` to 0 (lagged) and free both nodes 80 ms later.
>
> **The remaining crackle was not digital (2026-11-22/23).** With round 2 running the
> user still heard a dense "old vinyl" crackle. A 240 s sink-monitor capture of real
> playing had 6 transients (one 512-sample xrun, the Stop cut above, two instant
> switch-type events), so the crackle was not in the stream PipeWire hands to the
> pisound. It was then reproduced without the instrument at all: a pure 880 Hz tone
> from `pw-play` (kiosk stopped, player `SCHED_FIFO 80` on CPU 3) while three busy loops
> ran on CPUs 0-2 at the full 1.8 GHz clock, and the sink monitor of that tone was a
> perfect sine every time. Discriminating runs, each judged by ear:
>
> | Tone | CPU load | Clock | Result |
> | --- | --- | --- | --- |
> | silence | on | 1.8 GHz | clean |
> | 440 Hz | off | 1.8 GHz | clean |
> | 880 Hz | off | 1.8 GHz | clean |
> | 880 Hz | on | 1.8 GHz | crackles, every run |
> | 660 Hz and 880 Hz | on | capped 600 MHz | clean |
> | 880 Hz, load toggled every 15 s | on/off | 1.8 GHz | crackle follows the load within a second, at 54-69 degC |
>
> So the crackle is electrical: processor current draw disturbing the pisound's analog
> output. The Pi 4 (Model B rev 1.5, 2 GB) was fed from a power strip's USB-A port
> through an A-to-C cable and also powered a USB touchscreen and the Grid controller;
> every boot with the Grid attached logged `Undervoltage detected!` ~45 s in (sticky
> `throttled=0x50000`), none without it. Capping the clock at 1.2 GHz during real play
> "greatly reduced" it (1.0 GHz brought it back on screen redraws and made the UI lag).
> Things that did not help and were removed: ALSA headroom 1024 (`api.alsa.headroom`
> via a WirePlumber rule, +21 ms latency), and a staged kernel 6.6 tryboot. Replacing
> the supply with a dedicated 5.1 V 3 A unit on 2026-11-23 fixed it by ear
> ("everything sounds great"); the tone-under-load run was repeated as the acceptance
> check (result below). Lesson for this document: judge clicks on a sink-monitor
> capture first, because the analog side can add artefacts no DSP change will touch.
>
> Acceptance run on the new supply (2026-11-23, first boot on it): no `Undervoltage`
> message, `throttled=0x0` throughout, 880 Hz tone with three busy loops at 1.8 GHz for
> 45 s, 62 -> 78 degC, 0 xruns, no crackle by ear, headroom rule removed (ALSA fill back
> to 556 frames).
>
> **Step 2 (2026-11-23/24): §2.1, §3.2, §3.3 and §3.5 done.** The graph is now a
> Group of 4 clock synths, 12 stream synths (voice x formant) and a mixer that pauses
> the nodes the voice and formant counts do not use; pulsarets and windows are
> wavetables (10 shapes x 8 band-limited mip levels, 9 windows, built with `Signal.fft`
> at load, top third of each band tapered with a raised cosine), the mip level is
> latched per grain, formant frequency no longer divides by duty, and timing jitter
> is a per-grain `TRand` on the grain onset. Same offline method, old graph against
> new, all cases 3 s at 48 kHz, click = third-difference event:
>
> | Case | Clicks before | Clicks after | Above 16 kHz before | after | Note |
> | --- | --- | --- | --- | --- | --- |
> | saw pulsaret, pulse 50 Hz | 329 | 0 | -11.1 dB | -38.6 dB | band-limited tables |
> | pitch slide 33 -> 588 Hz | 21 | 0 | -25.9 dB | -86.6 dB | |
> | glisson sweep | 0 | 0 | -28.5 dB | -68.3 dB | |
> | preset switch (shape, window, duty, formants, drive) | 1 | 0 | -39.1 dB | -58.9 dB | see the K2A note |
> | formant 1000 Hz, single formant | 0 | 0 | peak 2000 Hz | peak 1000 Hz | §3.3 fixed, level identical (-20.0 dBFS) |
> | defaults, steady | 0 | 0 | -57.7 dB | -92.9 dB | RMS -22.3 -> -28.8 dBFS (content, see below) |
> | notes, gate, chord, counts, jitter | 0 | 0 | | | all unchanged at 0 |
>
> Found and fixed on the way: a control-rate wavetable offset added to an audio-rate
> read index is ramped across the block by scsynth, so every pulsaret or window change
> swept the read head through thousands of frames of the neighbouring tables (a 1.3 ms
> noise burst, 5 events per morph case). Isolated with four one-synth test defs; the
> fix is to convert the shape selector to audio rate first and take floor and fraction
> per sample, which also keeps the crossfade continuous through the integer crossing.
>
> CPU: Mac, same load, back to back, old graph 12.6-13.7% at every count setting; new
> graph 4.3% at 1v/3f, 2.3% at 1v/1f, 4.9% at 2v/2f, 11.9% at 4v/3f. Pi, defaults,
> screen on, UI idle: scsynth 10.1% average, 13.5% peak (40-44% with step 2a), 0 xruns,
> 20 s sink-monitor capture with 0 events.
>
> Audible changes: formants sit an octave lower than before at duty 0.5 (the §3.3
> fix; presets will sound different), timing jitter now moves grain onsets instead of
> adding noise, and the shipped defaults measure about 6 dB quieter because the 20 Hz
> formant now completes half as many cycles per grain. Still open: §3.8 sub-sample
> onsets, §3.9. Integer defaults were not changed: with the edge fade the 2.5/0.5
> crossfades no longer click, so that is now a matter of taste.

## Method

Everything below is **measured**, not inferred:

1. **Offline renders.** `spaluter_supercollider.scd` was booted under `sclang` on macOS at
   48 kHz and recorded to WAV across six parameter cases, then analysed with FFT
   (band energy, peak picking, sample-discontinuity counting).
2. **Model validation.** The pulsaret/window/duty maths was re-implemented in NumPy.
   Its band energies matched the SuperCollider render to within 0.4 dB across six
   bands, confirming the model is faithful — so the 16× oversampled comparison below
   is a valid aliasing reference.
3. **Live target measurement.** The running instrument on the Raspberry Pi 4
   (`patch@patchbox.local`) was interrogated over SSH: `/status` polled directly on
   scsynth's OSC port, plus `chrt`, `top`, `pw-top`, `fuser`, and ALSA `hw_params`.

Raw renders and scripts: `~/.copilot/session-state/<session>/files/audit/`.

---

## Executive summary

There are three independent problems, and they compound:

| Layer | Problem | Measured evidence |
| --- | --- | --- |
| **Runtime** | scsynth is starved and routed through PipeWire | `SCHED_FIFO prio 1` vs PipeWire's `rtprio 95`; 77 xruns; 682 ms ALSA buffer |
| **Architecture** | The synth graph is ~15× larger than it needs to be | 2956 UGens, **45% of a Pi 4 core for one voice / one formant**, invariant to voice count |
| **DSP** | The signal itself is harsh, mistuned, and buggy | More energy above 8 kHz than below 4 kHz; formants land at `formant ÷ duty`; `Hasher` range bugs |

**A rewrite in another language fixes only the third row.** If you port to C++/Rust
and leave the Pi's audio runtime as-is, you will still get xruns.

---

## Tier 1 — Runtime and platform (dominant cause on the Pi)

### 1.1 scsynth runs at real-time priority 1; PipeWire is allowed 95

```
pid 1340 (scsynth) scheduling policy: SCHED_FIFO
pid 1340 scheduling priority: 1

/etc/security/limits.d/25-pw-rlimits.conf:  @pipewire  - rtprio 95
/etc/security/limits.d/audio.conf:          @audio     - rtprio 95
```

scsynth is nominally real-time but sits at the *bottom* of the RT band. PipeWire, the
Midi-Bridge, and every other RT thread preempt it. On a 4-core Pi also running Xorg and
an Electron/Chromium UI, this produces missed audio deadlines.

### 1.2 The comment in `sc/runtime.scd` about bypassing the `plug` layer is false

`sc/runtime.scd:63-68` says:

> Pin scsynth to the pisound ALSA device on Linux/Patchbox so it bypasses the `plug`
> conversion layer in `/etc/asound.conf`.

It does not. The pisound PCM is exclusively held by PipeWire, and scsynth appears in the
graph as a **JACK client** via `pipewire-jack`:

```
fuser -v /dev/snd/pcmC5D0p
  /dev/snd/pcmC5D0p:  patch  893  F...m  pipewire

pw-cli info all | grep SuperCollider
  port.name = "SuperCollider:(playback_0) in0"
  ...
```

So `s.options.device = "pisound"` is a no-op at best and misleading at worst. The real
signal path is:

```
scsynth → pipewire-jack shim → PipeWire graph → ALSA hw:pisound
```

### 1.3 The hardware buffer is enormous and PipeWire is already glitching

```
/proc/asound/pisound/pcm0p/sub0/hw_params
  rate:        48000
  period_size: 1024
  buffer_size: 32768      ← 32 periods = 682 ms of buffering

pw-metadata -n settings
  clock.quantum = 1024    ← 21.3 ms

pw-top
  pisound:  BUSY 9.3–10.6 ms   B/Q 0.44–0.49   ERR 77
```

`ERR 77` is 77 accumulated xruns. `B/Q ≈ 0.49` means the graph is already consuming half
its deadline budget on the graph *driver alone*, with spikes. Every one of those xruns is
an audible click or a moment of silence.

### 1.4 Fixes (cheap, do these first)

- Raise scsynth's RT priority to ~70–80, below PipeWire's driver but above everything
  else. Launch it under `chrt -f 75`, or add scsynth to a systemd unit with
  `CPUSchedulingPolicy=fifo` / `CPUSchedulingPriority=75`.
- Drop `clock.quantum` from 1024 to 128 or 256 (`pw-metadata -n settings 0 clock.force-quantum 256`).
  21 ms of quantum on a pulsar synth is both latency and jitter.
- Decide on **one** audio server. Either give scsynth the hw device exclusively
  (stop PipeWire from grabbing pisound) or embrace pipewire-jack and tune it properly.
  Right now you have SuperCollider's own comment claiming one thing and the system doing
  another.
- Pin Electron/Chromium to specific cores (`taskset`) so the UI cannot land on the core
  running the audio thread.
- Correct or delete the misleading comment in `sc/runtime.scd:63-68`.

---

## Tier 2 — Synth architecture (why it is expensive)

### 2.1 The entire graph is always computed, regardless of settings

Measured on the Pi via `/status`:

```
idle (before start)             ugens=3     avgCPU= 0.3%  peakCPU= 0.4%
synth: 1 voice / 1 formant      ugens=2956  avgCPU=44.9%  peakCPU=48.0%
synth: 4 voices / 3 formants    ugens=2956  avgCPU=45.2%  peakCPU=51.5%
+ reverb shimmer + delay        ugens=2971  avgCPU=46.2%  peakCPU=47.3%
+ 16 LFOs                       ugens=2971  avgCPU=47.1%  peakCPU=54.5%
```

**The UGen count and CPU are identical for 1 voice/1 formant and 4 voices/3 formants.**
`voiceCount` and `formantCount` do not gate any DSP — they multiply finished signals by
`vActive` / `fOn` (`spaluter_supercollider.scd:68, 116`). `Mix.fill(4)` × `Mix.fill(3)`
always builds all twelve formant streams.

Worse, inside each of those twelve streams:

```supercollider
synthWave = SelectX.ar((pulsaret + mod[2]).clip(0, 9), pulsaretWaves);   // 10 waveforms
win       = SelectX.ar((window + mod[3]).clip(0, 8), winWaves);          //  9 windows
```

`SelectX` evaluates **all** of its inputs. So the patch permanently runs
`12 × (10 pulsarets + 9 windows) = 228` waveform generators — including a `sinc`, a
`BufRd`, three `Hasher`s and a Blackman-Harris — to produce, in the default case, one
audible grain stream.

This is the single biggest CPU win available: **45% → likely under 8%**.

### 2.2 The shipped defaults are crossfades between incompatible shapes

`~spaluterStart` defaults to `pulsaret: 2.5, window: 0.5`. Because `SelectX` crossfades,
the factory sound is:

- 50% `sin(3x)` + 50% `sinc` for the pulsaret, and
- 50% **rectangular** + 50% gaussian for the window.

A half-rectangular grain window means every grain begins and ends with a step
discontinuity. **The default patch clicks by design.**

---

## Tier 3 — DSP correctness (why it sounds harsh and mistuned)

### 3.1 The spectrum is dominated by high frequencies

Case D (saw pulsaret, Hann window, base 55 Hz, formant 2000 Hz, duty 0.5), 48 kHz render,
band energy relative to total:

```
   20 –  4000 Hz :  -5.5 dB
 4000 –  8000 Hz :  -3.4 dB
 8000 – 12000 Hz :  -9.1 dB
12000 – 16000 Hz : -12.7 dB
16000 – 20000 Hz : -13.2 dB
20000 – 24000 Hz : -13.8 dB
```

Summed, there is **more energy above 8 kHz than below 4 kHz**. That is the definition of
"fizzy / buzzy / harsh / cheap-sounding". Case B (rectangular window) is worse still, with
the 16 kHz–Nyquist band at only −10.5 dB.

Root cause is discontinuity, in two places:

1. **The duty gate is a hard rectangle applied on top of the window**
   (`spaluter_supercollider.scd:176`):
   ```supercollider
   grain = src * win * inDuty * maskSm * fOn;
   ```
   `inDuty` is a boolean comparison. Even where the window tapers, `Select.ar`-based
   windows like rectangular, exp-decay and reverse-exp do not reach zero at both ends,
   so the gate truncates a non-zero signal.
2. **Several pulsaret waveforms are inherently discontinuous** — saw, square, and the
   "noise" table — and are generated naively with no band limiting.

Measured discontinuity counts (samples where `|Δ| > 0.15` in 3.5 s of audio):

| Case | Window | Count |
| --- | --- | --- |
| B | rectangular | **6927** |
| D | Hann | **2619** |

Even a Hann window leaves 2619 audible edges per 3.5 seconds, because the saw pulsaret's
own wrap discontinuity survives.

### 3.2 Aliasing, quantified

Comparing the naive 48 kHz render against a 16× oversampled, properly decimated reference
of the identical maths:

```
band            naive@48k    16×OS ref    excess (= alias foldback)
20 –  4000 Hz     -5.7         -5.4          -0.3 dB
 4 –     8 kHz    -3.5         -3.2          -0.3 dB
 8 –    12 kHz    -8.9         -8.9           0.0 dB
12 –    16 kHz   -12.3        -13.4          +1.1 dB
16 –    20 kHz   -12.9        -14.0          +1.1 dB
20 –    24 kHz   -13.4        -18.2          +4.8 dB
```

Aliasing is real but secondary — roughly +1 dB in 12–20 kHz and +5 dB near Nyquist. With
a *static* patch the foldback lands back on the harmonic grid and is relatively benign.
It becomes genuinely ugly the moment `glisson`, `timingJitter`, an LFO, or
`formantTrack` moves anything, because then the folded partials are no longer harmonically
related.

**Conclusion: fixing the grain windowing matters more than oversampling.** Do both, in
that order.

### 3.3 Bug: formant frequency is wrong by a factor of `1/duty`

```supercollider
tp     = ((phase - dutyStart) / dutyF.max(0.001)).clip(0, 1);   // 0..1 across the duty region
ratioF = fEff / freq.max(0.1);
wphase = (tp * ratioF * sweepMul).wrap(0, 1);
```

`tp` spans 0→1 over the *duty region*, whose duration is `dutyF / pulseFreq`, not
`1 / pulseFreq`. The pulsaret therefore completes `ratioF` cycles in `dutyF/pulseFreq`
seconds, so the actual formant is `fEff / dutyF`, not `fEff`.

Confirmed by measurement:

| `formant1` set | `duty` | Measured spectral peak |
| --- | --- | --- |
| 1000 Hz | 0.5 | **1980 Hz** |
| 2000 Hz | 0.5 | **4015 Hz** |
| 4000 Hz | 0.5 | **7920 Hz** |

Every formant is an octave off at the default duty. Worse, the **M04 "Texture" macro**
sweeps `duty` 0.5 → 0.12, which silently multiplies every formant frequency by up to
**8×** — dragging the whole spectrum into the aliasing region. That is almost certainly
why "texture" sounds like it degrades the sound rather than shaping it.

Fix: divide by duty when computing `ratioF`, i.e. `wphase = (tp * ratioF * dutyF * ...)`,
so the formant lands where the UI says it does and is decoupled from duty.

### 3.4 Bug: `Hasher` outputs −1..+1, but the code assumes 0..1

Verified empirically on the server: `Hasher.ar` → `min = -0.988, max = 0.995, mean = 0.006`.

Two consequences:

**(a) The stochastic mask is broken** (`spaluter_supercollider.scd:167`):
```supercollider
maskStoch = (rsel > (maskAmount + mod[8]).clip(0, 1));
```
- `maskAmount = 0` should mean "mask nothing" but drops **~50% of all grains**.
- `maskAmount = 1` means `rsel > 1`, which is never true → **complete silence**.
- The entire 0..1 control range maps to only the upper half of the distribution.

**(b) The noise pulsaret has 3× gain and a −1 DC offset**
(`spaluter_supercollider.scd:139`):
```supercollider
(Hasher.ar(wphase * 1234.567) * 2 - 1)    // range: -3 .. +1, mean -1
```
Every other pulsaret is ±1. Selecting pulsaret 9 jumps roughly +10 dB and slams the
`tanh` drive stage asymmetrically. `LeakDC` strips the DC but not the asymmetric
distortion it already caused.

Additionally, `Hasher.ar(wphase * 1234.567)` hashes a **deterministic ramp**, so it
produces the *identical* waveform in every grain. It is not noise — it is a fixed,
periodic buzz.

Fix: use `Hasher.ar(x) * 0.5 + 0.5` for the mask comparison (or compare against
`maskAmount * 2 - 1`), drop the `* 2 - 1` on the noise pulsaret, and seed the noise
pulsaret from `pulseCount` rather than `wphase`.

### 3.5 Bug: the timing-jitter noise source aliases, and isn't timing jitter

```supercollider
jitMul    = 1 + (LFNoise0.kr(freq.max(0.5)) * (0.2 * timingJitter.clip(0, 1)));
pulseFreq = (freq * jitMul).clip(0.1, 14000);
```

- `LFNoise0.kr` is a **control-rate** UGen (750 Hz at 48 k / block 64) being asked to run
  at up to 14 kHz. Above ~375 Hz its own output aliases into garbage.
- Multiplying `pulseFreq` continuously is frequency modulation — it makes the *pitch*
  wobble. Real per-grain timing jitter perturbs each grain's onset time while leaving the
  average rate intact.

Fix: use `TRand.ar(..., trig)` sampled once per grain and apply it as a phase offset, or
schedule grains with `Dust`/`TDuty` and a per-grain random delay.

### 3.6 No parameter smoothing anywhere on the main synth

`amp`, `drive`, `formant1..3`, `duty`, `pan1..3`, `pulsaret`, `window`, `maskAmount` are
all consumed raw. Only `freq` (via `glideMs`) and a couple of FX mix params are lagged:

```
$ grep -n "Lag" spaluter_supercollider.scd
68:   vActive = (vc > vi).lag(0.01)
71:   freq = Lag.kr(targetFreq, glid)
174:  maskSm = Lag.ar(maskRaw, 0.003)
...   (the rest are all inside the reverb/delay)
```

Every UI slider move, MIDI CC, macro sweep and preset recall therefore lands as a
block-boundary step. Measured during a 33 Hz OSC sweep of `formant1`: `max |Δsample| =
0.105` with no other discontinuity source present. Add `VarLag.kr(param, 0.02)` (or
`.lag(0.01)`) to every continuous control.

### 3.7 Output level and headroom

With the default `amp = 0.25`, measured peak output is **0.15 (−16.4 dBFS)**. Users will
compensate downstream, amplifying whatever noise the pisound/PipeWire chain contributes.

Also: `tanh(sig * drive)` is applied *before* `amp`, so the master volume cannot rescue a
clipping drive stage, and there is no final limiter or DC block after the reverb/delay
sum in `\spaluterReverb`. Add a `Limiter.ar(sig, 0.95)` and `LeakDC` on the final bus, and
raise the nominal operating level by ~10 dB.

### 3.8 Grain onsets are quantized to sample boundaries

`Impulse.ar` fires on sample boundaries and `Sweep.ar(trig)` resets exactly there, so each
grain's start time is rounded to the nearest sample — up to ~20 µs of period jitter. For a
pulsar synth, where the *whole point* is precise grain scheduling, this adds a persistent
inharmonic noise floor and sidebands. Proper implementations (Csound `partikkel`, most
C++ granular engines) use fractional-sample grain onsets.

### 3.9 Minor

- The delay uses `CombN` with a lagged but **non-interpolated** delay time, so moving
  `dlyTimeMs` steps rather than glides.
- The reverb tank runs at full cost even at `revWet = 0`; only the shimmer branch is
  conditionally omitted via the `NoShim` variant.
- The scope adds 128 `BufRd.kr` readers plus a 128-float `SendReply.kr` at 20 Hz inside
  the audio graph.

---

## Recommendations

### Path A — Fix in place (recommended first step, ~1–2 weeks)

Ordered by measured impact per unit of effort:

1. **Runtime**: raise scsynth to `chrt -f 75`, drop PipeWire quantum to 256, resolve the
   PipeWire-vs-direct-ALSA ambiguity, `taskset` the UI off the audio core. *(Fixes the
   xruns — likely the loudest, most obvious defect.)*
2. **Wavetable the pulsarets and windows.** Precompute the 10 pulsaret shapes and 9 window
   shapes into `Buffer`s at boot and morph with `VOsc.ar` / interpolated `BufRd.ar`. This
   replaces ~228 always-on waveform generators with ~24 buffer reads. Expect 45% → <10%
   CPU, and band-limited tables kill most of the aliasing for free.
3. **Make `voiceCount` / `formantCount` actually gate DSP** — spawn per-voice synths on
   demand instead of `Mix.fill(4)`.
4. **Fix the grain window**: force the window to reach zero at both duty edges (apply a
   short raised-cosine fade of ~0.3–0.5 ms to *every* window, including "rectangular"),
   and remove the hard `inDuty` multiply in favour of the window's own taper.
5. **Fix the bugs**: §3.3 (formant ÷ duty), §3.4 (`Hasher` range, ×2), §3.5
   (`LFNoise0.kr` at audio rate).
6. **Add parameter lag** (§3.6) and a final limiter + level increase (§3.7).
7. Change the defaults away from `pulsaret 2.5 / window 0.5` to integer indices.

This path keeps the Electron UI, the OSC protocol, the preset format, the MIDI handling,
and the installers — i.e. the ~90% of the codebase that is not the problem.

### Path B — Replace the DSP engine, keep everything else

Your Electron/OSC/MIDI/UI layer is decoupled from the engine by a clean OSC surface
(`/spaluter/set`, `/spaluter/lfo/*`, `/spaluter/scope`). Swapping the engine is far less
disruptive than "rewriting the codebase".

| Option | Fit | Effort | Notes |
| --- | --- | --- | --- |
| **Csound (`partikkel` opcode)** | ★★★★★ | Medium | `partikkel` is a direct implementation of Roads' particle/pulsar synthesis: per-grain waveform, grain envelope, masking, glisson, sub-sample grain scheduling, up to 4 source waveforms and independent grain rate/formant. It is essentially Spaluter's feature list, already correct and already optimised. Csound runs well on a Pi 4, takes OSC natively, and has a stable C API if you want to embed it. **Best value for effort.** |
| **Faust** | ★★★★☆ | Medium | Compiles to tight C++; targets JACK/ALSA standalone, LV2, VST. Excellent for writing a clean, testable, oversampled pulsar core. You would implement grain scheduling yourself. Gives you a portable DSP core you can also ship as a plugin later. |
| **Rust (`fundsp` + `cpal`/`jack`)** | ★★★☆☆ | Medium-high | Single static binary, trivial aarch64 cross-compilation, no runtime to install (removes the whole "check SuperCollider → install if missing" startup dance in `main.js`). You write all the DSP. |
| **C++ (JUCE / DPF / plain JACK)** | ★★★☆☆ | High | Maximum control: sub-sample grain onsets, per-grain polyphony, 2–4× oversampling, SIMD. Also the route to a sellable plugin. Most work. |
| **Pure Data / libpd** | ★★☆☆☆ | Medium | Conceptually close to SC and easy to embed, but Pd's granular objects are not better than SC's and you would reproduce the same aliasing and scheduling issues. Little upside. |

### What a rewrite will and will not fix

**Will fix:** the always-on graph, aliasing (with oversampling), grain-onset quantisation,
CPU headroom, and the "install SuperCollider first" fragility in `main.js`.

**Will not fix:** the xruns. Those come from scsynth's RT priority and the PipeWire buffer
configuration (§1.1–1.3). Any engine dropped into that same runtime will glitch. **Do
Path A step 1 regardless of which path you choose.**

### Suggested plan

1. **This week**: fix the runtime priority and PipeWire quantum (§1.4). Re-listen. This
   alone may account for most of the perceived badness.
2. **Next**: fix the five DSP bugs (§3.3, §3.4 ×2, §3.5) and add parameter lag (§3.6).
   These are small, surgical, high-impact edits to `spaluter_supercollider.scd`.
3. **Then**: wavetable the pulsarets/windows and fix the grain envelope (Path A steps 2–4).
   Measure again with `/status` on the Pi; target < 15% CPU.
4. **Only if still unsatisfied**: prototype the engine in Csound `partikkel` or Faust
   behind the existing OSC interface, and A/B it against the fixed SC version.

Rewriting the whole codebase — UI, MIDI, presets, installers — is not warranted. The
non-DSP code is not what sounds bad.

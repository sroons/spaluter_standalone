/*
Spaluter-style pulsar synth recreation in SuperCollider.

Run this whole file, then use:
  ~spaluter = ~spaluterStart.();            // returns a Group: 4 voice clocks, 12 grain streams, 1 mixer
  ~spaluter.set(\voiceCount, 4, \chordType, 4); // Major (set on the group reaches every node)
  ~spaluter.set(\gateMode, 0, \gate, 1);        // MIDI-like held gate
  ~spaluter.set(\gate, 0);                       // release in gate modes 0/2
  ~spaluter.free;

Graph (performance step 2): the pulsaret and window shapes are wavetables built at
load time (band-limited pulsarets in 8 mip levels), each voice is a clock synth that
publishes pulse phase, trigger, envelope and per-grain random values on an audio bus,
each (voice, formant) pair is its own stream synth, and the mixer synth that sums,
drives, scopes and outputs also pauses the stream and clock nodes the current voice
and formant counts do not use. UGen count and CPU now follow the counts instead of
being the 12-stream, 228-generator worst case at all times.
*/
(
s.waitForBoot {
    var ratioByVoice, tableSize, tableStride, nLevels, shapeCount, winCount;

    // 14 chord types, 4 ratios per chord (mirrors Spaluter layout)
    ratioByVoice = [
        [1.0, 1.0, 1.0, 0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0], // v0
        [1.0, 2.0, 1.5, 1.0, 1.259921, 1.189207, 1.259921, 1.189207, 1.334840, 1.259921, 1.189207, 1.259921, 1.498307, 1.498307], // v1
        [1.0, 4.0, 2.0, 2.0, 1.498307, 1.498307, 1.498307, 1.498307, 1.498307, 1.498307, 1.414214, 1.587401, 2.0, 2.0], // v2
        [1.0, 8.0, 3.0, 4.0, 2.0, 2.0, 1.887749, 1.781797, 2.0, 1.781797, 2.0, 2.0, 2.996615, 2.519842]  // v3
    ];

    // ---------------------------------------------------------------------
    // Wavetables. 10 pulsaret shapes x 8 mip levels and 9 window shapes, each
    // tableSize points plus one guard point so BufRd's linear interpolation
    // never crosses into the next table. Pulsaret level k keeps the first
    // (512 >> k) harmonics; a stream picks the level whose top harmonic stays
    // under 20 kHz at its current pulsaret rate, so saw/square/pulse shapes
    // stop folding back over Nyquist the way the closed-form generators did.
    // Built once per sclang session; the server keeps the buffers across
    // Start/Stop, and the SynthDefs below bake the bufnums in as defaults.
    // ---------------------------------------------------------------------
    tableSize = 2048;
    tableStride = tableSize + 1;
    nLevels = 8;
    shapeCount = 10;
    winCount = 9;
    if(~spaluterTablesReady.isNil) {
        var cosTable, bandLimit, pulsaretFns, windowFns, pulsaretData, windowData, noise, seedRng;
        cosTable = Signal.fftCosTable(tableSize);
        // Keep harmonics up to h: a raised-cosine taper over the top third of the
        // band and zero above it (and the mirror bins), back to time domain. A flat
        // cut-off rang at the top harmonic on every saw/square edge (Gibbs); the
        // taper trades a little brightness for a much quieter edge.
        bandLimit = { |sig, h|
            var c = sig.fft(Signal.newClear(tableSize), cosTable), back, h0 = (h * 2 / 3).floor;
            (1 .. tableSize - 1).do { |k|
                var m = min(k, tableSize - k), w;
                w = case
                    { m <= h0 } { 1.0 }
                    { m <= h } { 0.5 * (1 + (pi * (m - h0) / (h - h0)).cos) }
                    { 0.0 };
                if(w < 1.0) { c.real[k] = c.real[k] * w; c.imag[k] = c.imag[k] * w };
            };
            back = c.real.ifft(c.imag, cosTable);
            back.real;
        };
        // Deterministic noise table so every device and every render agree.
        seedRng = Pseed(20251123, Pwhite(-1.0, 1.0, inf)).asStream;
        noise = Signal.fill(tableSize, { seedRng.next });
        pulsaretFns = [
            { |p| (2pi * p).sin },                                               // 0 sine
            { |p| (4pi * p).sin },                                               // 1 sine x2
            { |p| (6pi * p).sin },                                               // 2 sine x3
            { |p| var sx = (p - 0.5) * 8pi; if(sx.abs < 1e-6) { 1.0 } { sx.sin / sx } }, // 3 sinc
            { |p| (1 - (4 * (p - 0.5).abs)).clip(-1, 1) },                      // 4 triangle
            { |p| (p * 2) - 1 },                                                 // 5 saw
            { |p| if(p < 0.5) { 1.0 } { -1.0 } },                                // 6 square
            { |p| (6pi * p).sin * (p * -3).exp },                                // 7 formant-ish
            { |p| ((((p - 0.5) * 20).squared.neg.exp) * 2) - 1 },               // 8 pulse
            { |p, i| noise[i] }                                                  // 9 noise
        ];
        pulsaretData = FloatArray.newClear(shapeCount * nLevels * tableStride);
        pulsaretFns.do { |fn, shape|
            var raw = Signal.fill(tableSize, { |i| fn.value(i / tableSize, i) });
            nLevels.do { |lvl|
                var h = 512 >> lvl, tab = bandLimit.value(raw, h), base = ((shape * nLevels) + lvl) * tableStride;
                tableSize.do { |i| pulsaretData[base + i] = tab[i] };
                pulsaretData[base + tableSize] = tab[0]; // periodic guard point
            };
        };
        windowFns = [
            { |t| 1.0 },                                                         // 0 rectangular
            { |t| (((t - 0.5) / 0.3).squared * 0.5).neg.exp },                   // 1 gaussian
            { |t| 0.5 * (1 - (2pi * t).cos) },                                   // 2 hann
            { |t| (t * -4).exp },                                                // 3 exp decay
            { |t| 1 - t },                                                       // 4 linear decay
            { |t| var a = 0.5; case                                              // 5 tukey alpha 0.5
                { t < (a * 0.5) } { 0.5 * (1 - (2pi * t / a).cos) }
                { t > (1 - (a * 0.5)) } { 0.5 * (1 - (2pi * (1 - t) / a).cos) }
                { 1.0 } },
            { |t| 0.35875 - (0.48829 * (2pi * t).cos) + (0.14128 * (4pi * t).cos) - (0.01168 * (6pi * t).cos) }, // 6 blackman-harris
            { |t| ((1 - t) * -4).exp },                                          // 7 reverse exp
            { |t| (1 - (2 * (t - 0.5).abs)).clip(0, 1) }                        // 8 triangle
        ];
        windowData = FloatArray.newClear(winCount * tableStride);
        windowFns.do { |fn, w|
            tableStride.do { |i| windowData[(w * tableStride) + i] = fn.value(i / tableSize) }; // t = 0..1 inclusive
        };
        ~spaluterPulsaretBuf = Buffer.loadCollection(s, pulsaretData, 1);
        ~spaluterWindowBuf = Buffer.loadCollection(s, windowData, 1);
        // Clock bus: 5 audio channels per voice (phase, trig, gain, jitter, pulse
        // count) plus one control-rate channel per voice for the voice frequency,
        // so everything derived from it in the streams stays control-rate.
        // Mix bus: the streams' stereo sum before drive and output.
        ~spaluterClockBus = Bus.audio(s, 4 * 5);
        ~spaluterFreqBus = Bus.control(s, 4);
        ~spaluterMixBus = Bus.audio(s, 2);
        s.sync;
        ~spaluterTablesReady = true;
        ("spaluterSC tables: " ++ pulsaretData.size ++ " + " ++ windowData.size ++ " floats").postln;
    };

    // ---------------------------------------------------------------------
    // Voice clock: one per voice. Everything the three formant streams of a
    // voice must share leaves here on the clock bus, so the streams fire in
    // step, share one envelope and one amplitude jitter, and stay in step
    // after being paused and resumed by the mixer.
    // ---------------------------------------------------------------------
    SynthDef(\spaluterClock, {
        |gate=1, trigIn=0, gateMode=1, basePitch=32.7032, voiceCount=1, chordType=0,
        attackMs=10, releaseMs=200, glideMs=0, ampJitter=0,
        modBus=0, clockBus=0, freqBus=0, voiceIdx=0|
        var mod, atk, rel, glid, vc, mode, ctype, bPitch, ratio, freq, pulseFreq, trig, phase;
        var envASR, envPulse, env, ampJ, vActive, gain, jitR, pulseCount, modeSm;
        mod = In.kr(modBus, 20);
        atk = (attackMs + mod[16]).max(0.1) * 0.001;
        rel = (releaseMs + mod[17]).max(1.0) * 0.001;
        glid = (glideMs + mod[18]).max(0.0) * 0.001;
        vc = voiceCount.clip(1, 4);
        mode = gateMode.clip(0, 2);        // 0=MIDI-like gate, 1=Free Run, 2=CV-like gate
        ctype = chordType.clip(0, 13);
        bPitch = basePitch.max(0.1) * mod[15].midiratio;
        // ratioByVoice is 4 x 14; index voice*14 + chord into the flat table.
        ratio = Select.kr((voiceIdx.clip(0, 3) * 14) + ctype, ratioByVoice.flat);
        freq = Lag.kr(bPitch * ratio, glid).max(0.1);
        pulseFreq = freq.clip(0.1, 14000);
        trig = Impulse.ar(pulseFreq);
        // Pulse phase is integrated, not elapsed-time x rate: a rate change
        // bends the slope and the phase stays continuous (round 2 fix).
        phase = Phasor.ar(trig, pulseFreq * SampleDur.ir, 0, 1, 0);
        // Note envelopes at audio rate; the gate-mode switch crossfades over
        // 10 ms instead of swapping envelopes inside a grain.
        envASR = EnvGen.ar(Env.asr(atk, 1, rel, -4), Select.kr(mode, [gate, gate, (trigIn > 0)]));
        envPulse = EnvGen.ar(Env.perc(atk, rel, 1, curve: -4), trig);
        modeSm = Lag.kr(mode, 0.01);
        env = SelectX.ar(modeSm, [envASR, envPulse, envASR]);
        // Per-pulse amplitude jitter only attenuates, like the original.
        ampJ = 1 - TRand.ar(0, (ampJitter + mod[12]).clip(0, 1), trig);
        vActive = Lag.ar(K2A.ar(vc > voiceIdx), 0.01);
        gain = env * ampJ * vActive;
        // One random value per grain for the streams' onset jitter: real
        // timing jitter moves each grain inside its period and leaves the
        // average rate alone (the old LFNoise0 version was pitch FM that
        // aliased above ~375 Hz).
        jitR = TRand.ar(-1, 1, trig);
        pulseCount = PulseCount.ar(trig);
        Out.ar(clockBus + (voiceIdx * 5), [phase, trig, gain, jitR, pulseCount]);
        // ReplaceOut: a control bus holds its value between cycles, so a summing
        // Out.kr would accumulate the frequency without bound.
        ReplaceOut.kr(freqBus + voiceIdx, freq);
    }).add;

    // ---------------------------------------------------------------------
    // Grain stream: one per (voice, formant). Reads its voice clock, renders
    // one formant's grains from the wavetables and writes a panned pair to
    // the mix bus. Paused by the mixer while its voice or formant is off.
    // ---------------------------------------------------------------------
    SynthDef(\spaluterStream, {
        |pulsaret=2.5, window=0.5, duty=0.5, dutyMode=0,
        formantCount=3, formant1=20, formant2=200, formant3=400, formantTrack=0,
        maskMode=0, maskAmount=0.5, burstOn=4, burstOff=4, perFormantMask=0,
        glisson=0, timingJitter=0,
        useSample=0, bufnum=0, sampleRate=1.0,
        pan1=0, pan2=0.5, pan3=(-0.5), basePitch=32.7032,
        modBus=0, clockBus=0, freqBus=0, mixBus=0, voiceIdx=0, formantIdx=0|
        var pBuf, wBuf, mod, clk, phase, trig, gain, jitR, pulseCount, freq, pulseFreq, bPitch, fc, fi;
        var invDuty, baseRate, lvlRate, sampleIdxMul;
        var dutySm, pulsaretSm, windowSm, maskAmountSm, glissonSm, sampleRateSm, trackOn, dutyOn, sampleOn, pfmOn;
        var fOn, fBase, fTracked, fEff, dutyF, dutyStart, tp, edgeFrac, edgeEnv, tj;
        var ratioF, glissonAmt, sweepMul, inRegion, regionTrig, wrate, wphase, lvl;
        var psel, plo, pfrac, pidx, tabA, tabB, synthWave, sampleWave, src;
        var wsel, wlo, wfrac, widx, winA, winB, win;
        var randShared, randForm, rsel, maskStoch, total, burstOffset, idx, maskBurst, maskRaw, maskSm, grain, pan;
        var edgeSec = 0.0005;
        pBuf = \pulsaretBuf.kr(~spaluterPulsaretBuf.bufnum);
        wBuf = \windowBuf.kr(~spaluterWindowBuf.bufnum);
        mod = In.kr(modBus, 20);
        clk = In.ar(clockBus + (voiceIdx * 5), 5);
        phase = clk[0]; trig = clk[1]; gain = clk[2]; jitR = clk[3]; pulseCount = clk[4];
        // Voice frequency at control rate: with it, fEff, duty, the pulsaret
        // base rate and the edge width are all control-rate (one value per
        // block) instead of audio-rate chains in each of the twelve streams.
        freq = In.kr(freqBus + voiceIdx, 1).max(0.1);
        pulseFreq = freq.clip(0.1, 14000);
        bPitch = basePitch.max(0.1) * mod[15].midiratio;
        fc = formantCount.clip(1, 3);
        fi = formantIdx.clip(0, 2);

        // Control smoothing (~20 ms) on every continuous control, 10 ms on the
        // switches, so a UI drag, CC, macro or preset recall is a ramp, not a step.
        dutySm = Lag.kr(duty, 0.02);
        pulsaretSm = Lag.kr(pulsaret, 0.02);
        windowSm = Lag.kr(window, 0.02);
        maskAmountSm = Lag.kr(maskAmount, 0.02);
        glissonSm = Lag.kr(glisson, 0.02);
        sampleRateSm = Lag.kr(sampleRate, 0.02);
        trackOn = Lag.kr(formantTrack > 0.5, 0.01);
        dutyOn = Lag.kr(dutyMode > 0.5, 0.01);
        sampleOn = Lag.kr(useSample > 0.5, 0.01);
        pfmOn = Lag.kr(perFormantMask > 0.5, 0.01);

        fOn = Lag.ar(K2A.ar(fc > fi), 0.01);
        fBase = Select.kr(fi, [
            Lag.kr(formant1, 0.02) + mod[5],
            Lag.kr(formant2, 0.02) + mod[6],
            Lag.kr(formant3, 0.02) + mod[7]
        ]).clip(20, 8000);
        fTracked = fBase * (freq / bPitch);
        fEff = (fBase + ((fTracked - fBase) * trackOn)).clip(20, 12000);
        dutyF = ((dutySm + mod[4]).clip(0.01, 1) + (((freq / fEff).clip(0.01, 1) - (dutySm + mod[4]).clip(0.01, 1)) * dutyOn)).max(0.001);
        invDuty = 1 / dutyF;

        // Grain onset: centred in the period, moved by the voice's per-grain
        // random value scaled by timingJitter, never past the period's edges.
        tj = (timingJitter + mod[13]).clip(0, 1);
        dutyStart = (1 - dutyF) * (0.5 + (jitR * (tj * 0.5)));
        tp = ((phase - dutyStart) * invDuty).clip(0, 1);

        // Grain edge: smoothstep fade over the first and last ~0.5 ms of the
        // duty region; exactly zero outside it (replaces the boolean duty gate).
        edgeFrac = (edgeSec * pulseFreq * invDuty).clip(0.001, 0.5);
        edgeEnv = (tp * (1 - tp) / (edgeFrac * (1 - edgeFrac))).min(1);
        edgeEnv = edgeEnv * edgeEnv * (3 - (2 * edgeEnv));

        // Pulsaret phase, integrated and reset where the duty region begins.
        // Rate is pulseFreq x ratioF (= fEff), so the formant lands where the
        // UI says: the old form divided by duty and put every formant an
        // octave high at duty 0.5 (audio-quality-analysis.md 3.3).
        ratioF = fEff / freq;
        glissonAmt = (glissonSm + mod[14]).clip(-2, 2);
        sweepMul = 2.pow(glissonAmt * (tp - 0.5));
        inRegion = (phase >= dutyStart) * (phase < (dutyStart + dutyF));
        regionTrig = ((inRegion - Delay1.ar(inRegion)) > 0) + trig;
        baseRate = pulseFreq * ratioF;
        wrate = baseRate * sweepMul * (1 + (tp * (glissonAmt * 2.log)));
        wphase = Phasor.ar(regionTrig, wrate * SampleDur.ir, 0, 1, 0);

        // Pulsaret: two table reads (adjacent shapes) and a crossfade, from the
        // mip level whose top harmonic (512 >> level) stays under 20 kHz at the
        // fastest rate the glisson sweep reaches. The level is latched at each
        // grain start: switching tables mid-grain was a small click.
        lvlRate = baseRate * (2 ** (glissonAmt.abs * 0.5));
        lvl = (lvlRate.max(1) * (512 / 20000)).log2.ceil.clip(0, nLevels - 1);
        lvl = Latch.ar(K2A.ar(lvl), regionTrig);
        // Shape selection per sample. The server ramps a control-rate value
        // across the block wherever it meets an audio-rate signal (K2A included),
        // so a control-rate table offset swept the read index through thousands
        // of frames of neighbouring tables on every shape change: a 1.3 ms burst
        // of noise. Converting the selector first and taking floor and fraction
        // at audio rate gives an exact integer offset at every sample and a
        // fraction that stays continuous through the crossing.
        psel = K2A.ar((pulsaretSm + mod[2]).clip(0, shapeCount - 1));
        plo = psel.floor.min(shapeCount - 2);
        pfrac = psel - plo;
        pidx = wphase * tableSize;
        tabA = BufRd.ar(1, pBuf, (((plo * nLevels) + lvl) * tableStride) + pidx, loop: 0, interpolation: 2);
        tabB = BufRd.ar(1, pBuf, ((((plo + 1) * nLevels) + lvl) * tableStride) + pidx, loop: 0, interpolation: 2);
        synthWave = tabA + ((tabB - tabA) * pfrac);
        // BufRd wraps the index itself (loop: 1), so one multiply positions it.
        sampleIdxMul = BufFrames.kr(bufnum) * (sampleRateSm + mod[19]).max(0.01);
        sampleWave = BufRd.ar(1, bufnum, wphase * sampleIdxMul, loop: 1, interpolation: 2);
        src = synthWave + ((sampleWave - synthWave) * sampleOn);

        // Window: same two-read crossfade over tp (0..1 inclusive).
        wsel = K2A.ar((windowSm + mod[3]).clip(0, winCount - 1));
        wlo = wsel.floor.min(winCount - 2);
        wfrac = wsel - wlo;
        widx = tp * tableSize;
        winA = BufRd.ar(1, wBuf, (wlo * tableStride) + widx, loop: 0, interpolation: 2);
        winB = BufRd.ar(1, wBuf, ((wlo + 1) * tableStride) + widx, loop: 0, interpolation: 2);
        win = winA + ((winB - winA) * wfrac);

        // Masking. Hasher is -1..1; mapped to 0..1 before the compare.
        randShared = Hasher.ar(pulseCount + (voiceIdx * 101));
        randForm = Hasher.ar(pulseCount + (voiceIdx * 101) + (fi * 37));
        rsel = randShared + ((randForm - randShared) * pfmOn);
        maskStoch = (((rsel * 0.5) + 0.5) > (maskAmountSm + mod[8]).clip(0, 1));
        total = (burstOn + burstOff).max(1);
        burstOffset = Select.kr(perFormantMask > 0.5, [0, fi * (total / 3)]);
        idx = (pulseCount + burstOffset) % total;
        maskBurst = (idx < burstOn);
        maskRaw = Select.ar(maskMode.clip(0, 2), [DC.ar(1), maskStoch, maskBurst]);
        maskSm = Lag.ar(maskRaw, 0.003);

        grain = src * win * edgeEnv * maskSm * fOn * gain;
        pan = Select.kr(fi, [Lag.kr(pan1, 0.02) + mod[9], Lag.kr(pan2, 0.02) + mod[10], Lag.kr(pan3, 0.02) + mod[11]]).clip(-1, 1);
        Out.ar(mixBus, Pan2.ar(grain, pan, 1.0));
    }).add;

    // ---------------------------------------------------------------------
    // Mixer: sums the mix bus, normalises by the (lagged) counts, drive,
    // scope, make-up and output. Keeps the name \spaluterSC because the
    // runtime waits for that SynthDef before it calls ~spaluterStart. It also
    // owns the node IDs of the clocks and streams and pauses each one 30 ms
    // after its voice/formant goes off (after the 10 ms fade inside the node)
    // and resumes it the instant the count brings it back.
    // ---------------------------------------------------------------------
    SynthDef(\spaluterSC, {
        |out=0, amp=0.2, drive=1.0, voiceCount=1, formantCount=3,
        scopeEnabled=1, scopeRate=20, modBus=0, mixBus=0,
        clockIds = #[0, 0, 0, 0], streamIds = #[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]|
        var mod, sig, vc, fc, ampSm, driveSm, makeup = 2.0, runGate;
        var scopeFrames, scopeBufL, scopeBufR, scopeWritePos, scopeReadPos, scopeValuesL, scopeValuesR, scopeTrig;
        mod = In.kr(modBus, 20);
        vc = voiceCount.clip(1, 4);
        fc = formantCount.clip(1, 3);
        ampSm = Lag.ar(K2A.ar(amp), 0.02);
        driveSm = Lag.kr(drive, 0.02);
        // Divisors follow the counts over 10 ms so a count change is a fade.
        sig = LeakDC.ar(In.ar(mixBus, 2)) / Lag.kr(fc, 0.01).max(1) / Lag.kr(vc, 0.01).max(1);
        sig = tanh(sig * (driveSm + mod[1]).clip(0.1, 4.0));
        scopeFrames = 64;
        scopeBufL = LocalBuf(scopeFrames, 1);
        scopeBufR = LocalBuf(scopeFrames, 1);
        scopeWritePos = Phasor.ar(0, 1, 0, scopeFrames, 0);
        BufWr.ar(sig[0] * 0.9, scopeBufL, scopeWritePos, loop: 1);
        BufWr.ar(sig[1] * 0.9, scopeBufR, scopeWritePos, loop: 1);
        // Control-rate readers: one read per block, consumed only by SendReply.
        scopeReadPos = (A2K.kr(scopeWritePos) - Array.series(scopeFrames, scopeFrames - 1, -1)).wrap(0, scopeFrames - 1);
        scopeValuesL = BufRd.kr(1, scopeBufL, scopeReadPos, loop: 1, interpolation: 1);
        scopeValuesR = BufRd.kr(1, scopeBufR, scopeReadPos, loop: 1, interpolation: 1);
        scopeTrig = Impulse.kr(scopeRate.clip(1, 60)) * (scopeEnabled > 0);
        SendReply.kr(scopeTrig, "/spaluter/scope", scopeValuesL ++ scopeValuesR);
        // +6 dB make-up after the drive stage; the final Limiter lives in the
        // reverb synth, the last node before the hardware.
        Out.ar(out, sig * makeup * (ampSm + mod[0]).max(0));
        // Run gates: 1 while a node is wanted or still fading, 0 once it has
        // been off for 30 ms. Pause.kr only acts on changes of its gate.
        runGate = { |active| ((active + (Lag.kr(active, 0.03) > 0.0005)) > 0) };
        4.do { |vi| Pause.kr(runGate.value(vc > vi), clockIds[vi]) };
        12.do { |i| Pause.kr(runGate.value((vc > (i div: 3)) * (fc > (i % 3))), streamIds[i]) };
    }).add;

    // Zeroes the 16-channel modulation bus each control block so the LFO
    // synths (which use additive Out.kr) sum cleanly. Runs at the head of the
    // LFO group, before any LFO and before the main synth reads the bus.
    SynthDef(\modClear, { |modBus=0|
        ReplaceOut.kr(modBus, DC.kr(0) ! 20);
    }).add;

    // One internal LFO. Writes its bipolar output * depth additively into one
    // channel (targetIdx) of the modulation bus. Shape selects waveform; all
    // shapes derive from a shared 0..1 phasor so `phase` is uniform. Retarget
    // is done by free + respawn in runtime.scd (targetIdx fixed per instance).
    // Beat position for clock-locked LFOs. The renderer counts MIDI clock ticks
    // and reports the position (ticks / 24, in beats since Start) every
    // sixteenth and on Start; between reports the position advances at the
    // reported tempo. Each report latches the offset between the counted and
    // the integrated position and glides it in over 80 ms, so estimate jitter
    // never steps an LFO's phase; a Start report snaps the position instead.
    SynthDef(\spaluterClockMaster, { |clockBus=0, hz=2, pos=0, t_resync=0, t_reset=0|
        var sweep, err, lagT;
        sweep = Sweep.kr(t_reset, Lag.kr(hz.max(0), 0.05));
        err = Latch.kr(pos - sweep, t_resync + t_reset);
        lagT = 0.08 * (1 - t_reset);
        ReplaceOut.kr(clockBus, sweep + Lag.kr(err, lagT));
    }).add;

    // useClock 1: the phase comes from the beat-position bus times ratio (cycles
    // per beat: /4 is one cycle every four beats, x2 two per beat), so the LFO
    // sits on the same beat every bar instead of merely running at tempo.
    // useClock 0: free-running at rate. S&H steps on the cycle boundary in both
    // modes, so clocked steps land on the grid.
    // scopeOut: index of this LFO's channel on the 16-channel LFO output bus.
    // The normalised (-1..1, depth-free) value is published there for the
    // Mods screen monitor; the main synth never reads it.
    SynthDef(\spaluterLfo, { |modBus=0, targetIdx=0, rate=1, depth=0, shape=0, phase=0, enabled=1, lag=0.02, clockBus=0, useClock=0, ratio=1, scopeOut=0|
        var freePh, clockPh, ph, wrapTrig, sine, tri, sawU, sawD, sqr, sh, rnd, osc, sig, norm;
        freePh = LFSaw.kr(rate, 0).range(0, 1);
        clockPh = (In.kr(clockBus, 1) * ratio).wrap(0, 1);
        ph = (Select.kr(useClock.clip(0, 1), [freePh, clockPh]) + phase).wrap(0, 1);
        wrapTrig = (ph - Delay1.kr(ph)) < -0.5;
        sine = (2pi * ph).sin;
        tri  = 1 - (4 * (ph - 0.5).abs);
        sawU = (2 * ph) - 1;
        sawD = 1 - (2 * ph);
        sqr  = ((ph < 0.5) * 2) - 1;
        sh   = TRand.kr(-1, 1, wrapTrig);
        rnd  = LFNoise2.kr(rate);
        osc  = Select.kr(shape.clip(0, 6), [sine, tri, sawU, sawD, sqr, sh, rnd]);
        norm = Lag.kr(osc * enabled, lag);
        sig  = norm * depth;
        Out.kr(modBus + targetIdx, sig);
        ReplaceOut.kr(scopeOut, norm);
    }).add;

    // Modulation monitor for the Mods screen. Runs right after the LFO group
    // and reports, at `rate` Hz while enabled, the 16 normalised LFO outputs,
    // the 20 summed mod-bus channels (native units, what the synth actually
    // receives) and the beat position. The renderer draws its LFO scope and
    // live meters from this, so what it shows is the engine's output rather
    // than a client-side re-synthesis of the LFO shapes.
    SynthDef(\spaluterModScope, { |lfoBus=0, modBus=0, clockBus=0, rate=30, enabled=0|
        var trig = Impulse.kr(rate.clip(1, 60)) * (enabled > 0);
        SendReply.kr(trig, "/spaluter/modscope", In.kr(lfoBus, 16) ++ In.kr(modBus, 20) ++ In.kr(clockBus, 1));
    }).add;

    // Mutable Instruments Clouds-style reverb core with an added octave shimmer
    // branch. Reads the synth's stereo output bus, processes a diffused feedback
    // delay network, and writes the dry/wet blend back with ReplaceOut. Runs
    // AFTER \spaluterSC in node order (the runtime adds it \addAfter ~spaluter),
    // so In.ar sees the freshly written synth output within the same control
    // block. Kept as a separate, persistent synth so the tail keeps ringing while
    // voices are gated/released and so the scope/peak metering inside
    // \spaluterSC stays pre-reverb.
    //
    // CPU notes (RPi4): the input diffuser uses AllpassN (no interpolation,
    // static times); the feedback loop uses DelayL/AllpassL (linear interp).
    SynthDef(\spaluterReverb, {
        |out=0, revWet=0, revTime=0.6, revDamp=0.5, revDiff=0.7, revMod=0.3,
        revShimmer=0, revPreDelay=0, revLowCut=20,
        dlyWet=0, dlyFeedback=0.35, dlyTimeMs=320, dlySpread=0.45,
        dlySyncMode=0, dlyClockHz=0, dlyClockRatio=1|

        var in, pre, diff, diffCoef, local, inL, inR, fb;
        var modDepth, modL, modR, lpFreq, earlyL, earlyR;
        var tankL, tankR, wet, mix, sig, shimmerAmt, shimmerMono, shimmerL, shimmerR;
        var dlyMix, dlyFeedbackAmt, dlyBaseMs, dlyBaseSec, dlyClockMs, dlySpreadAmt, dlyDecaySec;
        var dlyTapBase, dlyTapTimesL, dlyTapTimesR, dlyTapL, dlyTapR, dlyWetSig;
        var dlyClockOn, dlyTapMul, dlyDetuneR;

        in = In.ar(out, 2);

        // Pre-delay (up to 250 ms) before any reverberation.
        pre = DelayN.ar(in, 0.25, (revPreDelay * 0.001).clip(0, 0.25));

        // Input diffuser: 4 series allpasses with static, prime-ish delay times.
        // Keep a minimum decay for density, then expand with Diffusion.
        diffCoef = revDiff.clip(0, 1);
        diff = pre;
        [0.004771, 0.003595, 0.012730, 0.009307].do { |dt|
            diff = AllpassN.ar(diff, dt, dt, dt * (6 + (diffCoef * 20)));
        };

        // Small asymmetric early reflections make the space feel less "boingy"
        // before entering the late feedback tank.
        earlyL = (DelayN.ar(diff[0], 0.06, 0.0061) * 0.30)
            + (DelayN.ar(diff[0], 0.06, 0.0153) * 0.22)
            + (DelayN.ar(diff[1], 0.06, 0.0217) * 0.18);
        earlyR = (DelayN.ar(diff[1], 0.06, 0.0057) * 0.30)
            + (DelayN.ar(diff[1], 0.06, 0.0179) * 0.22)
            + (DelayN.ar(diff[0], 0.06, 0.0241) * 0.18);

        // Late feedback tank: cross-coupled modulated delays + staged allpass
        // diffusion + loop filtering.
        fb = revTime.clip(0, 0.95);
        modDepth = revMod.clip(0, 1) * 0.0012;  // up to 1.2 ms wobble
        modL = LFNoise2.kr(0.11).range(modDepth.neg, modDepth);
        modR = LFNoise2.kr(0.15).range(modDepth.neg, modDepth);
        // More damping => darker (lower in-loop low-pass cutoff).
        lpFreq = LinExp.kr(revDamp.clip(0, 1), 0, 1, 18000, 1600);

        local = LocalIn.ar(2);
        inL = diff[0] + earlyL + (local[1] * fb);
        inR = diff[1] + earlyR + (local[0] * fb);

        tankL = DelayL.ar(inL, 0.18, (0.0371 + modL).clip(0.002, 0.18));
        tankR = DelayL.ar(inR, 0.18, (0.0532 + modR).clip(0.002, 0.18));

        tankL = AllpassL.ar(tankL, 0.09, LFNoise1.kr(0.07).range(0.031, 0.067), 0.55 + (diffCoef * 0.45));
        tankR = AllpassL.ar(tankR, 0.09, LFNoise1.kr(0.083).range(0.034, 0.071), 0.55 + (diffCoef * 0.45));
        tankL = AllpassL.ar(tankL, 0.07, LFNoise1.kr(0.13).range(0.019, 0.049), 0.45 + (diffCoef * 0.35));
        tankR = AllpassL.ar(tankR, 0.07, LFNoise1.kr(0.17).range(0.021, 0.051), 0.45 + (diffCoef * 0.35));

        tankL = LeakDC.ar(LPF.ar(HPF.ar(tankL, 35), lpFreq));
        tankR = LeakDC.ar(LPF.ar(HPF.ar(tankR, 35), lpFreq));

        // True shimmer: octave-up pitch-shifted branch re-injected into the tank.
        shimmerAmt = revShimmer.clip(0, 1);
        shimmerMono = PitchShift.ar((tankL + tankR) * 0.5, 0.11, 2.0, 0.0, 0.01);
        shimmerMono = HPF.ar(LPF.ar(shimmerMono, 9000), 350);
        shimmerL = DelayC.ar(shimmerMono, 0.03, 0.0087);
        shimmerR = DelayC.ar(shimmerMono, 0.03, 0.0131);

        LocalOut.ar([
            tankL + (shimmerR * shimmerAmt * 0.24),
            tankR + (shimmerL * shimmerAmt * 0.24)
        ]);

        wet = [tankL, tankR] + ([shimmerL, shimmerR] * (shimmerAmt * 0.35));
        wet = HPF.ar(wet, revLowCut.clip(20, 1000));

        mix = Lag.kr(revWet.clip(0, 1), 0.05);
        sig = (in * (1 - mix)) + (wet * mix);
        // Lightweight 4-tap delay: static taps + CombN tails for stable CPU on Pi.
        dlyMix = Lag.kr(dlyWet.clip(0, 1), 0.05);
        dlyFeedbackAmt = dlyFeedback.clip(0, 0.88);
        dlySpreadAmt = dlySpread.clip(0, 1);
        // Divide the beat length by Clock Ratio: /N lengthens (slows) the delay, xN shortens it.
        dlyClockMs = (1000 / dlyClockHz.max(0.001)) / dlyClockRatio.clip(0.0625, 16);
        dlyClockOn = (dlySyncMode > 0.5) * (dlyClockHz > 0.001);
        dlyBaseMs = Select.kr(dlyClockOn, [
            dlyTimeMs.clip(20, 2000),
            dlyClockMs.clip(20, 2000)
        ]);
        dlyBaseSec = Lag.kr(dlyBaseMs * 0.001, 0.04);
        dlyDecaySec = ((log(0.001) / log((dlyFeedbackAmt * 0.98).max(0.001))).abs * dlyBaseSec).clip(0.05, 12);

        // Free mode keeps continuous spread; MIDI Clock mode quantizes each tap to the
        // nearest whole multiple of the clock-synced base time so every tap lands on the grid.
        dlyTapMul = [1.0, 1.0 + (0.45 * dlySpreadAmt), 1.0 + (0.95 * dlySpreadAmt), 1.0 + (1.55 * dlySpreadAmt)];
        dlyTapMul = (dlyTapMul * (1 - dlyClockOn)) + (dlyTapMul.round(1.0) * dlyClockOn);
        dlyTapMul = Lag.kr(dlyTapMul, 0.04);
        dlyTapBase = dlyBaseSec * dlyTapMul;
        // Stereo time-detune applies in free mode only; clock mode keeps both channels grid-locked.
        dlyDetuneR = ([1.11, 0.93, 1.19, 0.89] * (1 - dlyClockOn)) + dlyClockOn;
        dlyTapTimesL = dlyTapBase.clip(0.01, 2.4);
        dlyTapTimesR = (dlyTapBase * dlyDetuneR).clip(0.01, 2.4);

        dlyTapL = (CombN.ar(in[0], 2.5, dlyTapTimesL[0], dlyDecaySec) * 0.34)
            + (CombN.ar(in[1], 2.5, dlyTapTimesL[1], dlyDecaySec * 0.92) * 0.27)
            + (CombN.ar(in[0], 2.5, dlyTapTimesL[2], dlyDecaySec * 0.84) * 0.22)
            + (CombN.ar(in[1], 2.5, dlyTapTimesL[3], dlyDecaySec * 0.76) * 0.17);
        dlyTapR = (CombN.ar(in[1], 2.5, dlyTapTimesR[0], dlyDecaySec) * 0.34)
            + (CombN.ar(in[0], 2.5, dlyTapTimesR[1], dlyDecaySec * 0.92) * 0.27)
            + (CombN.ar(in[1], 2.5, dlyTapTimesR[2], dlyDecaySec * 0.84) * 0.22)
            + (CombN.ar(in[0], 2.5, dlyTapTimesR[3], dlyDecaySec * 0.76) * 0.17);
        dlyWetSig = LeakDC.ar(LPF.ar(HPF.ar([dlyTapL, dlyTapR], 70), 6800));
        dlyWetSig = Limiter.ar(dlyWetSig, 0.97, 0.005);

        sig = (sig * (1 - (dlyMix * 0.35))) + (dlyWetSig * dlyMix);
        // Final bus: block any DC the drive stage or FX leave behind and catch
        // peaks with a 2 ms look-ahead brickwall, so the hotter master level
        // never clips the DAC. This is the last node before the hardware.
        sig = Limiter.ar(LeakDC.ar(sig), 0.95, 0.002);
        ReplaceOut.ar(out, sig);
    }).add;

    // No-shimmer variant: identical tank and mix path, but without PitchShift or
    // shimmer reinjection so revShimmer == 0 costs no shimmer DSP.
    SynthDef(\spaluterReverbNoShim, {
        |out=0, revWet=0, revTime=0.6, revDamp=0.5, revDiff=0.7, revMod=0.3,
        revPreDelay=0, revLowCut=20,
        dlyWet=0, dlyFeedback=0.35, dlyTimeMs=320, dlySpread=0.45,
        dlySyncMode=0, dlyClockHz=0, dlyClockRatio=1|

        var in, pre, diff, diffCoef, local, inL, inR, fb;
        var modDepth, modL, modR, lpFreq, earlyL, earlyR;
        var tankL, tankR, wet, mix, sig;
        var dlyMix, dlyFeedbackAmt, dlyBaseMs, dlyBaseSec, dlyClockMs, dlySpreadAmt, dlyDecaySec;
        var dlyTapBase, dlyTapTimesL, dlyTapTimesR, dlyTapL, dlyTapR, dlyWetSig;
        var dlyClockOn, dlyTapMul, dlyDetuneR;

        in = In.ar(out, 2);

        // Pre-delay (up to 250 ms) before any reverberation.
        pre = DelayN.ar(in, 0.25, (revPreDelay * 0.001).clip(0, 0.25));

        // Input diffuser: 4 series allpasses with static, prime-ish delay times.
        // Keep a minimum decay for density, then expand with Diffusion.
        diffCoef = revDiff.clip(0, 1);
        diff = pre;
        [0.004771, 0.003595, 0.012730, 0.009307].do { |dt|
            diff = AllpassN.ar(diff, dt, dt, dt * (6 + (diffCoef * 20)));
        };

        // Small asymmetric early reflections make the space feel less "boingy"
        // before entering the late feedback tank.
        earlyL = (DelayN.ar(diff[0], 0.06, 0.0061) * 0.30)
            + (DelayN.ar(diff[0], 0.06, 0.0153) * 0.22)
            + (DelayN.ar(diff[1], 0.06, 0.0217) * 0.18);
        earlyR = (DelayN.ar(diff[1], 0.06, 0.0057) * 0.30)
            + (DelayN.ar(diff[1], 0.06, 0.0179) * 0.22)
            + (DelayN.ar(diff[0], 0.06, 0.0241) * 0.18);

        // Late feedback tank: cross-coupled modulated delays + staged allpass
        // diffusion + loop filtering.
        fb = revTime.clip(0, 0.95);
        modDepth = revMod.clip(0, 1) * 0.0012;  // up to 1.2 ms wobble
        modL = LFNoise2.kr(0.11).range(modDepth.neg, modDepth);
        modR = LFNoise2.kr(0.15).range(modDepth.neg, modDepth);
        // More damping => darker (lower in-loop low-pass cutoff).
        lpFreq = LinExp.kr(revDamp.clip(0, 1), 0, 1, 18000, 1600);

        local = LocalIn.ar(2);
        inL = diff[0] + earlyL + (local[1] * fb);
        inR = diff[1] + earlyR + (local[0] * fb);

        tankL = DelayL.ar(inL, 0.18, (0.0371 + modL).clip(0.002, 0.18));
        tankR = DelayL.ar(inR, 0.18, (0.0532 + modR).clip(0.002, 0.18));

        tankL = AllpassL.ar(tankL, 0.09, LFNoise1.kr(0.07).range(0.031, 0.067), 0.55 + (diffCoef * 0.45));
        tankR = AllpassL.ar(tankR, 0.09, LFNoise1.kr(0.083).range(0.034, 0.071), 0.55 + (diffCoef * 0.45));
        tankL = AllpassL.ar(tankL, 0.07, LFNoise1.kr(0.13).range(0.019, 0.049), 0.45 + (diffCoef * 0.35));
        tankR = AllpassL.ar(tankR, 0.07, LFNoise1.kr(0.17).range(0.021, 0.051), 0.45 + (diffCoef * 0.35));

        tankL = LeakDC.ar(LPF.ar(HPF.ar(tankL, 35), lpFreq));
        tankR = LeakDC.ar(LPF.ar(HPF.ar(tankR, 35), lpFreq));

        LocalOut.ar([tankL, tankR]);

        wet = [tankL, tankR];
        wet = HPF.ar(wet, revLowCut.clip(20, 1000));

        mix = Lag.kr(revWet.clip(0, 1), 0.05);
        sig = (in * (1 - mix)) + (wet * mix);
        // Lightweight 4-tap delay: static taps + CombN tails for stable CPU on Pi.
        dlyMix = Lag.kr(dlyWet.clip(0, 1), 0.05);
        dlyFeedbackAmt = dlyFeedback.clip(0, 0.88);
        dlySpreadAmt = dlySpread.clip(0, 1);
        // Divide the beat length by Clock Ratio: /N lengthens (slows) the delay, xN shortens it.
        dlyClockMs = (1000 / dlyClockHz.max(0.001)) / dlyClockRatio.clip(0.0625, 16);
        dlyClockOn = (dlySyncMode > 0.5) * (dlyClockHz > 0.001);
        dlyBaseMs = Select.kr(dlyClockOn, [
            dlyTimeMs.clip(20, 2000),
            dlyClockMs.clip(20, 2000)
        ]);
        dlyBaseSec = Lag.kr(dlyBaseMs * 0.001, 0.04);
        dlyDecaySec = ((log(0.001) / log((dlyFeedbackAmt * 0.98).max(0.001))).abs * dlyBaseSec).clip(0.05, 12);

        // Free mode keeps continuous spread; MIDI Clock mode quantizes each tap to the
        // nearest whole multiple of the clock-synced base time so every tap lands on the grid.
        dlyTapMul = [1.0, 1.0 + (0.45 * dlySpreadAmt), 1.0 + (0.95 * dlySpreadAmt), 1.0 + (1.55 * dlySpreadAmt)];
        dlyTapMul = (dlyTapMul * (1 - dlyClockOn)) + (dlyTapMul.round(1.0) * dlyClockOn);
        dlyTapMul = Lag.kr(dlyTapMul, 0.04);
        dlyTapBase = dlyBaseSec * dlyTapMul;
        // Stereo time-detune applies in free mode only; clock mode keeps both channels grid-locked.
        dlyDetuneR = ([1.11, 0.93, 1.19, 0.89] * (1 - dlyClockOn)) + dlyClockOn;
        dlyTapTimesL = dlyTapBase.clip(0.01, 2.4);
        dlyTapTimesR = (dlyTapBase * dlyDetuneR).clip(0.01, 2.4);

        dlyTapL = (CombN.ar(in[0], 2.5, dlyTapTimesL[0], dlyDecaySec) * 0.34)
            + (CombN.ar(in[1], 2.5, dlyTapTimesL[1], dlyDecaySec * 0.92) * 0.27)
            + (CombN.ar(in[0], 2.5, dlyTapTimesL[2], dlyDecaySec * 0.84) * 0.22)
            + (CombN.ar(in[1], 2.5, dlyTapTimesL[3], dlyDecaySec * 0.76) * 0.17);
        dlyTapR = (CombN.ar(in[1], 2.5, dlyTapTimesR[0], dlyDecaySec) * 0.34)
            + (CombN.ar(in[0], 2.5, dlyTapTimesR[1], dlyDecaySec * 0.92) * 0.27)
            + (CombN.ar(in[1], 2.5, dlyTapTimesR[2], dlyDecaySec * 0.84) * 0.22)
            + (CombN.ar(in[0], 2.5, dlyTapTimesR[3], dlyDecaySec * 0.76) * 0.17);
        dlyWetSig = LeakDC.ar(LPF.ar(HPF.ar([dlyTapL, dlyTapR], 70), 6800));
        dlyWetSig = Limiter.ar(dlyWetSig, 0.97, 0.005);

        sig = (sig * (1 - (dlyMix * 0.35))) + (dlyWetSig * dlyMix);
        // Final bus: block any DC the drive stage or FX leave behind and catch
        // peaks with a 2 ms look-ahead brickwall, so the hotter master level
        // never clips the DAC. This is the last node before the hardware.
        sig = Limiter.ar(LeakDC.ar(sig), 0.95, 0.002);
        ReplaceOut.ar(out, sig);
    }).add;

    s.sync;

    // Builds the whole voice: a Group holding 4 clocks, 12 streams and the
    // mixer, created in one bundle in that order (clocks write the clock bus
    // before the streams read it; the streams write the mix bus before the
    // mixer reads it). The Group is what the runtime holds as ~spaluter: set
    // reaches every node (names a node does not have are ignored by the
    // server), free frees all of them, and \addAfter the group places the
    // reverb after the mixer.
    ~spaluterStart = { |out=0, modBus=0, target, addAction=\addToHead|
        var group, clocks, streams, mixer, msgs, shared;
        var defaults = [
            \amp, 0.25, \gateMode, 1, \voiceCount, 1, \chordType, 0,
            \pulsaret, 2.5, \window, 0.5, \duty, 0.5,
            \formantCount, 3, \formant1, 20, \formant2, 200, \formant3, 400,
            \pan1, 0, \pan2, 0.5, \pan3, -0.5
        ];
        group = Group.basicNew(s);
        clocks = 4.collect { Synth.basicNew(\spaluterClock, s) };
        streams = 12.collect { Synth.basicNew(\spaluterStream, s) };
        mixer = Synth.basicNew(\spaluterSC, s);
        shared = [\modBus, modBus, \clockBus, ~spaluterClockBus.index, \freqBus, ~spaluterFreqBus.index, \mixBus, ~spaluterMixBus.index];
        msgs = [group.newMsg(target, addAction)];
        clocks.do { |node, vi| msgs = msgs.add(node.newMsg(group, shared ++ [\voiceIdx, vi], \addToTail)) };
        streams.do { |node, i| msgs = msgs.add(node.newMsg(group, shared ++ [
            \voiceIdx, i div: 3, \formantIdx, i % 3,
            \pulsaretBuf, ~spaluterPulsaretBuf.bufnum, \windowBuf, ~spaluterWindowBuf.bufnum
        ], \addToTail)) };
        msgs = msgs.add(mixer.newMsg(group, shared ++ [
            \out, out,
            \clockIds, clocks.collect(_.nodeID), \streamIds, streams.collect(_.nodeID)
        ], \addToTail));
        msgs = msgs.add(group.setMsg(*defaults));
        s.listSendBundle(nil, msgs);
        group
    };

    ~spaluterGui = {
        var w, mkLabelSlider, mkLabelMenu, makePresetButton;
        var chordItems, gateItems, maskItems;
        var setParam, ctrlSetters, applyParams;

        chordItems = [
            "Unison", "Octaves", "Fifths", "Sub+Oct",
            "Major", "Minor", "Maj7", "Min7",
            "Sus4", "Dom7", "Dim", "Aug",
            "Power", "Open5th"
        ];
        gateItems = ["MIDI-like", "Free Run", "CV-like"];
        maskItems = ["Off", "Stochastic", "Burst"];

        w = Window("SpaluterSC (simple)", Rect(120, 120, 420, 620)).front.alwaysOnTop_(true);
        w.view.decorator = FlowLayout(w.view.bounds.insetBy(10, 10), 8@8, 8@8);

        StaticText(w, 390@18).string_("Start synth first: ~spaluter = ~spaluterStart.();");

        setParam = { |k, v|
            if(~spaluter.notNil) { ~spaluter.set(k, v); };
        };

        ctrlSetters = IdentityDictionary.new;
        applyParams = { |pairs|
            pairs.pairsDo { |k, v|
                var fn = ctrlSetters[k];
                if(fn.notNil) { fn.value(v, true) } { setParam.(k, v) };
            };
        };

        Button(w, 190@24)
            .states_([["Start"], ["Restart"]])
            .action_({
                if(~spaluter.notNil) { ~spaluter.free };
                ~spaluter = ~spaluterStart.();
            });

        Button(w, 190@24)
            .states_([["Stop"]])
            .action_({
                if(~spaluter.notNil) { ~spaluter.free; ~spaluter = nil; };
            });

        Button(w, 190@24)
            .states_([["Gate Off"], ["Gate On"]])
            .action_({ |btn|
                if(~spaluter.notNil) { ~spaluter.set(\gate, btn.value); };
            });

        mkLabelMenu = { |label, items, default=0, paramKey|
            var m;
            StaticText(w, 130@18).string_(label);
            m = PopUpMenu(w, 250@22)
                .items_(items)
                .value_(default)
                .action_({ |pm| setParam.(paramKey, pm.value) });

            ctrlSetters[paramKey] = { |val, send=true|
                var v = val.asInteger.clip(0, items.size - 1);
                m.value = v;
                if(send) { setParam.(paramKey, v) };
            };
        };

        mkLabelSlider = { |label, min, max, init, paramKey, quant=0|
            var num, sl, normalize, snap;
            normalize = { |v| ((v - min) / (max - min)).clip(0, 1) };
            snap = { |v|
                var vv = v.clip(min, max);
                if(quant > 0) { vv = ((vv / quant).round * quant).clip(min, max); };
                vv;
            };

            StaticText(w, 130@18).string_(label);
            num = NumberBox(w, 70@22).value_(init).clipLo_(min).clipHi_(max)
                .action_({ |nb|
                    var v = snap.(nb.value);
                    nb.value = v;
                    sl.value = normalize.(v);
                    setParam.(paramKey, v);
                });
            sl = Slider(w, 170@22)
                .value_(normalize.(init))
                .action_({ |sl|
                    var v = snap.(min + (sl.value * (max - min)));
                    num.value = v;
                    setParam.(paramKey, v);
                });

            ctrlSetters[paramKey] = { |val, send=true|
                var v = snap.(val);
                num.value = v;
                sl.value = normalize.(v);
                if(send) { setParam.(paramKey, v) };
            };
        };

        makePresetButton = { |title, pairs|
            Button(w, 120@24)
                .states_([[title]])
                .action_({ applyParams.(pairs) });
        };

        StaticText(w, 390@18).string_("Presets / utility");
        makePresetButton.("Classic", [
            \pulsaret, 3.0, \window, 1.0, \duty, 0.4,
            \formantCount, 1, \formant1, 200, \maskMode, 0,
            \ampJitter, 0, \timingJitter, 0, \glisson, 0,
            \drive, 1.0, \voiceCount, 1, \chordType, 0
        ]);
        makePresetButton.("Metallic", [
            \pulsaret, 7.0, \window, 3.0, \duty, 0.3,
            \formantCount, 3, \formant1, 200, \formant2, 347, \formant3, 511,
            \maskMode, 0, \ampJitter, 0.1, \timingJitter, 0.1, \glisson, 0.2,
            \drive, 1.2
        ]);
        makePresetButton.("Cloud", [
            \pulsaret, 9.0, \window, 1.0, \duty, 0.15,
            \formantCount, 2, \formant1, 800, \formant2, 1400,
            \maskMode, 1, \maskAmount, 0.7, \ampJitter, 0.4, \timingJitter, 0.3, \glisson, -0.2
        ]);

        Button(w, 120@24)
            .states_([["Randomize"]])
            .action_({
                applyParams.([
                    \pulsaret, rrand(0.0, 9.0),
                    \window, rrand(0.0, 8.0),
                    \duty, rrand(0.05, 0.95),
                    \formantCount, [1, 2, 3].choose,
                    \formant1, rrand(40.0, 1200.0),
                    \formant2, rrand(80.0, 2200.0),
                    \formant3, rrand(120.0, 3000.0),
                    \maskMode, [0, 1, 2].choose,
                    \maskAmount, rrand(0.0, 0.9),
                    \ampJitter, rrand(0.0, 0.7),
                    \timingJitter, rrand(0.0, 0.6),
                    \glisson, rrand(-1.5, 1.5),
                    \drive, rrand(0.8, 2.2),
                    \voiceCount, [1, 2, 3, 4].choose,
                    \chordType, rrand(0, 13),
                    \basePitch, exprand(30.0, 220.0)
                ]);
            });

        Button(w, 120@24)
            .states_([["Reset"]])
            .action_({
                applyParams.([
                    \amp, 0.25, \basePitch, 32.7032, \voiceCount, 1, \chordType, 0,
                    \gateMode, 1, \pulsaret, 2.5, \window, 0.5, \duty, 0.5,
                    \formantCount, 3, \formant1, 20, \formant2, 200, \formant3, 400,
                    \pan1, 0, \pan2, 0.5, \pan3, -0.5,
                    \drive, 1.0, \maskMode, 0, \maskAmount, 0.5,
                    \ampJitter, 0.0, \timingJitter, 0.0, \glisson, 0.0
                ]);
            });

        mkLabelMenu.("Gate Mode", gateItems, 1, \gateMode);
        mkLabelMenu.("Chord Type", chordItems, 0, \chordType);
        mkLabelMenu.("Mask Mode", maskItems, 0, \maskMode);

        mkLabelSlider.("Amplitude", 0.0, 1.0, 0.25, \amp);
        mkLabelSlider.("Base Pitch (Hz)", 20, 1000, 32.7032, \basePitch);
        mkLabelSlider.("Voices", 1, 4, 1, \voiceCount, 1);
        mkLabelSlider.("Pulsaret", 0, 9, 2.5, \pulsaret);
        mkLabelSlider.("Window", 0, 8, 0.5, \window);
        mkLabelSlider.("Duty", 0.01, 1.0, 0.5, \duty);
        mkLabelSlider.("Formants", 1, 3, 3, \formantCount, 1);
        mkLabelSlider.("Formant 1 Hz", 20, 3000, 20, \formant1);
        mkLabelSlider.("Formant 2 Hz", 20, 3000, 200, \formant2);
        mkLabelSlider.("Formant 3 Hz", 20, 3000, 400, \formant3);
        mkLabelSlider.("Drive", 0.1, 4.0, 1.0, \drive);
        mkLabelSlider.("Mask Amount", 0.0, 1.0, 0.5, \maskAmount);
        mkLabelSlider.("Amp Jitter", 0.0, 1.0, 0.0, \ampJitter);
        mkLabelSlider.("Timing Jitter", 0.0, 1.0, 0.0, \timingJitter);
        mkLabelSlider.("Glisson", -2.0, 2.0, 0.0, \glisson);

        w.onClose_({
            // Keep synth running on close; only closes GUI.
        });
    };

    "spaluterSC ready. Start with: ~spaluter = ~spaluterStart.(); then run: ~spaluterGui.();".postln;
};
)

/* Quick recipes

// 4-voice major stack
~spaluter.set(\voiceCount, 4, \chordType, 4, \basePitch, 55);

// Metallic inharmonic texture
~spaluter.set(\pulsaret, 7, \window, 3, \duty, 0.3, \formantCount, 3, \formant1, 200, \formant2, 347, \formant3, 511);

// Particle cloud
~spaluter.set(\pulsaret, 9, \window, 1, \maskMode, 1, \maskAmount, 0.7, \ampJitter, 0.4, \timingJitter, 0.3);

// CV-like gating (mode 2): drive trigIn from another synth/bus if desired
~spaluter.set(\gateMode, 2, \trigIn, 1);
~spaluter.set(\trigIn, 0);

// Open simple GUI
~spaluterGui.();
*/

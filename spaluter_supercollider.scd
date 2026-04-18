/*
Spaluter-style pulsar synth recreation in SuperCollider.

Run this whole file, then use:
  ~spaluter = ~spaluterStart.();
  ~spaluter.set(\voiceCount, 4, \chordType, 4); // Major
  ~spaluter.set(\gateMode, 0, \gate, 1);        // MIDI-like held gate
  ~spaluter.set(\gate, 0);                       // release in gate modes 0/2
  ~spaluter.free;
*/

(
s.waitForBoot {
    var ratioByVoice;

    // 14 chord types, 4 ratios per chord (mirrors Spaluter layout)
    ratioByVoice = [
        [1.0, 1.0, 1.0, 0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0], // v0
        [1.0, 2.0, 1.5, 1.0, 1.259921, 1.189207, 1.259921, 1.189207, 1.334840, 1.259921, 1.189207, 1.259921, 1.498307, 1.498307], // v1
        [1.0, 4.0, 2.0, 2.0, 1.498307, 1.498307, 1.498307, 1.498307, 1.498307, 1.498307, 1.414214, 1.587401, 2.0, 2.0], // v2
        [1.0, 8.0, 3.0, 4.0, 2.0, 2.0, 1.887749, 1.781797, 2.0, 1.781797, 2.0, 2.0, 2.996615, 2.519842]  // v3
    ];

    SynthDef(\spaluterSC, {
        |out=0, amp=0.2, gate=1, trigIn=0,
        gateMode=1, basePitch=32.7032, voiceCount=1, chordType=0,
        pulsaret=2.5, window=0.5, duty=0.5, dutyMode=0,
        formantCount=2, formant1=20, formant2=200, formant3=400, formantTrack=0,
        maskMode=0, maskAmount=0.5, burstOn=4, burstOff=4, perFormantMask=0,
        attackMs=10, releaseMs=200, glideMs=0, drive=1.0,
        pan1=0, pan2=(-0.5), pan3=0.5,
        ampJitter=0, timingJitter=0, glisson=0,
        useSample=0, bufnum=0, sampleRate=1.0,
        scopeEnabled=1, scopeRate=20|

        var atk, rel, glid, vc, fc, mode, ctype, bPitch;
        var fHzArr, panArr, voices, sig;
        var scopeMono, scopeFrames, scopeBuf, scopeWritePos, scopeReadPos, scopeValues, scopeTrig;

        atk = attackMs.max(0.1) * 0.001;
        rel = releaseMs.max(1.0) * 0.001;
        glid = glideMs.max(0.0) * 0.001;
        vc = voiceCount.clip(1, 4);
        fc = formantCount.clip(1, 3);
        mode = gateMode.clip(0, 2);        // 0=MIDI-like gate, 1=Free Run, 2=CV-like gate
        ctype = chordType.clip(0, 13);
        bPitch = basePitch.max(0.1);

        fHzArr = [formant1, formant2, formant3].collect({ |x| x.clip(20, 8000) });
        panArr = [pan1, pan2, pan3].collect({ |x| x.clip(-1, 1) });

        voices = Mix.fill(4, { |vi|
            var vActive, ratio, targetFreq, freq, jitMul, pulseFreq, trig;
            var envASR, envPulse, env, ampJ, pulseCount, formants, vSig;

            vActive = (vc > vi).lag(0.01);
            ratio = Select.kr(ctype, ratioByVoice[vi]);
            targetFreq = bPitch * ratio;
            freq = Lag.kr(targetFreq, glid).max(0.1);

            // Approximate per-pulse timing jitter
            jitMul = 1 + (LFNoise0.kr(freq.max(0.5)) * (0.2 * timingJitter.clip(0, 1)));
            pulseFreq = (freq * jitMul).clip(0.1, 14000);
            trig = Impulse.ar(pulseFreq);

            envASR = LagUD.kr(Select.kr(mode, [gate, 1, (trigIn > 0)]), atk, rel);
            envPulse = EnvGen.ar(Env.perc(atk, rel, 1, curve: -4), trig);
            env = SelectX.ar(mode, [K2A.ar(envASR), envPulse, K2A.ar(envASR)]);

            // Per-pulse amplitude jitter (only attenuates, like original)
            ampJ = 1 - TRand.ar(0, ampJitter.clip(0, 1), trig);
            pulseCount = PulseCount.ar(trig);

            formants = Mix.fill(3, { |fi|
                var fOn, fBase, fTracked, fEff, dutyF, dutyStart, phase, inDuty, tp;
                var ratioF, sweepMul, wphase, x, pulsaretWaves, winWaves;
                var synthWave, sampleWave, src, win, randShared, randForm, rsel;
                var maskStoch, total, burstOffset, idx, maskBurst, maskRaw, maskSm, grain;

                fOn = (fc > fi);
                fBase = fHzArr[fi];
                fTracked = fBase * (freq / bPitch);
                fEff = Select.kr(formantTrack > 0.5, [fBase, fTracked]).clip(20, 12000);

                dutyF = Select.kr(dutyMode > 0.5, [
                    duty.clip(0.01, 1),
                    (freq / fEff).clip(0.01, 1)
                ]);

                phase = (Sweep.ar(trig) * pulseFreq).wrap(0, 1);
                dutyStart = (1 - dutyF) * 0.5;
                inDuty = (phase >= dutyStart) * (phase < (dutyStart + dutyF));
                tp = ((phase - dutyStart) / dutyF.max(0.001)).clip(0, 1);

                ratioF = fEff / freq.max(0.1);
                sweepMul = 2.pow(glisson.clip(-2, 2) * (tp - 0.5));
                wphase = (tp * ratioF * sweepMul).wrap(0, 1);
                x = (wphase * 2pi);

                pulsaretWaves = [
                    x.sin,                                  // sine
                    (x * 2).sin,                            // sine x2
                    (x * 3).sin,                            // sine x3
                    {
                        var sx = (wphase - 0.5) * (8 * pi);
                        Select.ar(sx.abs < 0.0001, [sx.sin / sx, DC.ar(1.0)]); // sinc
                    }.value,
                    (1 - (4 * (wphase - 0.5).abs)).clip(-1, 1),           // triangle
                    (wphase * 2 - 1),                                      // saw
                    Select.ar(wphase < 0.5, [DC.ar(1), DC.ar(-1)]),        // square
                    ((x * 3).sin * ((wphase * 3).neg.exp)),                // formant-ish
                    ((((wphase - 0.5) * 20).squared.neg.exp) * 2 - 1),     // pulse
                    (Hasher.ar(wphase * 1234.567) * 2 - 1)                 // noise
                ];

                synthWave = SelectX.ar(pulsaret.clip(0, 9), pulsaretWaves);
                sampleWave = BufRd.ar(
                    1, bufnum,
                    (wphase * BufFrames.kr(bufnum) * sampleRate).wrap(0, BufFrames.kr(bufnum).max(2) - 1),
                    loop: 1, interpolation: 2
                );
                src = Select.ar(useSample > 0.5, [synthWave, sampleWave]);

                winWaves = [
                    DC.ar(1.0),                                                   // rectangular
                    ((((tp - 0.5) / 0.3).squared * 0.5).neg.exp),                 // gaussian
                    0.5 * (1 - (2pi * tp).cos),                                   // hann
                    ((tp * 4).neg.exp),                                            // exp decay
                    (1 - tp),                                                      // linear decay
                    { // tukey alpha=0.5
                        var a = 0.5;
                        Select.ar(tp < (a * 0.5), [
                            Select.ar(tp > (1 - (a * 0.5)), [
                                DC.ar(1.0),
                                0.5 * (1 - (2pi * (1 - tp) / a).cos)
                            ]),
                            0.5 * (1 - (2pi * tp / a).cos)
                        ])
                    }.value,
                    (0.35875 - (0.48829 * (2pi * tp).cos) + (0.14128 * (4pi * tp).cos) - (0.01168 * (6pi * tp).cos)), // blackman-harris
                    (((1 - tp) * 4).neg.exp),                                      // reverse exp
                    (1 - (2 * (tp - 0.5).abs)).clip(0, 1)                         // triangle
                ];
                win = SelectX.ar(window.clip(0, 8), winWaves);

                randShared = Hasher.ar(pulseCount + (vi * 101));
                randForm = Hasher.ar(pulseCount + (vi * 101) + (fi * 37));
                rsel = Select.ar(perFormantMask > 0.5, [randShared, randForm]);
                maskStoch = (rsel > maskAmount.clip(0, 1));

                total = (burstOn + burstOff).max(1);
                burstOffset = Select.kr(perFormantMask > 0.5, [0, fi * (total / 3)]);
                idx = (pulseCount + burstOffset) % total;
                maskBurst = (idx < burstOn);

                maskRaw = Select.ar(maskMode.clip(0, 2), [DC.ar(1), maskStoch, maskBurst]);
                maskSm = Lag.ar(maskRaw, 0.003);

                grain = src * win * inDuty * maskSm * fOn;
                Pan2.ar(grain, panArr[fi], 1.0)
            });

            vSig = LeakDC.ar(formants / fc.max(1));
            vSig = vSig * env * ampJ * vActive;
            vSig
        });

        sig = voices / vc.max(1);
        sig = tanh(sig * drive.clip(0.1, 4.0));
        scopeMono = Mix(sig) * 0.9;
        scopeFrames = 64;
        scopeBuf = LocalBuf(scopeFrames, 1);
        scopeWritePos = Phasor.ar(0, 1, 0, scopeFrames, 0);
        BufWr.ar(scopeMono, scopeBuf, scopeWritePos, loop: 1);
        scopeReadPos = (scopeWritePos - Array.series(scopeFrames, scopeFrames - 1, -1)).wrap(0, scopeFrames - 1);
        scopeValues = BufRd.ar(1, scopeBuf, scopeReadPos, loop: 1, interpolation: 1);
        scopeTrig = Impulse.kr(scopeRate.clip(1, 60)) * (scopeEnabled > 0);
        SendReply.kr(scopeTrig, "/spaluter/scope", scopeValues);
        Out.ar(out, sig * amp);
    }).add;

    ~spaluterStart = { |out=0|
        Synth(\spaluterSC, [
            \out, out,
            \amp, 0.25,
            \gateMode, 1,
            \voiceCount, 1,
            \chordType, 0,
            \pulsaret, 2.5,
            \window, 0.5,
            \duty, 0.5,
            \formantCount, 2,
            \formant1, 20,
            \formant2, 200,
            \formant3, 400
        ]);
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
                    \formantCount, 2, \formant1, 20, \formant2, 200, \formant3, 400,
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
        mkLabelSlider.("Formants", 1, 3, 2, \formantCount, 1);
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

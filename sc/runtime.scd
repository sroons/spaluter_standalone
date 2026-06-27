/*
runtime.scd

Usage from Electron main process:
  sclang sc/runtime.scd /abs/path/to/spaluter_supercollider.scd

Boots local scsynth, loads patch file, and exposes OSC control:
  /spaluter/start
  /spaluter/stop
  /spaluter/reset
  /spaluter/set  [paramName, value]
  /spaluter/quit
*/

(
    var patchPath, appPort, appAddr, status, startSynth, stopSynth, resetSynth, waitForPatch, waitForSynthDef, silentBuf, booted, loadSample, forwardScope;
    var patchWaitRetries, synthDefWaitRetries, scopeRate, scopeEnabled, applyScopeConfig;
    var modBus, lfoGroup, modClearSynth, lfoSynths, lfoConfigs, lfoCount, maxLfo;
    var modParams, modParamIndex, modDepthCap, setupModulation, spawnLfo, releaseLfo, setLfoCount, applyLfo, rebuildLfos, retriggerLfos, lfoWarn, lfoWarnLast, lfoWarnCount;
    var reverbDefaults, reverbState, reverbParamSet, reverbSynthDef, reverbDefForState, applyReverbState, spawnReverb, setReverbParam, resetReverbParams, updateReverbBypass;
    var setupMidi, midiNoteOn, midiNoteOff, midiNoteToBasePitch, midiSoundingNote, midiVoiceActive, currentGateMode, midiInitialized, midiChannel;

patchPath = ~spaluterPatchPath;
if(patchPath.isNil) {
    patchPath = thisProcess.argv.select({ |a| a.asString.endsWith(".scd") }).last;
};
if(patchPath.isNil or: { PathName.new(patchPath).isFile.not }) {
    "Missing patch path argument".postln;
    1.exit;
};

patchWaitRetries = 120;
synthDefWaitRetries = 160;
scopeRate = (~spaluterScopeRate ? 20).asFloat.clip(1, 60);
scopeEnabled = (~spaluterScopeEnabled ? 1).asInteger > 0;
appPort = (~spaluterAppPort ? 57131).asInteger;
appAddr = NetAddr("127.0.0.1", appPort);

    status = { |txt|
        txt.postln;
        appAddr.sendMsg("/spaluter/status", txt);
    };

    forwardScope = { |vals, start=0|
        var count;
        if(vals.notNil) {
            count = vals.size - start;
            if(count > 0) {
                appAddr.sendMsg("/spaluter/scope", *Array.fill(count, { |i| vals[start + i].asFloat }));
            };
        };
    };

s.options.numInputBusChannels = 0;
s.options.numOutputBusChannels = 2;
// Do not force sampleRate here; let OS/default device choose a valid rate.
s.options.numWireBufs = 4096;
// Larger real-time memory pool so the Clouds-style reverb's delay lines
// allocate cleanly on boot (default 8 MB can be tight alongside the synth's
// scope LocalBufs). 32 MB is ample headroom for the FX delay buffers.
s.options.memSize = 32768;
s.options.bindAddress = "127.0.0.1";
// Pin scsynth to the pisound ALSA device on Linux/Patchbox so it bypasses
// the `plug` conversion layer in /etc/asound.conf. Only applied on Linux
// — setting an unknown device name on macOS/Windows would prevent boot.
if(thisProcess.platform.name == \linux) {
    s.options.device = "pisound";
};

thisProcess.openUDPPort(57130);
status.value("Listening OSC on 57130");
booted = false;

s.doWhenBooted({
    booted = true;
    status.value("Server booted");
    silentBuf = Buffer.alloc(s, 64, 1);
    s.sync;
    this.executeFile(patchPath);
    status.value("Patch executed");

    waitForPatch = { |onReady, retries = 60|
        if(~spaluterStart.notNil) {
            onReady.value;
        } {
            if(retries <= 0) {
                status.value("Patch did not expose ~spaluterStart");
            } {
                AppClock.sched(0.1, { waitForPatch.value(onReady, retries - 1); nil });
            };
        };
    };

    waitForSynthDef = { |onReady, name = \spaluterSC, retries|
        var desc;
        retries = retries ? synthDefWaitRetries;
        desc = SynthDescLib.global.at(name);
        if(desc.notNil and: { desc.def.notNil }) {
            onReady.value;
        } {
            if(retries <= 0) {
                status.value("SynthDef not found: " ++ name.asString);
            } {
                AppClock.sched(0.1, { waitForSynthDef.value(onReady, name, retries - 1); nil });
            };
        };
    };

    applyScopeConfig = {
        if(~spaluter.notNil) {
            ~spaluter.set(
                \scopeEnabled, if(scopeEnabled) { 1 } { 0 },
                \scopeRate, scopeRate
            );
        };
    };

    // ----- Internal LFO modulation -----
    // Canonical order of modulatable params; index = channel on the mod bus.
    // MUST match the mod[] indices applied in the \spaluterSC SynthDef.
    maxLfo = 32;
    modParams = [
        \amp, \drive, \pulsaret, \window, \duty,
        \formant1, \formant2, \formant3, \maskAmount,
        \pan1, \pan2, \pan3,
        \ampJitter, \timingJitter, \glisson, \basePitch
    ];
    modParamIndex = IdentityDictionary.new;
    modParams.do { |name, i| modParamIndex[name] = i };
    // Per-param depth caps (native units) to avoid clip-slamming bounded params.
    modDepthCap = IdentityDictionary.newFrom([
        \amp, 0.5, \drive, 0.5, \pulsaret, 2.0, \window, 0.5, \duty, 0.5,
        \formant1, 1000, \formant2, 1000, \formant3, 1000, \maskAmount, 0.5,
        \pan1, 1.0, \pan2, 1.0, \pan3, 1.0,
        \ampJitter, 0.5, \timingJitter, 0.5, \glisson, 0.5, \basePitch, 12
    ]);
    lfoConfigs = Array.fill(maxLfo, {
        (target: \none, rate: 1.0, depth: 0.0, shape: 0, enabled: 0, phase: 0.0)
    });
    lfoSynths = Array.fill(maxLfo, { nil });
    lfoCount = 0;
    lfoWarnLast = 0;
    lfoWarnCount = 0;

    // MIDI note state (sclang-owned). currentGateMode mirrors the synth's
    // \gateMode so note-on can replicate the renderer's gateMode==0 LFO
    // retrigger. midiSoundingNote/midiVoiceActive track last-note priority and
    // the binary gate so legato notes only retune (no re-gate), matching the
    // renderer's dedup behavior exactly.
    currentGateMode = 1;
    midiSoundingNote = nil;
    midiVoiceActive = false;
    midiInitialized = false;
    midiChannel = 0;

    lfoWarn = { |txt|
        var now = SystemClock.seconds;
        lfoWarnCount = lfoWarnCount + 1;
        if((now - lfoWarnLast) > 1.0) {
            lfoWarnLast = now;
            status.value("[LFO] " ++ txt.asString);
        };
    };

    // Lazily allocate the mod bus + LFO group (idempotent across synth
    // restarts). The group holds \modClear (head) then the LFO synths; the
    // main synth is created \addAfter this group so it reads summed mod values.
    setupModulation = {
        if(modBus.isNil) { modBus = Bus.control(s, 16); };
        if(lfoGroup.isNil) {
            lfoGroup = Group.new(s);
            modClearSynth = Synth(\modClear, [\modBus, modBus.index], lfoGroup, \addToHead);
            rebuildLfos.value;
        };
    };

    releaseLfo = { |idx|
        var old = lfoSynths[idx];
        if(old.notNil) {
            // ramp the LFO to 0 (its internal Lag) then free, avoiding a click.
            old.set(\enabled, 0);
            AppClock.sched(0.12, { old.free; nil });
            lfoSynths[idx] = nil;
        };
    };

    // Free + respawn LFO synth `idx` from its stored config. Retarget/param
    // changes route through here (cheap, human-rate).
    spawnLfo = { |idx|
        var cfg, tIdx;
        releaseLfo.value(idx);
        cfg = lfoConfigs[idx];
        tIdx = modParamIndex[cfg[\target]];
        if(lfoGroup.notNil
            and: { idx < lfoCount }
            and: { tIdx.notNil }
            and: { cfg[\enabled] > 0 }) {
            lfoSynths[idx] = Synth(\spaluterLfo, [
                \modBus, modBus.index,
                \targetIdx, tIdx,
                \rate, cfg[\rate],
                \depth, cfg[\depth],
                \shape, cfg[\shape],
                \phase, cfg[\phase],
                \enabled, 1
            ], lfoGroup, \addToTail);
        };
    };

    rebuildLfos = {
        lfoCount.do { |i| spawnLfo.value(i) };
    };

    // Recreate active LFO synths so their phase restarts from each config's
    // stored phase offset (used for MIDI-note-driven retrigger behavior).
    retriggerLfos = {
        lfoCount.do { |i| spawnLfo.value(i) };
    };

    setLfoCount = { |n|
        var oldCount, newCount;
        oldCount = lfoCount;
        newCount = n.asInteger.clip(0, maxLfo);
        if(newCount < oldCount) {
            (newCount .. (oldCount - 1)).do { |i| releaseLfo.value(i) };
        };
        lfoCount = newCount;
        if(newCount > oldCount) {
            (oldCount .. (newCount - 1)).do { |i| spawnLfo.value(i) };
        };
    };

    // Validate + clamp one LFO config, store it, and respawn that LFO.
    applyLfo = { |idx, name, rate, depth, shape, enabled, phase|
        var i, tgt, cap, en, cfg;
        i = idx.asInteger;
        if((i < 0) or: { i >= maxLfo }) {
            lfoWarn.value("idx out of range: " ++ idx.asString);
        } {
            tgt = name.asSymbol;
            en = enabled.asInteger.clip(0, 1);
            // \none is a legitimate "unrouted" state (every idle LFO uses it);
            // disable silently without flagging it as an invalid target.
            if(tgt == \none) {
                en = 0;
            } {
                if(modParamIndex[tgt].isNil) {
                    lfoWarn.value("invalid target: " ++ name.asString);
                    tgt = \none; en = 0;
                };
            };
            cap = (modDepthCap[tgt] ? 1).asFloat;
            cfg = lfoConfigs[i];
            cfg[\target] = tgt;
            cfg[\rate] = rate.asFloat.clip(0.001, 50);
            cfg[\depth] = depth.asFloat.clip(cap.neg, cap);
            cfg[\shape] = shape.asInteger.clip(0, 6);
            cfg[\enabled] = en;
            cfg[\phase] = phase.asFloat.wrap(0, 1);
            spawnLfo.value(i);
        };
    };

    // ----- Clouds-style reverb -----
    // Reverb params live on the separate \spaluterReverb synth (not ~spaluter).
    // reverbState mirrors the current values so they survive synth restarts, and
    // is applied whenever the reverb synth is (re)spawned in startSynth.
    reverbDefaults = (
        revWet: 0.0, revTime: 0.6, revDamp: 0.5, revDiff: 0.7,
        revMod: 0.3, revShimmer: 0.0, revPreDelay: 0.0, revLowCut: 20.0
    );
    reverbState = IdentityDictionary.new;
    reverbDefaults.keysValuesDo { |k, v| reverbState[k] = v.asFloat };
    reverbParamSet = IdentitySet.newFrom(reverbDefaults.keys);
    reverbSynthDef = nil;

    reverbDefForState = {
        if(((reverbState[\revShimmer] ? 0).asFloat) > 0) { \spaluterReverb } { \spaluterReverbNoShim };
    };

    applyReverbState = {
        if(~spaluterReverb.notNil) {
            reverbState.keysValuesDo { |k, v|
                if((reverbSynthDef == \spaluterReverb) or: { k != \revShimmer }) {
                    ~spaluterReverb.set(k, v);
                };
            };
        };
    };

    // CPU bypass: when fully dry, pause the reverb synth so its delay network
    // stops costing DSP. Paused => no ReplaceOut, so \spaluterSC's dry output
    // passes straight through. Resume as soon as any wet is dialed in.
    updateReverbBypass = {
        if(~spaluterReverb.notNil) {
            ~spaluterReverb.run((reverbState[\revWet] ? 0) > 0.0001);
        };
    };

    spawnReverb = {
        var defName;
        if(~spaluter.notNil) {
            defName = reverbDefForState.value;
            if(~spaluterReverb.notNil) {
                ~spaluterReverb.free;
                ~spaluterReverb = nil;
            };
            ~spaluterReverb = Synth(defName, [\out, 0], ~spaluter, \addAfter);
            reverbSynthDef = defName;
            applyReverbState.value;
            updateReverbBypass.value;
        };
    };

    setReverbParam = { |key, value|
        var k = key.asSymbol, v = value.asFloat, nextDef;
        reverbState[k] = v;
        if(k == \revShimmer) {
            nextDef = reverbDefForState.value;
            if(~spaluterReverb.notNil and: { reverbSynthDef != nextDef }) {
                spawnReverb.value;
            } {
                if(~spaluterReverb.notNil and: { reverbSynthDef == \spaluterReverb }) {
                    ~spaluterReverb.set(k, v);
                };
            };
        } {
            if(~spaluterReverb.notNil) { ~spaluterReverb.set(k, v); };
            if(k == \revWet) { updateReverbBypass.value; };
        };
    };

    resetReverbParams = {
        reverbDefaults.keysValuesDo { |k, v| reverbState[k] = v.asFloat };
        if(~spaluterReverb.notNil and: { reverbSynthDef != reverbDefForState.value }) {
            spawnReverb.value;
        } {
            applyReverbState.value;
            updateReverbBypass.value;
        };
    };

    // ----- sclang-owned MIDI note input -----
    // Notes are handled here on the language thread instead of the Electron
    // renderer, so note timing is immune to UI load (view switches, repaint
    // bursts). This mirrors the renderer's note->param mapping exactly:
    //   * basePitch = round(noteHz) clipped to the control's 20..1000 Hz range
    //   * binary gate/trigIn, only toggled on the 0<->1 voice transitions
    //     (legato notes just retune, matching the renderer's value dedup)
    //   * LFO retrigger on each note-on while gateMode == 0
    //   * note-off only silences when the released note is the sounding one
    //   * only MIDI channel 1 (zero-based 0) is accepted
    // CC and MIDI clock stay in the renderer (not timing-critical; the existing
    // coalescing handles them with zero OSC backpressure).
    midiNoteToBasePitch = { |note|
        var hz = 440.0 * (2 ** ((note.clip(0, 127) - 69) / 12.0));
        hz.round(1.0).clip(20.0, 1000.0);
    };

    midiNoteOn = { |veloc, note, chan|
        var bp;
        if(chan == midiChannel) {
            if(veloc <= 0) {
                midiNoteOff.value(0, note, chan);
            } {
                // Ignore a duplicate note-on for the note that is already
                // sounding (the hardware sources are wired to SuperCollider via
                // multiple ALSA connections, which can deliver each note more
                // than once). A different note still retunes the voice (legato).
                if(midiVoiceActive.not or: { midiSoundingNote != note }) {
                    bp = midiNoteToBasePitch.value(note);
                    midiSoundingNote = note;
                    if(~spaluter.notNil) {
                        if(midiVoiceActive) {
                            ~spaluter.set(\basePitch, bp);
                        } {
                            ~spaluter.set(\basePitch, bp, \gate, 1, \trigIn, 1);
                            midiVoiceActive = true;
                        };
                    };
                    if(currentGateMode == 0) { retriggerLfos.value; };
                };
            };
        };
    };

    midiNoteOff = { |veloc, note, chan|
        if(chan == midiChannel) {
            if(midiSoundingNote == note) {
                midiSoundingNote = nil;
                if(~spaluter.notNil and: { midiVoiceActive }) {
                    ~spaluter.set(\gate, 0, \trigIn, 0);
                    midiVoiceActive = false;
                };
            };
        };
    };

    setupMidi = {
        if(midiInitialized.not) {
            try {
                MIDIClient.init;
                MIDIdef.noteOn(\spaluterMidiNoteOn, { |veloc, num, chan| midiNoteOn.value(veloc, num, chan) });
                MIDIdef.noteOff(\spaluterMidiNoteOff, { |veloc, num, chan| midiNoteOff.value(veloc, num, chan) });
                midiInitialized = true;
                // NOTE: MIDIIn.connectAll hangs the sclang interpreter on this
                // Pi's ALSA sequencer graph, which would block runtime startup
                // (the synth never starts -> "ERROR. Check Log."). The system
                // sequencer (aconnect) performs the same wiring without hanging,
                // so connect the hardware note sources to SuperCollider's input
                // port here instead. .unixCmd is non-blocking and the MIDIdefs
                // above receive notes once the connection is live. stderr is
                // discarded because the pisound amidiauto daemon usually wires
                // these already (aconnect then prints a benign "already
                // subscribed", which would otherwise trip the UI error banner).
                ["Grid", "pisound"].do { |dev|
                    ("aconnect " ++ dev.quote ++ " " ++ "SuperCollider".quote ++ " 2>/dev/null").unixCmd;
                };
                status.value("MIDI input ready (sclang-owned notes)");
            } { |err|
                status.value("MIDI init failed: " ++ err.errorString);
            };
        };
    };

    startSynth = {
        waitForPatch.value({
            waitForSynthDef.value({
                {
                    if(~spaluter.notNil) { ~spaluter.free; };
                    if(~spaluterReverb.notNil) { ~spaluterReverb.free; ~spaluterReverb = nil; reverbSynthDef = nil; };
                    setupModulation.value;
                    ~spaluter = ~spaluterStart.(0, modBus.index, lfoGroup, \addAfter);
                    // Fresh synth starts in gateMode 1 (Free Run), gate 0; reset
                    // sclang-owned MIDI voice state so a stale held note can't
                    // leave the gate latched on the new synth.
                    currentGateMode = 1;
                    midiSoundingNote = nil;
                    midiVoiceActive = false;
                    if(~spaluter.notNil and: { silentBuf.notNil }) {
                        ~spaluter.set(\bufnum, silentBuf.bufnum);
                        applyScopeConfig.value;
                    };
                    // Reverb taps bus 0 after the synth and writes the wet/dry
                    // blend back with ReplaceOut, so it must run \addAfter ~spaluter.
                    if(~spaluter.notNil) {
                        spawnReverb.value;
                    };
                    if(~spaluter.notNil) {
                        status.value("Synth started");
                    } {
                        status.value("~spaluterStart returned nil");
                    };
                }.defer;
            }, \spaluterSC);
        }, patchWaitRetries);
    };

    stopSynth = {
        {
            if(~spaluterReverb.notNil) {
                ~spaluterReverb.free;
                ~spaluterReverb = nil;
                reverbSynthDef = nil;
            };
            if(~spaluter.notNil) {
                ~spaluter.free;
                ~spaluter = nil;
            };
            midiSoundingNote = nil;
            midiVoiceActive = false;
            forwardScope.value(Array.fill(128, 0.0));
            status.value("Synth stopped");
        }.defer;
    };

    resetSynth = {
        {
            if(~spaluter.notNil) {
                ~spaluter.set(
                    \amp, 0.25, \basePitch, 32.7032, \voiceCount, 1, \chordType, 0,
                    \gateMode, 1, \pulsaret, 2.5, \window, 0.5, \duty, 0.5,
                    \formantCount, 3, \formant1, 20, \formant2, 200, \formant3, 400,
                    \pan1, 0, \pan2, 0.5, \pan3, -0.5,
                    \drive, 1.0, \maskMode, 0, \maskAmount, 0.5,
                    \ampJitter, 0.0, \timingJitter, 0.0, \glisson, 0.0
                );
            };
            resetReverbParams.value;
            currentGateMode = 1;
            status.value("Patch reset");
        }.defer;
    };

    loadSample = { |filePath|
        {
            var pn = PathName.new(filePath.asString);
            if(pn.isFile.not) {
                status.value("Sample file not found: " ++ filePath.asString);
            } {
                if(~spaluterSampleBuf.notNil) {
                    ~spaluterSampleBuf.free;
                    ~spaluterSampleBuf = nil;
                };
                ~spaluterSampleBuf = Buffer.readChannel(s, filePath.asString, channels: [0], action: {
                    if(~spaluter.notNil) {
                        ~spaluter.set(\bufnum, ~spaluterSampleBuf.bufnum, \useSample, 1);
                    };
                    status.value("Sample loaded: " ++ pn.fileName.asString);
                });
            };
        }.defer;
    };

    OSCdef(\spaluterStart, { |msg|
        startSynth.value;
    }, "/spaluter/start");

    OSCdef(\spaluterStop, { |msg|
        stopSynth.value;
    }, "/spaluter/stop");

    OSCdef(\spaluterReset, { |msg|
        resetSynth.value;
    }, "/spaluter/reset");

    OSCdef(\spaluterSet, { |msg|
        var key, value;
        key = msg[1];
        value = msg[2];
        // Phase 3a: no .defer — calling ~spaluter.set just emits /n_set to
        // scsynth and is thread-safe. Deferring onto AppClock added ~one
        // language-frame of latency per CC and frame-quantized the response.
        if(key.notNil) {
            var sym = key.asSymbol;
            // Mirror gateMode locally so sclang-owned note-on can decide whether
            // to retrigger LFOs (renderer only retriggers in gateMode 0).
            if(sym == \gateMode) { currentGateMode = value.asInteger; };
            // Reverb params target the separate \spaluterReverb synth; everything
            // else goes to the main synth.
            if(reverbParamSet.includes(sym)) {
                setReverbParam.value(sym, value);
            } {
                if(~spaluter.notNil) {
                    ~spaluter.set(sym, value.asFloat);
                };
            };
        };
    }, "/spaluter/set");

    OSCdef(\spaluterLfoCount, { |msg|
        setLfoCount.value(msg[1] ? 0);
    }, "/spaluter/lfo/count");

    OSCdef(\spaluterLfoSet, { |msg|
        // [idx, targetName, rate, depth, shape, enabled, phase]
        applyLfo.value(msg[1], msg[2], msg[3], msg[4], msg[5], msg[6], msg[7]);
    }, "/spaluter/lfo/set");

    OSCdef(\spaluterLfoSetMany, { |msg|
        // 7 args per LFO entry, packed after the address.
        var entries = (msg.size - 1) div: 7;
        entries.do { |k|
            var b = 1 + (k * 7);
            applyLfo.value(msg[b], msg[b+1], msg[b+2], msg[b+3], msg[b+4], msg[b+5], msg[b+6]);
        };
    }, "/spaluter/lfo/set-many");

    OSCdef(\spaluterLfoRetrigger, { |msg|
        retriggerLfos.value;
    }, "/spaluter/lfo/retrigger");

    OSCdef(\spaluterLoadSample, { |msg|
        var filePath;
        filePath = msg[1];
        if(filePath.notNil) {
            loadSample.value(filePath.asString);
        } {
            status.value("Sample load failed: missing file path");
        };
    }, "/spaluter/load-sample");

    OSCdef(\spaluterScopeDirect, { |msg|
        // SendReply prepends [nodeID, replyID] to the args, so the actual
        // scope sample floats start at msg[3]. Forwarding msg[1..] (the old
        // behaviour) leaked the nodeID/replyID into the renderer as if they
        // were the first two L-channel samples, which made the L peak meter
        // peg at full scale and made the L trace look much hotter than R.
        if(msg.size > 3) {
            forwardScope.value(msg, 3);
        };
    }, "/spaluter/scope");

    OSCdef(\spaluterScopeReply, { |msg|
        // Stable /reply fallback layout: ["/reply", cmdName, nodeID, replyID, samples...].
        if(msg.size > 4 and: { msg[1].notNil and: { msg[1].asString == "/spaluter/scope" } }) {
            forwardScope.value(msg, 4);
        };
    }, "/reply");

    OSCdef(\spaluterScopeConfig, { |msg|
        var enabled, rate;
        enabled = msg[1];
        rate = msg[2];
        scopeEnabled = enabled.asInteger > 0;
        if(rate.notNil) {
            scopeRate = rate.asFloat.clip(1, 60);
        };
        {
            applyScopeConfig.value;
            status.value("Scope stream " ++ (if(scopeEnabled) { "enabled" } { "disabled" }) ++ " @" ++ scopeRate.asString ++ " Hz");
        }.defer;
    }, "/spaluter/scope-config");

    OSCdef(\spaluterQuit, { |msg|
        {
            stopSynth.value;
            status.value("Quitting runtime");
            s.quit;
            0.exit;
        }.defer(0.1);
    }, "/spaluter/quit");

    setupMidi.value;
    status.value("Runtime ready");
});

s.waitForBoot({
    status.value("Waiting for server boot...");
});

AppClock.sched(8.0, {
    if(booted.not) {
        status.value("Server boot failed (audio device/sample-rate mismatch likely)");
    };
    nil
});
)

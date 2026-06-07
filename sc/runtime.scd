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
    var modBus, lfoGroup, modClearSynth, lfoSynths, lfoConfigs, lfoCount, modEnabledState, maxLfo;
    var modParams, modParamIndex, modDepthCap, setupModulation, spawnLfo, releaseLfo, setLfoCount, applyLfo, rebuildLfos, lfoWarn, lfoWarnLast, lfoWarnCount;

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

    forwardScope = { |vals|
        if(vals.notNil and: { vals.size > 0 }) {
            appAddr.sendMsg("/spaluter/scope", *vals.collect({ |v| v.asFloat }));
        };
    };

s.options.numInputBusChannels = 0;
s.options.numOutputBusChannels = 2;
// Do not force sampleRate here; let OS/default device choose a valid rate.
s.options.numWireBufs = 4096;
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
    modEnabledState = 0;
    lfoWarnLast = 0;
    lfoWarnCount = 0;

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
            if(modParamIndex[tgt].isNil) {
                lfoWarn.value("invalid target: " ++ name.asString);
                tgt = \none; en = 0;
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

    startSynth = {
        waitForPatch.value({
            waitForSynthDef.value({
                {
                    if(~spaluter.notNil) { ~spaluter.free; };
                    setupModulation.value;
                    ~spaluter = ~spaluterStart.(0, modBus.index, lfoGroup, \addAfter);
                    if(~spaluter.notNil) {
                        ~spaluter.set(\modEnabled, modEnabledState);
                    };
                    if(~spaluter.notNil and: { silentBuf.notNil }) {
                        ~spaluter.set(\bufnum, silentBuf.bufnum);
                        applyScopeConfig.value;
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
            if(~spaluter.notNil) {
                ~spaluter.free;
                ~spaluter = nil;
            };
            forwardScope.value(Array.fill(256, 0.0));
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
        if(~spaluter.notNil and: { key.notNil }) {
            ~spaluter.set(key.asSymbol, value.asFloat);
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

    OSCdef(\spaluterLfoEnable, { |msg|
        modEnabledState = (msg[1] ? 0).asInteger.clip(0, 1);
        if(~spaluter.notNil) { ~spaluter.set(\modEnabled, modEnabledState); };
        status.value("Modulation " ++ (if(modEnabledState > 0) { "enabled" } { "disabled" }));
    }, "/spaluter/lfo/enable");

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
            forwardScope.value(msg.copyRange(3, msg.size - 1));
        };
    }, "/spaluter/scope");

    OSCdef(\spaluterScopeReply, { |msg|
        var cmdIdx;
        cmdIdx = msg.detectIndex({ |item|
            item.notNil and: { item.asString == "/spaluter/scope" }
        });
        // Same SendReply offset: skip nodeID + replyID after the cmdName.
        if(cmdIdx.notNil and: { msg.size > (cmdIdx + 3) }) {
            forwardScope.value(msg.copyRange(cmdIdx + 3, msg.size - 1));
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

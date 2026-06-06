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

    startSynth = {
        waitForPatch.value({
            waitForSynthDef.value({
                {
                    if(~spaluter.notNil) { ~spaluter.free; };
                    ~spaluter = ~spaluterStart.();
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
                    \formantCount, 2, \formant1, 20, \formant2, 200, \formant3, 400,
                    \pan1, 0, \pan2, 0, \pan3, 0,
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

# MIDI Optimization Review — Spaluter Desktop

Scope: every code path that touches MIDI in this repo, the OS-level pipeline
underneath it on PatchboxOS + Pisound + Pi 4, and what to change to stop the
queue backup that eventually crashes the system. Nothing in this document has
been applied — it is a proposal only.

The user's constraint: **do not sacrifice resolution of the incoming MIDI
stream**. I take that to mean every byte from the USB controller must be
*captured*, and Note On/Off must never be dropped or reordered. CC streams
can safely be **coalesced for delivery to UI and synth** (latest-value-wins
within a small window) without changing what the user hears or sees — the
ear and the eye both cap out far below the rate a fader generates events,
and SuperCollider is going to interpolate at control-rate anyway.

---

## 1. Where MIDI lives today

| Layer | File | What it does |
|---|---|---|
| USB driver | kernel `snd-usb-audio` / `snd-usbmidi` | Receives bytes from the Intech Grid (`303a:8123`), exposes `hw:Grid MIDI 1` and ALSA seq client 28. |
| ALSA seq | kernel | Buffers and routes MIDI events between clients. |
| Chromium MIDI service | Electron renderer process | Pulls from ALSA seq into the Blink MIDI bridge, then dispatches `MIDIMessageEvent` to JS on the **renderer main thread**. |
| App ingest | `renderer/renderer.js` `handleMidiMessage` (line 1358) | Decodes status byte, branches CC vs Note. |
| Param fan-out | `setParamValue` (line 1447) | Normalises, updates DOM (knob/range/select/labels), conditionally redraws several `<canvas>` waveforms, calls `updateRealtimeParamValue`, then sends to SC. |
| IPC | `window.spaluterApi.setParam` (preload.js line 4) | `ipcRenderer.invoke("sc:set-param", { key, value })` — a *promise-returning* round trip. |
| OSC | `main.js` `sendOsc` (line 370) → `osc.UDPPort.send` | One UDP datagram per call to `127.0.0.1:57130`. |
| sclang | `sc/runtime.scd` `OSCdef(\spaluterSet)` (line 178) | `.defer` onto AppClock, then `~spaluter.set(key, value)` which emits `/n_set` to scsynth. |

Two more hot-path facts:
- For every **Note On/Off**, `updateGateFromMidiNotes()` (line 1222) sends **two** IPC invokes (`gate` and `trigIn`).
- For 14 specific param symbols (`pulsaret`, `window`, `duty`, `dutyMode`,
  `formantCount`, `formantTrack`, `formant1..3`, `maskMode`, `perFormantMask`,
  `maskAmount`, `burstOn`, `burstOff`) `setParamValue` calls
  `updateWaveformViews()` **synchronously** on every event — that function
  re-samples and re-draws several canvases.
- `sc/runtime.scd:178` defers every `/spaluter/set` onto AppClock (a single
  serialized timer thread in sclang). Burst CCs queue up here.

---

## 2. Why it crashes

The chain that produces the runaway:

1. User moves multiple Grid faders at once. Grid sends ~1–2 kB/sec of CCs per
   active control, easily 200–800 events/sec aggregate.
2. Every event reaches the renderer main thread, which is also the **UI
   rendering thread, the canvas drawing thread, the IPC sender thread, and
   the requestAnimationFrame thread**.
3. Each event runs `updateWaveformViews()` (if it touches one of those 14
   params), which is the single most expensive thing in the JS code — it
   draws multiple canvases per call. On a Pi 4 this is tens of milliseconds.
4. While the main thread is busy drawing, Chromium's MIDI dispatcher keeps
   queuing `MIDIMessageEvent`s. The internal task queue grows.
5. Each `ipcRenderer.invoke` allocates a Promise + reply registration. They
   pile up on the Electron IPC bus to the main process.
6. The main process drains them and fires UDP packets at sclang. sclang
   `.defer`s each onto AppClock. AppClock serialises through one thread, so
   bursts queue there too. Memory grows on both sides.
7. Eventually one of: Electron's renderer hits memory pressure and is killed;
   scsynth gets an xrun and the audio thread reports `late` repeatedly;
   sclang AppClock starves and the runtime "ready" pings stop, so the
   watchdog in `main.js` (`STARTUP_WAIT_TIMEOUT_MS`) and renderer heartbeat
   (`RENDERER_HEARTBEAT_MS = 1000`) trip. Whatever fails first cascades.

The **root cause** is that the MIDI hot path is glued to the slowest, most
contended thread in the app (the renderer main thread) and is forced to do
visual work synchronously per event. The IPC layer then amplifies the cost
of each event by adding a promise round-trip.

---

## 3. Proposed fixes

The fixes split into three groups: **(A) code changes that don't change the
architecture**, **(B) architectural moves that put MIDI on its own thread /
process**, and **(C) system / OS configuration**. They are listed in
recommended order — early items are cheap and high-value, later items are
bigger commitments. Apply A first, measure, then decide whether B is needed.

### 3A. Tactical code changes (small, high impact)

#### A1. Coalesce CCs per animation frame
Maintain `pendingCcValues: Map<param, value>` in the renderer. `onmidimessage`
writes the latest value for each CC into the map (overwriting). A
`requestAnimationFrame` callback drains the map once per frame and applies
each value via `setParamValue`. This preserves the **latest value for every
moved parameter** (no resolution loss audibly or visually) and caps update
work at ~60 Hz regardless of fader rate.

> Critical: this only applies to **CC**. Notes go through a separate path
> with no coalescing — they are processed immediately and in order.

#### A2. Make `updateWaveformViews()` dirty-flag + rAF-scheduled
Instead of calling it synchronously inside `setParamValue`, set a
`waveformViewsDirty = true` flag and schedule a rAF that calls
`updateWaveformViews()` at most once per frame. Today a single fader sweep
that touches `formant1` produces hundreds of full canvas redraws per second.

#### A3. Switch fire-and-forget IPC from `invoke` to `send`
`spaluterApi.setParam` uses `ipcRenderer.invoke`, which creates a
correlation Promise the renderer never reads. Replace with `ipcRenderer.send`
(one-way). Add a new `spaluterApi.setParamMany(entries)` channel that takes
an array `[[key, value], …]` and emits one OSC bundle. The current
`invoke` semantics should only be kept for things that actually need a reply
(`listSamples`, `getInitialState`).

#### A4. OSC bundling on the main process
Add `sendOscBundle(messages)` in `main.js` that uses `osc.UDPPort.send({
timeTag: osc.timeTag(0), packets: [...] })` to ship a single datagram per
frame containing every accumulated `/spaluter/set`. On the SC side, OSC
bundles are dispatched atomically by scsynth in a single audio block, which
also fixes a subtle issue: today, if a user moves three knobs that
collectively define a coherent timbre, they hit the synth one block apart,
producing audible micro-zipper artefacts. Bundles eliminate that.

#### A5. Combine `gate` and `trigIn` into one message
`updateGateFromMidiNotes()` sends two IPC invokes per note event. Either
collapse to a single `/spaluter/note` OSC verb that scsynth handles, or
bundle them as in A4. Two-for-one for free.

#### A6. Drop no-op param updates
In `setParamValue`, if `normalizeParamValue` returns the same value as
`currentParamValue(param)`, return early before touching DOM / IPC. CCs at
rest emit identical 7-bit values for long stretches; you can drop a large
share of the work for free.

#### A7. Skip the unused `valueFromMidiCc` allocation for unmapped CCs
The check `if (!Array.isArray(mappedParams) || mappedParams.length === 0)
return` already short-circuits unmapped CCs (good). But the `data1 = Number(data[1])`
and friends in `handleMidiMessage` allocate on every event including
unmapped ones. Use `data[0] | 0`, `data[1] | 0`, `data[2] | 0` (or read
directly from the Uint8Array) to avoid the `Number()` slow path.

#### A8. Tighten sclang's set handler
`sc/runtime.scd:178` does `.defer` on every event. On AppClock that
serialises through one timer. Drop the `.defer` — `~spaluter.set` is
thread-safe (it just sends an OSC message to scsynth from the language
thread). The defer was probably defensive copy-pasta. Also add a
`/spaluter/set-many` handler that accepts pairs and issues one `~spaluter.set(*args)`
to match A4 above.

> Estimated combined impact of A1–A8: an order of magnitude reduction in
> main-thread work per CC event, with no perceptual change. This alone is
> very likely to eliminate the queue backup on the current architecture.

---

### 3B. Architectural moves (medium / large)

These are warranted if A1–A8 are not enough. Each is independently useful.

#### B1. Move MIDI ingest to the Electron main process via native ALSA
Web MIDI in Chromium hands the renderer a serialised event stream on the
renderer main thread. There is no way to put `onmidimessage` on a worker
thread — `navigator.requestMIDIAccess` is not exposed in `Worker` or
`AudioWorkletGlobalScope`.

The cleanest workaround is to **open the MIDI device in the main process**
with a Node native module:

- `@julusian/midi` (maintained fork of `node-midi`) — uses ALSA RawMIDI / Seq
  on Linux, opens its own thread via the underlying RtMidi lib, and emits
  events on libuv from a separate kernel thread.
- `easymidi` is a thin wrapper around `@julusian/midi` if you prefer a
  parsed-event API.

Architecture:

```
Grid (USB)
  └─► ALSA seq
        └─► Node main process (worker_threads + @julusian/midi)
              ├─► coalesce, parse
              ├─► fire-and-forget OSC bundle to scsynth (already lives here)
              └─► postMessage to renderer at 60 Hz with latest-value snapshot
                    └─► renderer updates DOM + canvases
```

The renderer is taken out of the audio-critical path entirely. It sees only
coalesced UI snapshots. The hot path becomes:

```
ALSA → worker_thread → UDP → scsynth
```

…which is the shortest path you can get on this hardware short of B3.

#### B2. SharedArrayBuffer ring buffer (only if you stay on Web MIDI)
If you do not want a native module, keep `onmidimessage` on the main thread
but **only** push 3 bytes per event into a lock-free SAB ring buffer. A
dedicated `Worker` drains the ring and posts coalesced snapshots back to the
main thread at rAF cadence. This keeps the per-event main-thread cost to a
single typed-array store, defers parsing/decoding off the main thread, and
keeps Note timing exact (the ring buffer preserves order). Cost: requires
COOP/COEP headers in the Electron BrowserWindow (`crossOriginIsolated`) for
SAB to be enabled.

> B2 is strictly worse than B1 because the kernel→userspace dispatch still
> goes through the Chromium MIDI service on the main thread. Use B1 unless
> you have a hard reason not to ship a native module.

#### B3. Let SuperCollider talk to MIDI directly
The lowest-overhead option on a Pi is to **remove the entire JS layer from
the MIDI hot path**. sclang has first-class MIDI support via
`MIDIClient.init` + `MIDIIn.connectAll` + `MIDIFunc.cc / MIDIFunc.noteOn`.
Inside `sc/runtime.scd`:

```supercollider
MIDIClient.init;
MIDIIn.connectAll;
MIDIFunc.cc({ |val, num| ~spaluter.set( ccMap[num], val.linlin(0,127,...) ) });
MIDIFunc.noteOn({ |val, num| /* note logic */ });
```

sclang's MIDI dispatcher runs on the language thread (separate from
AppClock) and turns each event into one `n_set` to the server with no IPC,
no UDP loopback, no Electron round-trip. The renderer is only informed of
parameter changes for display, at a coalesced rate.

Trade-off: the CC→param mapping currently lives in JS (`midiMappings`,
`PREFERRED_MIDI_CC_BY_PARAM`, `valueFromMidiCc`). You'd either need to
mirror it into sclang on every mapping change (cheap — only happens when the
user edits a mapping), or keep mapping in JS and forward only the resolved
`(param, value)` from JS to sclang. The former is the right answer for
performance; the JS side becomes a config publisher rather than an event
forwarder.

This is the **most surgical, highest-performance** option for steady-state
operation. B1 and B3 are complementary: B3 owns the live event stream, B1
isn't needed if B3 ships.

#### B4. Use control-rate buses for the very-hot params
Inside the SynthDef, replace selected `\param` controls with reads from
control-rate buses (`In.kr(bus)`). Then `MIDIFunc.cc` writes the bus
directly (`bus.set(value)`) instead of issuing `n_set`. `bus.set` is one OSC
message but avoids per-synth control routing inside scsynth and is the
canonical idiom for live-controlled parameters. Pairs naturally with B3.

---

### 3C. System / OS configuration on the Pi

These reduce the *probability* of the kernel-side queue ever backing up and
make the userspace path more deterministic. Most are standard PatchboxOS /
RT-audio knobs.

#### C1. Real-time scheduling for the audio + MIDI threads
In `/etc/security/limits.d/95-spaluter.conf` (new file) for the `patch`
user, raise the RT and memlock ceilings:

```
@audio   -  rtprio      95
@audio   -  memlock     unlimited
@audio   -  nice        -19
patch    -  rtprio      95
patch    -  memlock     unlimited
```

Then in `~/.config/systemd/user/spaluter.service` add:

```
LimitRTPRIO=95
LimitMEMLOCK=infinity
LimitNICE=-19
Nice=-10
IOSchedulingClass=realtime
IOSchedulingPriority=2
```

scsynth gets RT priority automatically when launched under `pw-jack` if the
user is in `audio`; verify with `chrt -p $(pgrep scsynth)`.

#### C2. Pin the USB-MIDI IRQ to a non-audio core
On the Pi 4, USB lives on `xhci_hcd`. Find the IRQ:

```
grep -i xhci /proc/interrupts
```

Then bind it to a CPU (e.g. CPU 1) so it doesn't share a core with scsynth:

```
echo 2 > /proc/irq/<N>/smp_affinity   # bit-mask: 2 = CPU 1
```

Persist via a one-shot systemd unit. Optionally `echo threadirqs` is added
to `/boot/firmware/cmdline.txt` so IRQs run as kernel threads you can
`chrt -f -p 50 <pid>`.

#### C3. Isolate a core for the audio thread
Add to `/boot/firmware/cmdline.txt`:

```
isolcpus=3 nohz_full=3 rcu_nocbs=3
```

Then taskset scsynth to CPU 3:

```
taskset -pc 3 $(pgrep scsynth)
```

scsynth on a dedicated core means USB IRQ jitter and Electron UI repaints
cannot preempt the audio block. This is the single biggest win for
worst-case latency / xrun behaviour on a Pi 4.

#### C4. CPU governor = performance
```
sudo cpufreq-set -g performance        # all cores
```

Pi 4 ondemand governor can drop to 600 MHz and back, which during fader
bursts manifests as a brief stall. Performance governor is the standard
audio-Pi setting.

#### C5. Lower scsynth block size, raise hardware buffer
PipeWire on Pisound: ensure `default.clock.quantum=128` (or 64 if you can
afford it) and `default.clock.rate=48000`. The Pisound likes 48 kHz; mixing
44.1 sources through PipeWire resampling adds CPU. Check with
`pw-metadata -n settings`.

For scsynth specifically: `s.options.hardwareBufferSize = 256` and
`s.options.blockSize = 64` in `runtime.scd` are sensible Pi defaults — but
do not pin them harder than you have to. The current code leaves them at
default; that's fine if PipeWire is configured at 128.

#### C6. PipeWire: bypass for the SC path
You are already routing scsynth through `pw-jack`. That puts the audio
thread under PipeWire's graph and at PipeWire's quantum. If MIDI jitter
remains a concern, consider running scsynth against ALSA directly
(`s.options.device = "hw:pisound"`) and not via `pw-jack`. You lose
PipeWire's session graph integration but get one fewer hop. Test both.

#### C7. Disable services that compete for USB / IRQs
On a Pi dedicated to this device, disable: `bluetooth.service`,
`hciuart.service`, `triggerhappy.service` (consumes input events),
`ModemManager.service`, `avahi-daemon.service` if Bonjour isn't needed.
Each one is a wakeup source.

#### C8. Disable USB autosuspend for the Grid
USB autosuspend will park the controller when "idle" and add a wake-up
delay on the next event:

```
echo on > /sys/bus/usb/devices/<grid>/power/control
```

Persist via a udev rule keyed on `idVendor=303a, idProduct=8123`:

```
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="303a", ATTR{idProduct}=="8123", TEST=="power/control", ATTR{power/control}="on"
```

#### C9. Increase ALSA seq output buffer for safety
If sclang opens its own MIDI client (option B3), enlarge the seq output
pool so a momentary stall doesn't drop events:

```
modprobe snd-seq seq_default_timer_resolution=1000
```

Plus in sclang: `MIDIClient.init(numClients: 1, numIns: 8);` — these
sizes are buffer hints.

#### C10. Memory pressure & swap
PatchboxOS ships with swap. With Electron + scsynth + sclang resident,
swap on a Pi means audio death. Set `vm.swappiness=1` and consider
disabling swap entirely (`sudo dphys-swapfile swapoff && sudo systemctl
disable dphys-swapfile`) if you have 4 GB+.

#### C11. Don't run scope streaming you don't need
Tangential, but: `ACTIVE_SCOPE_RATE_HZ = 20` (renderer.js:64) and
`/spaluter/scope` traffic is in the same OSC pipe as control events. When
the scopes screen isn't visible, scope streaming is already disabled in the
code path — keep it that way. The proposal here: when **any** UI element is
not visible (off-screen tab, drawer collapsed), suppress its DOM updates
entirely.

---

## 4. Recommended sequencing

If you want the maximum risk-adjusted improvement with the least change:

1. **A1, A2, A6, A8** first. They are all <100 lines of code, fully
   reversible, and address the proximate cause of the crash directly.
2. **A3 + A4 + A5** next: drop `invoke` for fire-and-forget, add OSC
   bundling on the main process. Touches the IPC contract — slightly
   more invasive but a clean refactor.
3. Measure (Grid sweep test for 60 s, watch `top`, `aplay -l`, scsynth
   late count). Decide whether you still need B.
4. If yes: **B3** (sclang owns MIDI). Single biggest architectural win on
   this hardware. Skip B1 unless you have non-MIDI Node features that need
   the main process for MIDI for other reasons.
5. **C1, C3, C4, C8, C10** in any order. These are independent of any code
   change and immediately improve the kernel-side worst case.

## 5. Files that will need to change (for reference, not modified here)

- `renderer/renderer.js` — A1, A2, A6, A7
- `preload.js` — A3 (add `setParamMany`, `sendParam`)
- `main.js` — A4, A5 (new `sc:set-param-many` channel + OSC bundle helper);
  B1 (load `@julusian/midi`, spawn worker, forward); change `ipcMain.handle`
  to `ipcMain.on` for one-way calls.
- `sc/runtime.scd` — A8 (drop `.defer`, add `/spaluter/set-many`); B3
  (`MIDIClient.init`, `MIDIFunc.cc/noteOn` block, mapping table sync);
  optionally B4 (control-rate bus rewiring of selected params).
- `spaluter_supercollider.scd` — only if B4: replace selected `\param`
  controls with `In.kr(bus)`.
- `build/linux/postinst.sh` — install C1 limits file, C8 udev rule, C7
  service-disable list, optional cpufreq governor unit.
- `~/.config/systemd/user/spaluter.service` (on the Pi) — add the `Limit*`
  + `IOScheduling*` block from C1.

## 6. Explicit non-goals

- **No resolution loss.** Every byte from the Grid is parsed; no CC value is
  dropped before being merged into the coalescing buffer; no Note is ever
  coalesced or reordered.
- **No change to audio quality.** All A and B changes are about how events
  reach scsynth, not what scsynth does with them. B4 is the only proposal
  that touches the SynthDef and is optional.
- **No new build/test tooling.** All proposals can be added incrementally
  inside the existing electron-builder + sclang runtime.

# Code Review: Performance & Installer Issues

---

## renderer/renderer.js — Performance

### 1. Per-knob `mousemove` and `mouseup` global listeners

**File:** `renderer/renderer.js` (knob setup loop, ~line 1048)

Each knob registers its own `window.addEventListener("mousemove", ...)` and `window.addEventListener("mouseup", ...)`. With ~20 knobs on the page, there are 20 separate `mousemove` handlers firing on every single mouse movement event, even though only one knob can possibly be dragging at a time. On a Raspberry Pi, this is a real cost since every frame layout/JS event tick runs all 20 handlers.

**Fix direction:** Use a single shared pair of `mousemove`/`mouseup` listeners on `window` that reference a shared `draggingKnob` variable set on `mousedown`.

---

### 2. DOM queries inside `setKnobVisual` on every drag event

**File:** `renderer/renderer.js` — `setKnobVisual()` (~line 194)

```js
const pointer = knob.querySelector(".knob-pointer");
const valueEl = knob.parentElement.querySelector(".knob-value");
```

These DOM queries run on every call to `setKnobVisual`, which happens on every `mousemove` while dragging. These nodes never change — they should be cached once per knob at setup time.

---

### 3. Scope pipeline creates 3–4 intermediate arrays at 20 Hz

**File:** `renderer/renderer.js` — `normalizeScopeSamples()` and `drawScopeFromSamples()` (~lines 344–341)

On every scope message (20 times/second):
- `normalizeScopeSamples` calls `.map()`, `.filter()`, and `.slice()`, producing three intermediate arrays
- `drawScopeFromSamples` calls `samples.map((v) => Number(v))` creating a fourth

This generates sustained GC pressure. At 20 fps these 4 allocations are constant. The values array in `drawScopeFromSamples` can be reused in place with a pre-allocated Float64Array.

---

### 4. `updateWaveformViews` triggered on every pixel of window resize

**File:** `renderer/renderer.js` (~line 977)

```js
window.addEventListener("resize", updateWaveformViews);
```

`updateWaveformViews` redraws all 4 canvases and re-runs waveform interpolation. The `resize` event fires at high frequency during a drag. On Pi, this causes repeated expensive canvas redraws while the user is still dragging the window corner. This should be debounced (e.g., 100–150 ms).

---

### 5. MIDI CC handler does a full linear scan of all mappings on every message

**File:** `renderer/renderer.js` — `handleMidiMessage()` (~line 682)

```js
Object.entries(midiMappings).forEach(([param, mappedCc]) => {
  if (mappedCc !== cc) return;
  ...
});
```

Every incoming CC message iterates all ~28 mappings to find which param it matches. A reverse lookup map (CC number → param name) would make this O(1). At high MIDI CC rates (e.g., a mod wheel at max resolution) this is a hot path.

---

### 6. `getControlMeta` rebuilds discrete option arrays on every MIDI CC event

**File:** `renderer/renderer.js` — `getControlMeta()` (~line 476)

```js
values: Array.from(select.options).map((opt) => Number(opt.value))
```

Called per CC message per mapped select parameter. The option values never change at runtime; they should be built once during setup and cached (e.g., in a `Map<param, meta>`).

---

### 7. `normalizeParamValue` for select params rebuilds a `Set` on every call

**File:** `renderer/renderer.js` — `normalizeParamValue()` (~line 748)

```js
const optionValues = new Set(Array.from(select.options).map((opt) => Number(opt.value)));
```

Same as above — creates a new `Array` and `Set` every time a select param is normalized. Happens on every MIDI CC, every preset recall, and every knob drag that touches a select. Cache this at init time.

---

### 8. `appendLog` reads and rewrites the entire log `textContent` on every message

**File:** `renderer/renderer.js` — `appendLog()` (~line 113)

```js
logEl.textContent += `${text}\n`;
```

This reads the full accumulated log text, concatenates the new line onto it, and rewrites the entire `textContent` node. As the log grows (up to 400+ lines in `logBuffer`), this becomes progressively more expensive. Appending a new `<span>` or text node, or using `insertAdjacentText`, avoids the full read-write cycle.

---

### 9. `drawWaveform` re-measures canvas geometry on every frame

**File:** `renderer/renderer.js` — `drawWaveform()` (~line 287)

The canvas `clientWidth` and `clientHeight` are read every time `drawWaveform` is called. The scope canvas redraws at 20 Hz, triggering a layout read each time. Caching the last measured dimensions and only re-measuring on resize would eliminate repeated layout queries during steady-state scope display.

---

## main.js — Performance & Correctness

### 10. `logBuffer.shift()` is O(n) on every line over 400

**File:** `main.js` (~line 24)

```js
if (logBuffer.length > 400) logBuffer.shift();
```

`Array.shift()` removes the first element and re-indexes the entire array (O(n)). A ring buffer or simple index pointer would be O(1). With rapid sclang stdout output during boot this runs frequently.

---

### 11. Race condition between `window-all-closed` and `before-quit`

**File:** `main.js` (~lines 279–305)

On non-macOS, when the window is closed:
1. `window-all-closed` fires and calls `stopSuperCollider()` (not awaited)
2. Immediately after, `before-quit` fires and calls `stopSuperCollider()` again

The second call may find `sclangProc === null` (already cleared by the first) and resolve immediately, while the first is still waiting. The OSC port then gets closed twice. This should be unified into a single guarded shutdown path.

---

### 12. Hardcoded 2-second delay before sending `/spaluter/start`

**File:** `main.js` (~line 51)

```js
setTimeout(() => {
  sendOsc("/spaluter/start", []);
}, 2000);
```

The `runtime.scd` already sends `"Runtime ready"` only after the server is booted, the patch is executed, the SynthDef is found, and all polling loops have passed. The additional 2-second wait is redundant on fast hardware and potentially insufficient on a loaded Raspberry Pi 4 with a slow audio device negotiation. The `runtime.scd` side is already the gating signal — the delay could be removed entirely.

---

## sc/runtime.scd — Performance & Robustness

### 13. 64 separate `DelayN.ar` UGens for scope output

**File:** `spaluter_supercollider.scd` (~line 172)

```supercollider
scopeValues = Array.fill(scopeFrames, { |i|
    DelayN.ar(scopeMono, scopeMaxDelay, (scopeFrames - 1 - i) / SampleRate.ir)
});
```

This instantiates 64 individual `DelayN` UGens in the SynthDef, each with its own internal buffer. On a Raspberry Pi 4, this is a meaningful portion of the DSP budget (64 UGen table lookups + 64 buffer reads per block). A single `RecordBuf`/`PlayBuf` pair or a `BufDelayN` with a shared `LocalBuf` would accomplish the same with far fewer UGens.

---

### 14. All 4 voices and all 3 formants always run, even when inactive

**File:** `spaluter_supercollider.scd` (~lines 51–165)

The SynthDef uses `Mix.fill(4, ...)` for voices and `Mix.fill(3, ...)` for formants. When `voiceCount = 1`, voices 1–3 are zeroed out by `vActive`, but all their UGens (oscillators, envelopes, `SelectX`, `Pan2`, etc.) still execute every audio block. Same for formants 2 and 3 when `formantCount = 1`.

On desktop this is acceptable. On the Pi 4 with limited DSP headroom, the always-on computation for inactive voices/formants is wasteful. Consider lower `numWireBufs` or a separate lighter SynthDef for single-voice use.

---

### 15. `waitForPatch` and `waitForSynthDef` max retries may expire under Pi load

**File:** `sc/runtime.scd` (~lines 58–79)

```supercollider
waitForPatch = { |onReady, retries = 60| ... AppClock.sched(0.1, ...) };
waitForSynthDef = { |name, onReady, retries = 80| ... AppClock.sched(0.1, ...) };
```

`waitForPatch` gives up after 6 seconds; `waitForSynthDef` after 8. On a cold-start Raspberry Pi 4 with a class-compliant USB audio interface (which triggers extra kernel negotiation), the SynthDef compilation can take longer than expected, causing a silent failure that only appears in the log. The retry counts could be increased, or the timeout could be made configurable via an env var.

---

### 16. `SendReply.kr` at 20 Hz sends 64 floats over OSC regardless of log drawer state

**File:** `spaluter_supercollider.scd` (~line 175–176)

```supercollider
scopeTrig = Impulse.kr(20);
SendReply.kr(scopeTrig, "/spaluter/scope", scopeValues);
```

The scope sends 20 OSC messages per second containing 64 floats each (~5.6 kB/s of loopback UDP traffic) whether or not the UI is visible or the scope canvas is being drawn. There is no mechanism to pause or slow scope output when it isn't needed. On the Pi, where both the sclang process and the Electron process are on the same CPU, this is 20 IPC wakeups per second at all times.

---

## Installer Issues

### 17. `.scd` files are packed into the asar archive without an `asarUnpack` rule

**File:** `package.json` (electron-builder `build.files`)

The `sc/` directory and `spaluter_supercollider.scd` are listed in `files` but there is no `asarUnpack` (or `extraResources`) rule to extract them from the asar. At runtime, `resolveExternalAssetPath` checks for `app.asar.unpacked` and falls back to the asar path if the unpacked version doesn't exist. Since sclang is an external native process, it **cannot** read files from inside an asar archive. If the unpacked path doesn't exist (which it won't without an explicit `asarUnpack` rule), `this.executeFile(escaped)` in sclang will silently fail to load the patch.

**Fix direction:** Add to `package.json` build config:
```json
"asarUnpack": ["sc/**/*", "spaluter_supercollider.scd"]
```

---

### 18. Windows installer has no `sclang` check

**File:** `build/win/installer.nsh`

The macOS and Linux installers both warn at install time if `sclang` is not in `PATH`. The Windows NSIS installer does neither — it only manipulates the registry PATH. Windows users who launch the app without SuperCollider installed get no install-time warning and only a cryptic runtime failure in the log. An NSIS check using `${If} ${FileExists} "$SYSDIR\sclang.exe"` or `SearchPath` would provide the same level of user guidance.

---

### 19. Windows PATH modification appends `$INSTDIR` even if already present

**File:** `build/win/installer.nsh` (~lines 8–14)

```nsh
StrCpy $1 "$0;$INSTDIR"
WriteRegExpandStr HKLM ...
```

On a repair or reinstall, `$INSTDIR` is prepended again without checking whether it already exists in PATH. This causes duplicate entries and an ever-growing PATH value over repeated reinstalls.

---

### 20. Linux `postinst.sh` binary path may not match electron-builder's actual deb layout

**File:** `build/linux/postinst.sh` (~line 4)

```bash
APP_BINARY="/opt/Spaluter Desktop/spaluter-desktop"
```

Electron-builder's deb output places binaries under `/opt/<productName>/` but the exact binary name is derived from the `executableName` or falls back to `productName` with spaces replaced by hyphens. If electron-builder produces `/opt/spaluter-desktop/spaluter-desktop` (all-lowercase with hyphen, which is its default for Linux), the symlink creation silently skips because `[ -x "$APP_BINARY" ]` evaluates false, and the `spaluter-desktop` CLI shortcut is never created.

---

### 21. `DEFAULT_SAMPLE_DIR` is a Unix-style absolute path, non-functional on Windows

**File:** `main.js` (~line 10)  
**File:** `renderer/renderer.js` (~line 36)

```js
const DEFAULT_SAMPLE_DIR = "/spaluter/samples/";
```

On Windows this resolves to `C:\spaluter\samples\`, an unconventional path that users are unlikely to have. The sample directory default is shown in the UI and used in preset saves. On Windows, a more appropriate default would be something derived from `app.getPath("documents")` or `app.getPath("home")`.

---

### 22. macOS postinstall silently succeeds even if the app bundle is missing

**File:** `build/mac/pkg-scripts/postinstall` (~lines 4–9)

```bash
if [ -x "$APP_BINARY" ]; then
  mkdir -p "$(dirname "$SYMLINK_PATH")"
  ln -sf "$APP_BINARY" "$SYMLINK_PATH"
fi
```

If the `.app` bundle isn't at the expected path (e.g., the user chose a custom install location in the `.pkg` GUI), the `if` block is skipped silently and the symlink is never created. There is no fallback to locate the actual install path, and no warning is emitted to the install log.

---

### 23. No OSC port conflict detection at startup

**File:** `main.js` — `createOscClient()` (~line 33)

If port `57131` is already bound (another instance of the app, or any other application), `oscPort.open()` emits an `"error"` event which is handled only by updating the status string. The app continues without a working OSC receive path, meaning status updates and scope data from SuperCollider are silently dropped. There is no fallback port selection and no user-visible indication that OSC is non-functional beyond a brief status message.

# Steam Deck Port Assessment — Spaluter Desktop

**Status:** Analysis only. No code has been changed and no plan has been executed.
**Scope:** Compare the current target platform (Raspberry Pi 4 + Pisound, Patchbox/Pi OS) against a Steam Deck port, focused on **performance, sound quality, stability, and performability**, under the hard constraint that **no change may degrade audio quality**. Then assess porting difficulty.

---

## 1. Executive summary

Porting Spaluter to the Steam Deck is **feasible and technically attractive**, but it is a *new platform target*, not a recompile. The app is an Electron front-end driving an external SuperCollider engine over OSC; almost none of that is Pi-specific. The friction is concentrated in three areas:

1. **Audio device binding** — the engine hard-pins the ALSA device to `"pisound"` (`sc/runtime.scd:66–68`). This must change or scsynth will fail to boot on a Deck.
2. **OS packaging model** — SteamOS has an immutable, read-only root and is `pacman`-based x86-64, while the entire current Linux pipeline is an Arn64 `.deb` with an `apt` bootstrap (`package.json:12`, `build/linux/postinst.sh`).
3. **Audio interface hardware** — to honor "no audio-quality sacrifice," the Deck's internal codec is **not acceptable** as the primary output; an external USB-C audio interface is effectively mandatory.

**Verdict on the four axes:**

| Axis | Direction vs Pi+Pisound | One-line summary |
| --- | --- | --- |
| **Performance** | ✅ Large win | ~4–8× CPU headroom; enables more voices, larger reverb, lower buffers. |
| **Sound quality** | ⚠️ Neutral *only if* external interface used; ❌ regression on internal DAC | Pisound is 24-bit/192 kHz; Deck internal codec is 48 kHz/16-bit consumer Realtek. |
| **Stability** | ✅ Likely better | More thermal/CPU headroom, fewer under-voltage events; new risks are battery/throttle + immutable-OS update churn. |
| **Performability** | ✅ Win, with caveats | Larger 1280×800 touchscreen + gamepad/trackpads/gyro as expressive controllers; loses Pisound DIN MIDI + the hardware button/knob. |

**Overall difficulty: Moderate.** Estimated **1.5–3 weeks** of focused work for a solid, reproducible build (see §7). The single biggest unknown is not code — it is the SteamOS immutable-filesystem install/update story for SuperCollider.

---

## 2. Platform baseline comparison

| | Raspberry Pi 4 + Pisound (current) | Steam Deck (target) |
| --- | --- | --- |
| **CPU** | Broadcom BCM2711, 4× Cortex-A72 @ 1.5–1.8 GHz | AMD APU "Aerith/Sephiroth", 4-core/8-thread Zen 2 @ 2.4–3.5 GHz |
| **RAM** | 1–8 GB LPDDR4 | 16 GB LPDDR5 |
| **GPU** | VideoCore VI | RDNA 2, 8 CUs (front-end only here) |
| **Architecture** | ARM64 (aarch64) | x86-64 |
| **Audio HW** | **Pisound HAT**: 24-bit/192 kHz ADC/DAC, dedicated low-jitter clock, DIN MIDI in/out, hardware button + knob | Realtek codec, ~48 kHz/16-bit (24-bit possible with tweaks); USB-C/USB audio for external interfaces |
| **Audio stack** | PipeWire + WirePlumber, `pw-jack` wrapper, scsynth pinned to `hw:pisound` | PipeWire + WirePlumber (default); `pw-jack` available |
| **OS** | Patchbox OS / Raspberry Pi OS (Debian), writable root, `apt` | SteamOS 3 (Arch-based), **immutable read-only root**, `pacman`; Flatpak + distrobox available |
| **Display** | External/DSI touchscreen, 1024×600 or 800×480 | Built-in 1280×800 touchscreen (LCD 60 Hz / OLED 90 Hz) |
| **Compositor** | Xorg kiosk (LXDE-pi-x), no compositor | Gaming Mode = Gamescope (Wayland); Desktop Mode = KDE Plasma |
| **Input** | Touch + USB/DIN MIDI (Intech Grid, Pisound DIN) | Touch + 2 trackpads + gyro + full gamepad + USB-C/Bluetooth MIDI |
| **Power** | Mains; under-voltage/throttle is a real failure mode (POWER chip) | Battery + APU; thermal/TDP throttling and battery state are the concerns |
| **Install artifact** | `.deb` (arm64) via electron-builder | Needs new x86-64 path (Flatpak/distrobox/AppImage) |

---

## 3. Performance

**Conclusion: clear, large improvement. No audio-quality trade-off required to gain it.**

- The Pi 4's A72 cores are the binding constraint today; the README documents extensive measures to keep CPU low on the Pi — the Perform scope only renders while on screen, `shadowBlur` was dropped, offscreen scope draws are skipped, and renderer animation is clocked from the main process to dodge Xorg occlusion throttling (`main.js:440–447`, `main.js:770–776`). These are **Pi-survival optimizations**, not inherent design needs.
- The Deck's Zen 2 cores (higher IPC, ~2× clock, 8 threads) give roughly **4–8× single-thread and multi-thread headroom** for scsynth. The pulsar engine (per-grain jitter, multi-formant voices, masking) and the Clouds-style reverb FDN (`\spaluterReverb`) are DSP-heavy and benefit directly.
- Headroom can be spent on **quality, not just margin**: more simultaneous voices, longer/denser reverb, higher internal oversampling, and — most importantly — **smaller hardware buffer / block sizes** for lower latency without xruns.
- The Electron front-end is trivially within budget on the Deck. The CPU-saving UI hacks can be relaxed (full-rate scope, richer visuals) once off the Pi.

**Net:** performance is a reason *to* port, and none of the gains require sacrificing audio fidelity.

---

## 4. Sound quality

**This is the decisive axis given the "no sacrifices" constraint.**

### 4.1 The hardware reality
- The **Pisound is the source of the current quality**: a purpose-built 24-bit/192 kHz audio HAT with a dedicated low-jitter master clock and balanced analog stage. It is a GPIO/HAT device — it **cannot be physically moved to the Steam Deck**.
- The Steam Deck's **internal output is a consumer Realtek codec, effectively 48 kHz / 16-bit** for analog out. Routing Spaluter through it would be an **audible regression** (lower bit depth, higher noise floor, lower ceiling sample rate, more jitter) and therefore **violates the no-sacrifice constraint**.

### 4.2 The required mitigation (mandatory, not optional)
To match or exceed Pisound quality on the Deck:

- **Use an external class-compliant USB-C audio interface** (e.g. a 24-bit/96–192 kHz interface). SteamOS PipeWire recognizes class-compliant USB interfaces plug-and-play, and the device dictates the achievable rate/bit depth. This is the supported, high-quality path.
- **Match scsynth's sample rate to the interface** (e.g. 48/96/192 kHz) and prefer the hardware device directly. The engine deliberately does **not** force a sample rate (`sc/runtime.scd:56` comment: "Do not force sampleRate here; let OS/default device choose a valid rate"), so high rates are already supported once the device is selected correctly.
- **Preserve the `hw:` direct-device strategy.** Today the engine pins `s.options.device = "pisound"` specifically to bypass the ALSA `plug` resampling layer in `/etc/asound.conf` (`sc/runtime.scd:63–68`). The same principle must carry over: pin scsynth to the **external interface's `hw:` node**, not a resampling/plug or the PipeWire-virtual default, to keep a bit-transparent path. (`midi-optimization-claude.md` also notes the RT-priority trade-off of `hw:` vs `pw-jack`.)
- **Keep float internal processing.** SuperCollider is 32-bit float end-to-end; quality is then bounded by the interface, exactly as on the Pi.

### 4.3 Verdict
- **With a quality USB interface: parity or better** (the Deck's DSP headroom even allows higher oversampling than the Pi could afford).
- **On the internal DAC: unacceptable** under the stated constraint.
- **Action implied:** the port must *require and document* an external interface as the supported audio path, and the device-binding code (§7, item A) must be generalized so the engine never silently falls back to the internal codec or a resampling plug.

---

## 5. Stability

**Conclusion: probably more stable than the Pi, with a different (smaller) set of new risks.**

Improvements on the Deck:
- **No Pisound/Pi under-voltage class of failure.** Pi under-voltage/throttle is a tracked failure mode (the POWER status chip; `hdmi-issues.md` even lists power integrity as a display-loss cause). The Deck's regulated power and large thermal budget remove most of this.
- **More CPU headroom → fewer xruns/dropouts** under sustained high-rate MIDI fader sweeps (the exact scenario the MIDI hot path was hardened for — `midi-fix-plan.md`, `preload.js` batched fire-and-forget IPC).
- **HDMI/display negotiation pain disappears.** The entire `hdmi-issues.md` saga (forced modes, EDID instability, DPMS) is specific to driving external monitors from the Pi. The Deck has a fixed, known internal panel.

New/relocated risks on the Deck:
- **Battery + thermal throttling.** Under battery, the APU can down-clock; sustained audio DSP should run plugged in or with a raised TDP floor. The `POWER` chip semantics need to be redefined from "Pi under-voltage" to "battery/thermal/TDP."
- **Immutable-OS update churn.** SteamOS updates can wipe `pacman`-installed packages and root modifications. Anything installed by disabling `steamos-readonly` is fragile across updates — this is a *stability-of-the-install* risk, not a runtime-audio risk, and it is the main reason to prefer Flatpak/distrobox/AppImage (§7).
- **Gaming Mode vs Desktop Mode.** The current Xorg-kiosk occlusion workaround (`backgroundThrottling:false`, fullscreen-on-linux at `main.js:769–776`) is X11-specific. Under Gamescope (Wayland) the throttling behavior differs and must be re-validated; the main-process-driven animation clock may no longer be necessary, or may behave differently.

---

## 6. Performability (live playability)

**Conclusion: net win on the screen/UI, mixed on physical control surfaces.**

Gains:
- **Bigger, higher-res touchscreen** (1280×800 vs 1024×600/800×480). The Perform macros, scope, and meters get more room; the fixed-size canvas UI can be scaled up. OLED model adds 90 Hz for smoother scope/meter animation.
- **Rich onboard controllers unique to the Deck**: 2 trackpads, gyro, sticks, triggers, face/grip buttons. These are natural targets for the 5 performance macros (Brightness, Motion, Stereo Width, Texture, Grain Shape) and for expressive gestures (gyro→motion, trigger→gate). This is an *expressive upgrade* over a touch-only Pi panel — but it requires new input mapping code (gamepad/gyro are **not** currently read; input today is touch + Web MIDI via `navigator.requestMIDIAccess`, `renderer/renderer.js:1945–1951`).
- **Portability**: self-contained, battery-powered instrument.

Losses / caveats:
- **No Pisound DIN MIDI and no Pisound hardware button/knob.** DIN-only gear (e.g. the Pisound DIN path) needs a USB-MIDI or USB interface with MIDI. USB and Bluetooth MIDI still work via Web MIDI/ALSA, and the `aconnect` auto-wiring (`sc/runtime.scd:416–418`, currently hard-coded to `"Grid"`/`"pisound"`) would need generalizing to whatever device is present.
- **Ergonomics differ**: a Deck in the hands is not a panel on a stand. Acceptable for portable play, different for studio use.

---

## 7. Porting difficulty assessment

Overall: **Moderate.** The codebase is largely portable (Electron + OSC + SuperCollider, already "cross-platform" for macOS/Windows/Pi per the README). Work concentrates in audio-device binding and SteamOS packaging.

### A. Audio device binding — **required, low effort, high importance**
- **Problem:** `sc/runtime.scd:66–68` hard-codes `s.options.device = "pisound"` for *all* Linux. On a Deck this device does not exist → scsynth fails to boot.
- **Fix shape:** make the device selectable (env var / config) instead of a hard-coded literal, defaulting to the chosen external interface's `hw:` node; never silently fall back to the internal codec or a resampling plug (preserves §4 quality). Mirror the change for the MIDI auto-wire list (`sc/runtime.scd:416–418`).
- **Effort:** ~0.5–1 day of code; the rest is device-name discovery/UX.

### B. Build & packaging for x86-64 SteamOS — **required, the largest single effort**
- **Problem:** the only Linux artifact today is `electron-builder --linux deb --arm64` (`package.json:12`) with an `apt`-based postinstall that installs SuperCollider, writes `/usr/local/bin` launchers, and assumes a writable root (`build/linux/postinst.sh`). None of this applies to an immutable, `pacman`-based x86-64 SteamOS.
- **Options (pick one):**
  - **Flatpak** — best fit for the immutable OS and survives updates; but SuperCollider isn't an official Flatpak, so you'd bundle/build it or depend on a runtime. Audio (PipeWire) integration is good in modern Flatpak.
  - **distrobox (Arch container)** — `pacman -S supercollider` works inside the container; flexible, survives OS updates, but needs audio/MIDI bridging into the host and is less "appliance-like."
  - **AppImage + documented external SuperCollider** — simplest Electron packaging, but SuperCollider install still has to be solved on the read-only root.
- **Effort:** ~1–2 weeks depending on choice; this is where the real time goes. The `.deb` postinstall logic (services bootstrap, launcher, MIDI/audio probes) needs a SteamOS-appropriate equivalent.

### C. SuperCollider availability on SteamOS — **required, medium risk**
- scsynth/sclang must be present and runnable on x86-64 SteamOS without permanently disabling `steamos-readonly`. Bundling (Flatpak/distrobox) is strongly preferred over `pacman` on root (which updates can wipe). This is the **biggest non-code unknown**.

### D. Display / compositor / kiosk — **medium effort**
- Re-validate fullscreen + throttling under Gamescope (Wayland) vs the current Xorg assumptions (`main.js:769–776`). The main-process animation clock (`main.js:440–447`) exists to beat Xorg occlusion throttling; confirm whether it is still needed/correct on the Deck.
- Make the fixed-size UI responsive/scaled to 1280×800 (CSS is currently authored for 1024×600 — `renderer/styles.css:3`). Low risk, mostly layout.

### E. Audio routing / `pw-jack` — **low effort**
- The launcher prefers `pw-jack` and it exists on SteamOS, so the JACK-wrapper path largely carries over. Reconcile with the §4 requirement to pin a `hw:` device (note the `pw-jack` vs `hw:` RT-priority trade-off flagged in `midi-optimization-claude.md`).

### F. Input expansion (optional, value-add) — **medium effort**
- Add gamepad/gyro/trackpad reading (e.g. Gamepad API) to drive macros/gate for true Deck performability (§6). Pure upside; not required for parity.

### G. Power/telemetry semantics — **low effort**
- Repurpose the `POWER` status chip from Pi under-voltage to Deck battery/thermal/TDP state. Cosmetic but user-facing.

### Effort summary

| Item | Required? | Effort | Risk |
| --- | --- | --- | --- |
| A. Audio device binding | Yes | 0.5–1 day | Low |
| B. x86-64 SteamOS packaging | Yes | 1–2 weeks | Medium–High |
| C. SuperCollider on SteamOS | Yes | included in B | Medium |
| D. Compositor/kiosk + UI scaling | Yes | 2–4 days | Medium |
| E. `pw-jack` / routing reconcile | Yes | 0.5 day | Low |
| F. Gamepad/gyro input | Optional | 3–5 days | Low |
| G. Power telemetry semantics | Optional | 0.5 day | Low |

**Total for a solid, reproducible port: ~1.5–3 weeks**, dominated by item B.

---

## 8. Risks & open questions

1. **No audio-quality compromise ⇒ external USB interface is mandatory.** The internal DAC cannot be the supported output. This must be a documented hardware requirement, not a soft recommendation.
2. **Immutable-OS install durability.** Will SuperCollider survive SteamOS updates? Flatpak/distrobox mitigate; `pacman`-on-root does not.
3. **Gamescope throttling behavior** for the Electron renderer is unverified; the Pi's Xorg workarounds may not translate.
4. **Direct-`hw:` device pinning vs `pw-jack` RT priority** is a known trade-off (`midi-optimization-claude.md`) that must be re-decided on the Deck to keep both bit-transparency *and* xrun-free RT scheduling.
5. **MIDI device discovery** is currently hard-coded to `"Grid"`/`"pisound"` (`sc/runtime.scd:416–418`); generalize before relying on it.

---

## 9. Recommended approach (not executed)

1. **Prototype first, package later.** On a Deck in Desktop Mode, install SuperCollider (distrobox Arch is the quickest proof), generalize the device pin (item A), and confirm the engine boots against an external USB interface at high sample rate with no plug/resampling. This validates the §4 quality constraint before investing in packaging.
2. **Decide the distribution model** (Flatpak vs distrobox vs AppImage) — this is the project's pivotal decision and drives most of the remaining effort (item B/C).
3. **Re-validate the kiosk/throttle path** under Gamescope and scale the UI to 1280×800 (item D).
4. **Then** add Deck-native input mapping (item F) as the performability upgrade.

**Bottom line:** A high-quality Steam Deck port is realistic and would *improve* performance, stability, and on-device performability — **provided** it ships with (and requires) an external USB audio interface so the Pisound's fidelity is matched rather than sacrificed. The dominant cost is SteamOS packaging, not application code.

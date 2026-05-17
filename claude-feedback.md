# Feedback: Raspberry Pi deployment and startup plan

Review of the plan at `~/.copilot/session-state/a32e7598-0b12-40eb-8759-f6aebfb658a0/plan.md`, focused on reliability and stability of the proposed solution.

## Strengths
- **Fail-fast on missing Pisound** (step 5) is the right call — matches the explicit "do not fallback" decision and avoids silent degradation.
- **Committed-HEAD-only build** isolates deploys from local cruft, making the artifact reproducible.
- **Reboot-and-verify** as a final gate is good — proves the cold-boot path, not just the live config.

## Reliability concerns

### 1. Race condition between autostart and PipeWire (highest risk)
`~/.config/autostart` fires very early in the desktop session. PipeWire/WirePlumber and the Pisound ALSA card may not be enumerated yet when the wrapper runs. A naive "resolve Pisound sink → fail if missing" check will produce flaky boot failures even when Pisound is physically present.

→ The wrapper needs an explicit bounded wait loop: poll `pactl list short sinks | grep -i pisound` (and the MIDI client) with a timeout (e.g. 15–30s, 0.5s interval) before declaring failure. The plan says "waits for user audio session" but doesn't specify a timeout strategy — make it explicit.

### 2. Setting PipeWire defaults from an autostart script is fragile
`pactl set-default-sink` only persists for the current session; if WirePlumber re-evaluates priorities it can flip back. More stable approaches:
- A WirePlumber config drop-in pinning the Pisound node as default (survives reboots, no race).
- Or `wpctl set-default <id>` after resolving the node ID — same caveat, but at least uses the canonical tool.

The plan should pick one and not rely on transient `pactl` defaults.

### 3. LightDM autologin + Wayland/X session assumption
PatchboxOS ships LightDM, but confirm the session it launches actually honors `~/.config/autostart` (LXDE/XFCE do; some minimal/kiosk sessions don't). Worth verifying which session `patch` boots into before assuming XDG autostart works.

### 4. No restart/supervision policy
If Spaluter crashes post-launch, nothing restarts it. For an appliance-style boot, consider whether a systemd `--user` unit with `Restart=on-failure` would be more stable than a one-shot autostart `.desktop` entry. Autostart is fine for v1 but flag this as a known gap.

### 5. `pw-jack` launcher dependency
If `pw-jack` isn't on PATH at autostart time (minimal session PATH differs from interactive shells), the launcher silently fails. Wrapper should either use an absolute path or `set -e` and log to a known file.

### 6. Verification step is observational, not assertive
"App process running, default sink on Pisound" should be coded as explicit checks with non-zero exit on failure, not eyeball verification — otherwise regressions on future deploys go unnoticed.

### 7. Sudo password handling
"`sudo` password is the same as SSH password" implies it'll be passed somehow during install. If the plan uses `sshpass` or echoes the password into `sudo -S`, make sure it isn't logged or left in shell history. Not a stability issue but a footgun.

## Minor
- No rollback story if the `.deb` installs but the wrapper is broken — Pi could end up in an autologin loop with a failing autostart. Keep an SSH path open (don't disable sshd) and consider a "disable autostart" escape hatch documented in the plan.
- Plan doesn't mention pinning the Pisound card's ALSA index/name — if USB enumeration order changes, name-based matching (`grep -i pisound`) is safer than index-based.

## Bottom line
The shape is right, but the wrapper logic in step 5 is where this will succeed or fail. Specify: bounded wait with timeout, WirePlumber config (not just `pactl`), absolute paths, explicit logging, and assertive verification. Without those, expect intermittent boot failures even when the hardware is fine.

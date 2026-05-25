# HDMI troubleshooting summary (Patchbox / Raspberry Pi)

## Symptom

- Physical monitor often shows **“No Signal”**.
- You can sometimes see a brief monitor reset when plugging HDMI in, then it drops back to no signal.

## What has been tried so far

1. **Collected baseline HDMI/DRM state and boot config**
   - Checked `/sys/class/drm/card1-*/status`, `/sys/class/drm/card1-*/modes`, DRM debug state, and kernel logs.
   - Found periods where both HDMI connectors were reported `disconnected`.
   - Found `cmdline` had forced modes (at different times) including:
     - `video=HDMI-A-1:800x480M@60` (earlier)
     - later forced `video=HDMI-A-1:1024x768@60e video=HDMI-A-2:1024x768@60e`
     - later forced `video=HDMI-A-1:800x480@60e video=HDMI-A-2:800x480@60e`

2. **Tried removing forced kernel `video=` mode**
   - Removed forced mode from `/boot/firmware/cmdline.txt` and rebooted.
   - Result: after reboot, HDMI detection regressed and both connectors showed `disconnected` again.

3. **Tried forcing HDMI in firmware config (`config.txt`)**
   - Added/updated:
     - `hdmi_force_hotplug:0=1`
     - `hdmi_force_hotplug:1=1`
     - `hdmi_group:0=2`, `hdmi_mode:0=16`
     - `hdmi_group:1=2`, `hdmi_mode:1=16`
   - Rebooted.
   - Result: still unstable / not reliable for persistent display.

4. **Forced kernel output on both HDMI connectors**
   - Set in `/boot/firmware/cmdline.txt`:
     - `video=HDMI-A-1:1024x768@60e video=HDMI-A-2:1024x768@60e`
   - Result: both connectors came up as `connected`; DRM showed active CRTCs at `1024x768`.

5. **Changed forced resolution to 800x480**
   - Updated cmdline to:
     - `video=HDMI-A-1:800x480@60e video=HDMI-A-2:800x480@60e`
   - Result: kernel request applied, but desktop/compositor sometimes switched active mode back to `1024x768`.

6. **Wayland-era output forcing (before X11 switch)**
   - Used `wlr-randr` to set `800x480` live.
   - Added persistent `kanshi` profiles in `~/.config/kanshi/config` for:
     - dual 800x480
     - HDMI-1 only 800x480
     - HDMI-2 only 800x480
   - Rebooted and confirmed in that phase that active mode could persist as `800x480`.

7. **Switched desktop stack to X11 for RealVNC**
   - Changed LightDM autologin/user session to `LXDE-pi-x` in:
     - `/etc/lightdm/lightdm.conf.d/90-spaluter-autologin.conf`
     - `/etc/lightdm/lightdm.conf`
   - Rebooted.
   - Confirmed session type became `x11`, Xorg running on `:0`.
   - This fixed the RealVNC “Cannot currently show the desktop” path (X server became discoverable).

8. **X11-specific HDMI stabilization attempts**
   - Observed in X11:
     - HDMI often detected as connected, but active mode defaulted to `1024x768`.
     - `DPMS` initially enabled.
     - Kernel log still showed occasional `User-defined mode not supported: "800x480"...`.
   - Added LXDE autostart file `~/.config/lxsession/LXDE-pi/autostart` with:
     - `@xset -dpms`
     - `@xset s off`
     - `@xset s noblank`
     - `@xrandr --output HDMI-1 --mode 800x480 --primary --output HDMI-2 --off`
   - Temporarily removed forced cmdline video to test pure X11 control; after reboot both connectors went `disconnected`.
   - Re-applied forced cmdline output:
     - `video=HDMI-A-1:800x480@60e video=HDMI-A-2:800x480@60e`
   - Current verified state from SSH:
     - X11 active (`LXDE-pi-x`)
     - DPMS disabled
     - `xrandr` current mode on HDMI-1 = `800x480`
     - DRM connectors show `connected`

## Current config state (latest known)

- `/boot/firmware/cmdline.txt` includes:
  - `video=HDMI-A-1:800x480@60e video=HDMI-A-2:800x480@60e`
- LightDM uses X11 session:
  - `autologin-session=LXDE-pi-x`
  - `user-session=LXDE-pi-x`
- LXDE autostart applies:
  - DPMS/screensaver disable
  - `xrandr` forcing HDMI-1 `800x480` and HDMI-2 off

## Other possibilities

1. **Unstable or marginal HDMI signal path**
   - Cable quality/length, adapter quality, connector strain, or loose micro/full HDMI seating can cause brief hotplug then signal drop.

2. **Monitor EDID instability or partial EDID reads**
   - Logs previously showed EDID-related issues (`failed to get edid data`, short EDID in userspace tools).
   - If EDID read is inconsistent, mode negotiation can flip or fail.

3. **Wrong physical input or monitor-side auto-switch behavior**
   - Some displays briefly lock, then fall back if input source selection changes or auto-detect fails.

4. **Dual-output forcing side effects**
   - Forcing both HDMI connectors (`...HDMI-A-1...` and `...HDMI-A-2...`) can create a “phantom second output” and confuse mode selection or sink assignment.

5. **Pi firmware/kernel vc4 KMS quirk with this panel timing**
   - The vc4 driver reported `User-defined mode not supported` for some 800x480 timings.
   - This can happen when a forced modeline differs from the monitor’s accepted timings.

6. **Power integrity issue**
   - Undervoltage or transient power dips can reset HDMI PHY behavior and cause repeated signal loss.

7. **Hardware fault on monitor, cable, or Pi HDMI port**
   - Intermittent hardware failure can look exactly like hotplug-then-no-signal behavior.

8. **Display stack race during boot/login**
   - Kernel forced mode, Xorg mode set, and desktop/autostart mode changes can race; if timing is unlucky, output can settle on an unsupported state.

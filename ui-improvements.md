# UI improvement suggestions

Based on the current 1024x600 Pi touchscreen screenshot, the app has a strong technical foundation but still reads more like a dense desktop control panel than a touch-first synth interface. These suggestions are intentionally non-executable and should be treated as design notes only.

## Touch-first layout

1. Increase all primary touch targets to at least 44-48px high. The top tabs, Stop Synth, Reset, Show Log, and About are usable but visually dense; larger hit areas would reduce missed taps on the Pi display.
2. Reduce the number of top-level tabs visible at once. Seven wide tabs plus utility buttons consume a large portion of the screen. Consider a bottom navigation bar or two-mode switch: `Perform` and `Edit`, with parameter pages inside Edit.
3. Prioritize one main performance surface per screen. The current Scopes view leaves a large empty lower region while the useful scopes are compressed into small panels. Use that space for a larger output scope, macro controls, or a performance XY pad.
4. Keep emergency controls persistent but visually separated. `Stop Synth` should remain easy to hit, but it could be a dedicated red transport button in a consistent control strip instead of competing with utility buttons.

## Modern graphical look

1. Move from boxed panels to softer cards with more spacing, subtle shadows, and consistent corner radii. The current grid lines and borders make the UI feel utilitarian.
2. Use stronger visual hierarchy: larger section titles, quieter metadata text, and more prominent live values. Many labels are small and low contrast.
3. Adopt a clearer color system. Blue/green/red are currently used for status, traces, and buttons; define fixed meanings such as blue = navigation, red = destructive/stop, green = healthy/audio, purple/orange = modulation/formants.
4. Add graphical icons for common actions: transport stop, reset, log, about, MIDI, preset, and modulation. Icons would reduce text density and modernize the interface.

## Scopes page

1. Make the output scope the hero element. It is the most performance-relevant visualization, but in the screenshot it is not visible while most of the lower screen is empty.
2. Group related mini-scopes into a compact analysis strip. Pulsaret, Window, Duty, Formants, Formant Activity, Mask, Stereo Peak, and Stereo Corr are useful, but too many small panels compete for attention.
3. Consider a two-tier scope layout: large output waveform on top or center, with small diagnostic scopes underneath. This better matches how players scan visual feedback during performance.
4. Replace text-heavy labels like `Static • Mask-aware` and `Off • PF off • 0.50` with small status chips or toggles that are easier to parse quickly.
5. Use animated but restrained visual feedback for MIDI/gate activity, such as a pulsing edge glow or small note indicator, so the player can confirm input without opening logs.

## Parameter editing

1. Convert dense parameter pages into touch-friendly grouped cards: Core, Formants, Stereo, Envelope, Texture, Sample, Modulation.
2. Use large radial knobs or horizontal sliders with direct numeric readouts. Tiny controls are difficult on a 1024x600 touchscreen.
3. Add a few macro controls on the main performance page, such as Brightness, Motion, Stereo Width, Texture, and Shape, mapped internally to multiple parameters.
4. Make MIDI mappings discoverable but not always visible. A long-term design could use a dedicated MIDI Learn mode that overlays assignable controls only when active.

## Status and reliability UX

1. Add a persistent MIDI input indicator showing the currently active device and recent event activity. This would make MIDI failures easier to distinguish from audio or mapping issues.
2. Add a power/undervoltage warning banner when the Pi reports throttling or undervoltage. Given the recent brownout resets, the UI should surface this as a critical synth reliability state.
3. Add an audio engine status indicator separate from app status: `MIDI`, `SC`, `Audio`, and `Power` could each be small green/yellow/red chips.
4. Keep the log drawer available, but avoid making logs part of normal performance troubleshooting. Important failures should appear as short, actionable banners.

## Visual polish

1. Increase page padding and align card edges consistently. The screenshot is clean but very grid-heavy.
2. Use a slightly brighter background for active cards and a darker base for inactive regions to create depth.
3. Improve typography scale: larger page titles, medium-weight control labels, and monospaced text only for logs or diagnostics.
4. Add smooth transitions when switching pages, but keep them fast and minimal to preserve performance.
5. Consider a compact brand/header area. The logo is nice, but the top row could be less crowded by moving CPU/LFO/status into a secondary status strip.

## Highest-impact first changes

1. Make the output scope large and visible on the Scopes page.
2. Replace the top row of many tabs with a simpler touch navigation model.
3. Add persistent MIDI/audio/power status chips.
4. Increase touch target sizes and spacing across controls.
5. Introduce a performance page with a small number of large macro controls.

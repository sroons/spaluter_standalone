# SPILUTER — UI design mockups

Non-functional design studies that visualize the suggestions in
[`../ui-improvements.md`](../../ui-improvements.md), in a style influenced by the
**Tomato** design collective (layered typography, visible "process" marginalia,
grain/scanline texture, a muted base with a single shock colour).

These are **mockups only** — they are not wired into the Electron app.

## Screens

| PNG | Screen | Demonstrates |
| --- | --- | --- |
| `01_perform.png` | Perform | Hero stereo output scope; 5 large macro lanes; persistent MIDI/SC/Audio/Power status chips; undervoltage banner; dedicated red-orange Stop Synth transport; consolidated bottom nav. |
| `02_edit.png` | Edit Engine | Dense parameters reorganized into 4 grouped touch cards (Core / Timbre+Wave / Formants / Texture) with vector wave + window previews and large touch sliders. |
| `03_modulation.png` | Mod Router | 16-slot internal LFO bus shown as active routing cards with live shape previews, rate/depth readouts, and bus targets. |
| `04_presets.png` | Presets | Save/recall configurations: a 32-slot preset bank (saved + empty slots with waveform signatures) plus a slot-detail panel showing what's captured (params, LFO bus, sample, macros) with Recall / Save / Rename / Clear actions. |

## Design tokens

Defined as CSS variables at the top of `bt.css`:

- `--ink` background, `--paper` off-white, muted greys
- `--shock` = `#ff6f24` (red-orange) — the single accent: scope L-trace, macro
  fills/handles, active-tab spine, Stop Synth, undervoltage banner, section accents
- `--acid` = `#1f8bff` (electric blue) — secondary accent: LFO-01, Window wave
- `--ice` = `#cfe6ff` pale blue (CH_R trace, Formants, LFO-03); `--ok`, `--warn`
- Wordmark is **SP·I·LUTER** with the "PI" in `--shock` (a Raspberry **Pi** nod)

## Regenerating

Sources are plain HTML/CSS/JS rendered to PNG with headless Google Chrome at 2×.

```bash
cd updated_designs/src
./render.sh
```

Fonts used are macOS system fonts (DIN Condensed Bold, DIN Alternate Bold,
Helvetica Neue, Andale Mono). Override the browser with `CHROME=/path/to/chrome ./render.sh`.

## Files

- `bt.css` — shared design system + all component styles
- `bt.js` — canvas drawing for scope / waveform / LFO previews
- `01_perform.html`, `02_edit.html`, `03_mods.html`, `04_presets.html` — the four screens
- `render.sh` — renders all four to `../*.png`

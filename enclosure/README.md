# Spaluter Standalone — 3D-printed enclosure

Parametric enclosure for the **Raspberry Pi 4 + Pisound HAT + 5.5" HDMI
touchscreen** stack. Source model: [`spaluter_enclosure.scad`](./spaluter_enclosure.scad)
(OpenSCAD). Everything is driven by named variables at the top of the file.

> ⚠️ **Test-fit first.** Port cutout positions depend on how *your* Pi/Pisound
> stack seats and which 5.5" screen you buy. Print the throwaway `port_template`
> part and check every connector before printing the full case.

## Parts

| `part =`         | What it is                                   | Print orientation |
|------------------|----------------------------------------------|-------------------|
| `"base"`         | Tray: Pi standoffs, port cutouts, vents      | Floor **down** (as modeled) |
| `"lid"`          | Screen frame: window, top vents, screw holes | Top face **down** on the bed |
| `"port_template"`| Thin wall-only strip to verify port fit      | As modeled |
| `"both"`         | Both parts flat, side by side (preview only)  | — |
| `"assembly"`     | Lid on base (visual check, do **not** slice) | — |

## Exporting STLs

Requires [OpenSCAD](https://openscad.org). From this folder:

```bash
openscad -D 'part="base"'          -o base.stl          spaluter_enclosure.scad
openscad -D 'part="lid"'           -o lid.stl           spaluter_enclosure.scad
openscad -D 'part="port_template"' -o port_template.stl spaluter_enclosure.scad
```

For the final export bump quality with `-D '$fn=96'`.

## Recommended print settings (consumer FDM, 0.4 mm nozzle)

- **Material:** PETG preferred (heat tolerance near the Pi); PLA is fine if the
  unit is well ventilated. ABS/ASA for the most heat headroom.
- **Layer height:** 0.2 mm
- **Walls/perimeters:** 3 (matches the 3 mm wall thickness)
- **Top/bottom layers:** 4–5
- **Infill:** 15–20 % grid
- **Supports:** **None needed** if you print base floor-down and lid
  top-face-down. The screen ledge uses a 45° chamfer so it bridges cleanly.
- **Brim:** 5 mm recommended for the lid (thin frame can lift at corners).

Outer size ≈ **158 × 106 × 67 mm** — fits Ender 3 / Prusa Mini / Bambu A1 beds.

## Fasteners

| Use                    | Screw                    | Goes into            |
|------------------------|--------------------------|----------------------|
| Raspberry Pi to base   | 4 × M2.5 self-tapping    | Base standoff pilots |
| Lid to base            | 4 × M3 self-tapping ~12 mm | Corner boss pilots |

M3 heads recess into the lid counterbores. Pilot-hole diameters (`boss_pilot`,
`standoff_pilot`) are tuned for thread-forming into PETG/PLA; open them up
slightly for heat-set inserts if you prefer.

## Assembly order

1. Screw the Pi to the base standoffs (M2.5).
2. Fit the Pisound HAT onto the Pi's GPIO (its own standoffs).
3. Route the touchscreen's **HDMI + USB** cables up past the stack (there is
   ~20 mm of clearance behind the screen for this — see `in_h`).
4. Seat the screen face-down into the lid recess.
5. Lower the lid (registration lip aligns it) and drive the 4 M3 corner screws.

## Tuning the model for your hardware

All measurements are variables. The ones you are most likely to change:

- `pi_x`, `pi_y` — where the Pi sits inside the tray.
- `ports = [...]` — each entry is `[wall, pos, z-center, width, height]` with
  wall `L`/`R`/`F`/`B`. Nudge `pos`/`z-center` after the template print.
- `knob_pos`, `button_pos`, `knob_zc` — Pisound knobs/button holes.
- `scr_out_*` / `scr_cut_*` — swap in your exact 5.5" module + window sizes.
- `in_w`, `in_d`, `in_h` — internal cavity if you change the screen or need
  more cable room.

Ventilation is a floor intake grid + lid exhaust grid + upper side-wall slots
(chimney effect). Toggle with `vent_floor`, `vent_lid`, `vent_sidewalls`.

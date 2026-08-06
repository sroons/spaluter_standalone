/* =====================================================================
   SPALUTER STANDALONE — parametric enclosure
   Raspberry Pi 4  +  Pisound HAT  +  5.5" HDMI touchscreen
   ---------------------------------------------------------------------
   Two printable parts:  base()  (tray + standoffs + port cutouts + vents)
                         lid()   (screen frame + top vents + screw holes)

   Designed to slice/print on a consumer FDM printer (0.4mm nozzle):
     - Outer size ~158 x 106 x ~67 mm  (fits Ender 3 / Prusa Mini beds)
     - 3 mm walls  = 3+ perimeters, no infill dependence for strength
     - No supports required if oriented as noted in enclosure/README.md
     - M3 self-tapping screws join lid->base ; M2.5 screws mount the Pi

   IMPORTANT — READ BEFORE PRINTING FILAMENT:
     Port cutout POSITIONS depend on exactly how you seat the Pi/Pisound
     stack and which brand of 5.5" screen you use. Every port opening and
     board position below is a NAMED VARIABLE. Verify the numbers marked
     [MEASURE] against YOUR hardware with calipers, and print the throwaway
     "port_template" part first (see `part` options) to confirm the fit
     before committing to the full case. Openings are intentionally a touch
     generous so small errors still clear the connector.
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. RENDER SELECTOR
   --------------------------------------------------------------------- */
// "base"          -> print this (the tray)
// "lid"           -> print this (the screen frame)
// "both"          -> both parts laid flat for a preview / plate
// "assembly"      -> lid placed on base (visual check only, do NOT slice)
// "port_template" -> thin test strip of the port walls to test-fit first
part = "both";

$fn = 48;              // curve smoothness (bump to 96 for final STL export)
eps = 0.01;            // tiny overlap to keep booleans clean

/* ---------------------------------------------------------------------
   1. GLOBAL SHELL PARAMETERS
   --------------------------------------------------------------------- */
wall      = 3.0;       // side wall thickness
floor_th  = 3.0;       // base floor thickness
lid_th    = 3.0;       // lid top thickness
corner_r  = 6.0;       // outer corner radius (rounded box)
clr       = 0.4;       // general fit clearance

// Internal cavity (drives the outer size). Sized so the 5.5" screen fits
// on top and the Pi+Pisound stack fits underneath with cable room.
in_w = 152;            // X internal width
in_d = 100;            // Y internal depth
in_h = 61;             // Z internal height (floor top -> lid underside)

out_w = in_w + 2*wall;
out_d = in_d + 2*wall;

/* ---------------------------------------------------------------------
   2. RASPBERRY PI 4 MOUNTING  [MEASURE if using a different carrier]
   Board 85.6 x 56.5 mm. Mount holes: 58 x 49 mm grid, 3.5 mm edge inset.
   Long edge (85.6) runs along X. USB/Ethernet cluster faces +X (right).
   Power/micro-HDMI edge faces +Y (back).
   --------------------------------------------------------------------- */
pi_w          = 85.6;
pi_d          = 56.5;
pi_hole_dx    = 58;    // hole spacing in X
pi_hole_dy    = 49;    // hole spacing in Y
pi_hole_inset = 3.5;   // hole center from board edge
pi_x          = 10;    // board lower-left corner inside cavity (X)
pi_y          = 30;    // board lower-left corner inside cavity (Y)
pi_standoff_h = 5.0;   // Pi PCB height above the floor
standoff_od   = 6.0;   // standoff post diameter
standoff_pilot= 2.3;   // pilot hole for M2.5 self-tapping screw

/* ---------------------------------------------------------------------
   3. 5.5" TOUCHSCREEN  [MEASURE — brands vary]
   scr_out = physical module outline that must clear inside the lip.
   scr_cut = the visible window cut through the lid top face.
   Generic 5.5" ~ 128 x 74 mm module, ~121 x 68 mm active area.
   --------------------------------------------------------------------- */
scr_out_w   = 128;
scr_out_d   = 74;
scr_cut_w   = 121;
scr_cut_d   = 68;
scr_recess  = 2.2;     // depth the module face seats into the lid underside
scr_cx      = out_w/2; // screen center X (centered by default)
scr_cy      = out_d/2; // screen center Y

/* ---------------------------------------------------------------------
   4. PORT CUTOUTS  [MEASURE — positions depend on your stack seating]
   Each entry: [ wall, pos, zc, w, h ]
     wall : "L"(-X) "R"(+X) "F"(-Y) "B"(+Y)
     pos  : center position ALONG that wall (X for F/B, Y for L/R), in
            cavity-internal coords (0..in_w for F/B, 0..in_d for L/R)
     zc   : center height above the floor top
     w    : opening width  along the wall
     h    : opening height (Z)
   Openings have rounded corners (see port_window()).

   Default assumed layout:
     +X (Right)  : Pi USB x4 + Gigabit Ethernet (one wide window)
     +Y (Back)   : Pi USB-C power + 2x micro-HDMI (+ screen HDMI exits here)
     -X (Left)   : Pisound 1/4" IN + OUT jacks + MIDI IN/OUT DIN (Pisound tier)
   Knobs/button (Pisound) are round holes on -Y (Front): see knob params.
   --------------------------------------------------------------------- */

// Pi tier port center height above floor (PCB top ~ pi_standoff_h + 1.5):
pi_port_zc  = pi_standoff_h + 1.5 + 6.5;   // ~ USB/RJ45 body center
hdmi_zc     = pi_standoff_h + 1.5 + 3.0;   // low-profile USB-C/HDMI center

// Pisound tier sits on ~11 mm standoffs above the Pi PCB:
ps_pcb_z    = pi_standoff_h + 1.5 + 11 + 1.5;   // Pisound PCB top height
ps_port_zc  = ps_pcb_z + 7;                     // 1/4" / DIN body center

ports = [
  // ---- Pi USB x4 + Ethernet (Right wall, +X) ----
  [ "R", pi_y + pi_d/2,        pi_port_zc, 52, 17 ],
  // ---- Pi power + micro-HDMI x2 (Back wall, +Y) ----
  [ "B", pi_x + 21,            hdmi_zc,    42, 12 ],
  // ---- Pisound audio jacks + MIDI DIN (Left wall, -X) ----
  [ "L", pi_y + pi_d/2,        ps_port_zc, 58, 24 ],
];

// Pisound knobs + button — round holes on the Front wall (-Y).
knob_d       = 9;      // through-hole for potentiometer/encoder bushing
button_d     = 13;     // "The Button" (or its cap) clearance
knob_zc      = ps_pcb_z + 4;                 // height above floor
knob_pos     = [ pi_x + 20, pi_x + 40 ];     // X centers of the two knobs
button_pos   = pi_x + 62;                    // X center of the button

/* ---------------------------------------------------------------------
   5. VENTILATION  (chimney: cool air in through floor, out through lid)
   --------------------------------------------------------------------- */
vent_floor      = true;   // intake grid under the Pi
vent_lid        = true;   // exhaust grid on the lid top
vent_sidewalls  = true;   // upper slot rows on front & back walls
vent_slot_w     = 3;      // slot width
vent_slot_gap   = 4;      // gap between slots

/* ---------------------------------------------------------------------
   6. LID / BASE JOINT — 4 corner screw bosses (M3 self-tap)
   --------------------------------------------------------------------- */
boss_inset   = corner_r + 4;   // boss center inset from outer corner
boss_od      = 8.0;
boss_pilot   = 2.6;            // M3 self-tapping pilot
lid_screw_cl = 3.4;           // M3 clearance hole in lid
lid_cbore_d  = 6.2;           // countersink/counterbore for M3 head
lid_cbore_h  = 3.0;

boss_pts = [
  [ boss_inset,          boss_inset          ],
  [ out_w - boss_inset,  boss_inset          ],
  [ boss_inset,          out_d - boss_inset  ],
  [ out_w - boss_inset,  out_d - boss_inset  ],
];

/* =====================================================================
   HELPERS
   ===================================================================== */

// 2D rounded rectangle spanning (0,0)-(w,d), corner radius r.
module rrect(w, d, r) {
  rr = min(r, w/2, d/2);
  hull() for (x = [rr, w-rr], y = [rr, d-rr]) translate([x, y]) circle(rr);
}

// Rounded-corner rectangular hole cut through a wall.
// wall in {L,R,F,B}; pos along wall; zc center height; w,h opening size.
module port_window(w_id, pos, zc, w, h) {
  r  = min(3, h/2, w/2);
  ov = wall + 2*eps;             // cut fully through the wall
  if (w_id == "F")       // -Y wall, normal along Y
    translate([wall + pos, wall/2, floor_th])
      port_slab_yz(w,h,zc,r,ov,true);
  else if (w_id == "B")  // +Y wall
    translate([wall + pos, out_d - wall/2, floor_th])
      port_slab_yz(w,h,zc,r,ov,false);
  else if (w_id == "L")  // -X wall
    translate([wall/2, wall + pos, floor_th])
      port_slab_xz(w,h,zc,r,ov,true);
  else if (w_id == "R")  // +X wall
    translate([out_w - wall/2, wall + pos, floor_th])
      port_slab_xz(w,h,zc,r,ov,false);
}

// Rounded rectangular prism used as a cutter, opening faces +/-Y.
module port_slab_yz(w, h, zc, r, ov, neg) {
  translate([0, 0, zc])
    rotate([90, 0, 0])
      linear_extrude(ov, center=true)
        offset(r) offset(-r) square([w, h], center=true);
}

// Rounded rectangular prism used as a cutter, opening faces +/-X.
module port_slab_xz(w, h, zc, r, ov, neg) {
  translate([0, 0, zc])
    rotate([0, 90, 0])
      linear_extrude(ov, center=true)
        offset(r) offset(-r) square([h, w], center=true);
}

// Round through-hole in the front (-Y) wall.
module front_round_hole(x, zc, dia) {
  translate([wall + x, wall/2, floor_th + zc])
    rotate([90, 0, 0])
      cylinder(h = wall + 2*eps, d = dia, center = true);
}

// Slot cutter for wall vents on front(-Y)/back(+Y) walls.
module wall_vent_row(y_face, z0, z1, x0, x1) {
  n = floor((x1 - x0) / (vent_slot_w + vent_slot_gap));
  for (i = [0 : n-1]) {
    xc = x0 + vent_slot_w/2 + i*(vent_slot_w + vent_slot_gap);
    translate([xc, y_face, floor_th + (z0+z1)/2])
      cube([vent_slot_w, wall + 2*eps, (z1 - z0)], center = true);
  }
}

// Rectangular slot grid used for floor (z-cut) and lid (z-cut) vents.
module panel_vent_grid(w, d, z, thick) {
  slot_len = 26;
  nx = floor(w / (vent_slot_w + vent_slot_gap));
  ny = floor(d / (slot_len + vent_slot_gap));
  x0 = (w - (nx*(vent_slot_w+vent_slot_gap) - vent_slot_gap)) / 2;
  y0 = (d - (ny*(slot_len+vent_slot_gap) - vent_slot_gap)) / 2;
  for (i = [0:nx-1], j = [0:ny-1])
    translate([ x0 + i*(vent_slot_w+vent_slot_gap) + vent_slot_w/2,
                y0 + j*(slot_len+vent_slot_gap)     + slot_len/2,
                z ])
      cube([vent_slot_w, slot_len, thick + 2*eps], center = true);
}

/* =====================================================================
   BASE (tray)
   ===================================================================== */
module base() {
  difference() {
    union() {
      // --- hollow rounded shell, open top ---
      difference() {
        linear_extrude(floor_th + in_h) rrect(out_w, out_d, corner_r);
        translate([wall, wall, floor_th])
          linear_extrude(in_h + 1)
            rrect(in_w, in_d, max(0.5, corner_r - wall));
      }
      // --- Pi standoffs ---
      for (dx = [0, pi_hole_dx], dy = [0, pi_hole_dy])
        translate([ pi_x + pi_hole_inset + dx,
                    pi_y + pi_hole_inset + dy, floor_th ])
          cylinder(h = pi_standoff_h, d = standoff_od);
      // --- corner screw bosses (full cavity height) ---
      for (p = boss_pts)
        translate([p[0], p[1], floor_th])
          cylinder(h = in_h, d = boss_od);
    }

    // --- Pi standoff pilot holes ---
    for (dx = [0, pi_hole_dx], dy = [0, pi_hole_dy])
      translate([ pi_x + pi_hole_inset + dx,
                  pi_y + pi_hole_inset + dy, floor_th - eps ])
        cylinder(h = pi_standoff_h + 2*eps, d = standoff_pilot);

    // --- boss pilot holes (screw enters from lid on top) ---
    for (p = boss_pts)
      translate([p[0], p[1], floor_th + in_h - 12])
        cylinder(h = 12 + eps, d = boss_pilot);

    // --- port cutouts ---
    for (pt = ports) port_window(pt[0], pt[1], pt[2], pt[3], pt[4]);

    // --- Pisound knobs + button (front wall) ---
    for (kx = knob_pos) front_round_hole(kx, knob_zc, knob_d);
    front_round_hole(button_pos, knob_zc, button_d);

    // --- floor intake vents (under the Pi) ---
    if (vent_floor)
      translate([wall, wall, 0])
        panel_vent_grid(in_w, in_d, floor_th/2, floor_th);

    // --- upper side-wall vent rows (front & back, above the ports) ---
    if (vent_sidewalls) {
      wall_vent_row(wall/2,           in_h - 12, in_h - 4, wall+6, out_w-wall-6); // front
      wall_vent_row(out_d - wall/2,   in_h - 12, in_h - 4, wall+6, out_w-wall-6); // back
    }
  }
}

/* =====================================================================
   LID (screen frame)
   ===================================================================== */
module lid() {
  difference() {
    union() {
      // top plate
      linear_extrude(lid_th) rrect(out_w, out_d, corner_r);
      // registration lip that drops into the cavity for alignment
      translate([wall + clr, wall + clr, -4])
        linear_extrude(4)
          difference() {
            rrect(in_w - 2*clr, in_d - 2*clr, max(0.5, corner_r - wall));
            translate([2,2]) rrect(in_w - 2*clr - 4, in_d - 2*clr - 4,
                                   max(0.5, corner_r - wall - 2));
          }
    }

    // --- screen visible window (through the top face) ---
    translate([scr_cx - scr_cut_w/2, scr_cy - scr_cut_d/2, -eps])
      cube([scr_cut_w, scr_cut_d, lid_th + 2*eps]);

    // --- screen module recess on the underside + 45° chamfer lead-in
    //     (chamfer prints support-free when lid is printed top-face-down) ---
    hull() {
      translate([scr_cx, scr_cy, lid_th - scr_recess])
        linear_extrude(eps) square([scr_cut_w, scr_cut_d], center=true);
      translate([scr_cx, scr_cy, lid_th + eps])
        linear_extrude(eps) square([scr_out_w, scr_out_d], center=true);
    }
    translate([scr_cx, scr_cy, lid_th - scr_recess - eps])
      linear_extrude(scr_recess + 2*eps)
        square([scr_out_w, scr_out_d], center=true);

    // --- corner screw clearance holes + head counterbores ---
    for (p = boss_pts) {
      translate([p[0], p[1], -eps])
        cylinder(h = lid_th + 2*eps, d = lid_screw_cl);
      translate([p[0], p[1], -eps])
        cylinder(h = lid_cbore_h + eps, d = lid_cbore_d);
    }

    // --- lid exhaust vents (avoid the screen footprint) ---
    if (vent_lid) {
      // left band
      translate([wall+2, wall, 0])
        intersection() {
          panel_vent_grid(scr_cx - scr_out_w/2 - wall - 4, in_d, lid_th/2, lid_th);
          cube([scr_cx - scr_out_w/2 - wall - 4, in_d, lid_th+1]);
        }
      // right band
      translate([scr_cx + scr_out_w/2 + 4, wall, 0])
        panel_vent_grid(out_w - (scr_cx + scr_out_w/2 + 4) - wall - 2, in_d,
                        lid_th/2, lid_th);
    }
  }
}

/* =====================================================================
   PORT TEST TEMPLATE — thin, fast throwaway print to check port fit
   ===================================================================== */
module port_template() {
  h = ps_port_zc + 20;    // tall enough to include the highest opening
  difference() {
    // a short section of all four walls only (no floor detail)
    linear_extrude(h) difference() {
      rrect(out_w, out_d, corner_r);
      translate([wall, wall]) rrect(in_w, in_d, max(0.5, corner_r - wall));
    }
    for (pt = ports) port_window(pt[0], pt[1], pt[2], pt[3], pt[4]);
    for (kx = knob_pos) front_round_hole(kx, knob_zc, knob_d);
    front_round_hole(button_pos, knob_zc, button_d);
  }
}

/* =====================================================================
   PLATE / PREVIEW SELECTION
   ===================================================================== */
if (part == "base")            base();
else if (part == "lid")        lid();
else if (part == "port_template") port_template();
else if (part == "assembly") {
  base();
  translate([0, 0, floor_th + in_h]) lid();
}
else {  // "both" — laid out flat, side by side, for a preview
  base();
  translate([out_w + 15, 0, 0]) lid();
}

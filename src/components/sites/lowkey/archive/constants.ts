// Adapted from lowkey-archive-template, Copyright (c) 2026 The Lowkey Archive Template Contributors, MIT License.
// ============================================================
// constants — verbatim port of the skill template's T object,
// shell recipes, and the 7 published collection shell mapping.
// ============================================================

import type { ShellKey } from '../data';

export interface ShellRecipe {
  color: number;            // 0xRRGGBB
  trayColor: number;        // opaque, matte rear tray
  transmission: number;
  roughness: number;
  ior: number;
}

export const SHELLS: Record<ShellKey, ShellRecipe> = {
  // The broad faces stay almost colourless. These saturated values are used
  // by the cut edges and attenuation path, where real acrylic accumulates
  // colour, rather than as a flat tint across the artwork.
  clear:    { color: 0xd8d6cf, trayColor: 0xbfc2bd, transmission: 0.82, roughness: 0.08, ior: 1.49 },
  frosted:  { color: 0xdedbd2, trayColor: 0xc9c5bb, transmission: 0.46, roughness: 0.28, ior: 1.49 },
  smoked:   { color: 0x343633, trayColor: 0x1c1f1e, transmission: 0.52, roughness: 0.12, ior: 1.49 },
  paleIce:  { color: 0x89b8c6, trayColor: 0x789eaa, transmission: 0.84, roughness: 0.07, ior: 1.49 },
  ice:      { color: 0x155be8, trayColor: 0x102d78, transmission: 0.68, roughness: 0.08, ior: 1.49 },
  amber:    { color: 0xc58319, trayColor: 0x7f4a0b, transmission: 0.66, roughness: 0.08, ior: 1.49 },
  dichroic: { color: 0x8550b5, trayColor: 0x58306f, transmission: 0.70, roughness: 0.09, ior: 1.50 },
  milky:    { color: 0xe5e1d8, trayColor: 0xc9c4b9, transmission: 0.35, roughness: 0.30, ior: 1.48 }
};

export const T = {
  // Calibrated against one 836 × 941 reference panel. At the current
  // camera/FOV this projects to a ~189 × 414 px face when opened.
  CASE_W: (2.12 * 0.936 * 9) / (16 * 0.890),
  CASE_H: 2.12,
  THICK: 0.180,
  // One closed 180 mm visual stack: machined rear plate, removable inner
  // tray, a readable air chamber, then the polished front door. Keeping the
  // sum exact preserves every existing hit volume and row-layout calibration.
  BACK_THICK: 0.050,
  TRAY_THICK: 0.024,
  AIR_GAP: 0.054,
  LID_THICK: 0.052,
  // The seven roots project at roughly 102 px intervals in the reference
  // viewport. The progressively larger yaw exposes wider outer cases.
  GAP: 0.55,
  ROW_TILT_WIDE: 0.227,
  ROW_TILT_NARROW: 0.314,
  ROW_TILT_MOBILE: 0.279,
  ROW_TILT_POWER_WIDE: 0.28,
  ROW_TILT_POWER_NARROW: 0.45,
  ROW_INNER_COMPRESSION: 0.10,
  PUSH: 1.00,
  CAMERA_Z: 8.20,
  CAMERA_Z_WIDE: 6.72,
  CAMERA_Y: 0.16,
  CAMERA_Y_WIDE: 0.18,
  FOV: 31,
  PARALLAX: 0.014,
  // Approved full-width optical centre. Do not fold this into the responsive
  // slot spread: it is the six-pixel museum-display bias measured at 1672px.
  RAIL_X: 0.022,
  RAIL_Z: -0.50,
  DISPLAY_RAIL_X: -0.038,
  DISPLAY_RAIL_W: 3.92,
  DISPLAY_RAIL_EDGE_W: 4.02,
  DISPLAY_RAIL_Y_OFFSET: -0.007,
  DISPLAY_RAIL_EDGE_Y_OFFSET: -0.035,
  FOCUS_X: 0.028,
  // Lift the opened case clear of the display rail instead of letting its
  // enlarged bottom edge meet the glass support.
  FOCUS_Y: 0.11,
  // Card-local value; combined with RAIL_Z this places the open face at
  // world z=-0.05, a restrained move toward the camera.
  FOCUS_Z: 0.40,
  // Door-only projection calibration. The shallower yaw and horizontal
  // compensation match the measured open trapezoid without moving the case.
  OPEN_ANGLE: -1.91,
  OPEN_PITCH: -0.024,
  OPEN_SCALE_X: 1.15,
  OPEN_SCALE_Y: 1.008,
  OPEN_HINGE_X: -0.051,
  OPEN_HINGE_Y: 0.008,
  BACKGROUND_FADE: 0.12,
} as const;

// Isolated entrance calibration. These values transform the existing case
// roots; the approved case geometry and open-state measurements stay intact.
export const ENTRANCE = {
  INTRO_SCALE: 0.72,
  FOCUS_SCALE: 0.77,
  FINAL_SCALE: 0.80,
  DEPTH_GAP: 0.205,
  HORIZONTAL_GAP: 0.205,
  VERTICAL_GAP: 0.012,
  INTRO_YAW: -0.075,
  FOCUS_PUSH: 0.115,
  TRIGGER_PROGRESS: 0.16,
  UNFOLD_RATE: 0.96,
  RAIL_REVEAL_START: 0.52,
} as const;

// Perceptually white rather than emissive #fff. Keeping a trace of warmth
// lets transparent edges and neutral contact shadows remain visible.
export const ARCHIVE_WHITE = 0x000000;

export const FOG = { color: 0x000000, near: 9.5, far: 18 } as const;
export const RAIL_Y = 0.060;
// Keep the glass plinth below the caption and transport controls.
export const FLOOR_Y = RAIL_Y - T.CASE_H / 2 - 0.60;
export const PAPER = 0x000000;

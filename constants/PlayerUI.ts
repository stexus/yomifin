/** Shared mobile player interaction policy. */
export const PLAYER_CONTROLS_TIMEOUT_MS = 5_000;
export const PLAYER_CONTROLS_ANIMATION_MS = 300;
export const SUBTITLE_SYNC_OFFSETS = [
  -5, -2, -1, -0.5, -0.25, 0, 0.25, 0.5, 1, 2, 5,
];
export const SUBTITLE_SCALE_MIN = 0.1;
export const SUBTITLE_SCALE_MAX = 3;
export const SUBTITLE_SCALE_STEPS = 29;
export const OVERLAY_FONT_STEPS = [24, 28, 32, 38, 44] as const;
export const OVERLAY_WEIGHT_STEPS = [
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
] as const;
export const OVERLAY_OUTLINE_STEPS = [
  "none",
  "thin",
  "normal",
  "strong",
] as const;
export const OVERLAY_OFFSET_STEPS = [24, 48, 64, 96, 128] as const;

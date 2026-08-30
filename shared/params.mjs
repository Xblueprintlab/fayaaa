// Shared between the browser playground (via Vite) and the headless render
// script (plain Node) — keep this file dependency-free ESM with JSDoc types.

export const SDF_RES = 1024;
export const DEFAULT_SHAPE_ASPECT = 0.62;

// The fire look — the canonical default, found live in the playground
// (2026-08-28). Charcoal body, edge burning from one side, fast shimmer,
// heavy grain. Colors are sRGB hex; the GPU gets linear-light vec3s via
// emberUniform().
export const EMBER_DEFAULTS = {
  baseColor: "#160b04", topLight: 1.25,
  rimColor: "#ffece4", rimWidth: 0.0005,
  hotColor: "#ff5a1e", rimIntensity: 0,
  coolColor: "#7a1004", glowSpread: 0.005,
  bgColor: "#180e01", glowIntensity: 2.65,
  shadeFalloff: 3.2, sheenWidth: 0.035, sheenStrength: 0.83, innerGlow: 1.11,
  heatFalloff: 4.3, flickerAmount: 0.12, flickerSpeed: 0.8, waverAmount: 0.0095,
  waverScale: 60, grainAmount: 0.22, grainScale: 1.6, grainSpeed: 0.4,
  vignetteStrength: 0, vignetteRadius: 0.95, exposure: 0.05, rimSoftness: 0,
  edgeSharpness: 0.85,
};

export const SHAPE_DEFAULTS = {
  scale: 0.46,
  offsetX: 0,
  offsetY: 0.01,
  threshold: 0.98,
  softness: 0,
  invert: false,
  maskMode: "alpha", // alpha | auto | dark | bright
};

// heatAngle: which side burns — degrees, 0 = bottom, 90 = right, 180 = top,
// 270 = left. Lives outside EMBER_DEFAULTS because it feeds the composite's
// globals (it needs the shape rect), not the EmberParams uniform.
export const SCENE_DEFAULTS = { speed: 0.8, heatAngle: 64 };

/** @returns {[number, number]} unit vector toward the hot side (uv space, y down) */
export function heatDirection(angleDeg) {
  const rad = (Number(angleDeg) * Math.PI) / 180;
  return [Math.sin(rad), Math.cos(rad)];
}

export const DEFAULTS = { ...EMBER_DEFAULTS, ...SHAPE_DEFAULTS, ...SCENE_DEFAULTS };

/** @param {string} hex @returns {[number, number, number]} linear-light rgb */
export function hexToLinearRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [
    toLinear(((n >> 16) & 0xff) / 255),
    toLinear(((n >> 8) & 0xff) / 255),
    toLinear((n & 0xff) / 255),
  ];
}

const COLOR_KEYS = ["baseColor", "rimColor", "hotColor", "coolColor", "bgColor"];

// State -> the EmberParams uniform bag, keyed exactly by the WGSL field names.
export function emberUniform(state) {
  const out = {};
  for (const key of Object.keys(EMBER_DEFAULTS)) {
    out[key] = COLOR_KEYS.includes(key) ? hexToLinearRgb(state[key]) : state[key];
  }
  return out;
}

// The logo's box in SDF uv space: contain-fit `imageAspect` into a centered
// square of side `scale`, then apply the user offset.
export function computeRect(imageAspect, state) {
  const w = imageAspect >= 1 ? state.scale : state.scale * imageAspect;
  const h = imageAspect >= 1 ? state.scale / imageAspect : state.scale;
  const cx = 0.5 + state.offsetX;
  const cy = 0.5 + state.offsetY;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

// One mask texel expressed in logo-uv units, for mask-image's smoothing kernel.
export function maskTexel(rect) {
  const ext = [Math.max(rect[2] - rect[0], 1e-5), Math.max(rect[3] - rect[1], 1e-5)];
  return [1 / (SDF_RES * ext[0]), 1 / (SDF_RES * ext[1])];
}

/** @returns {number} the MaskParams.mode value */
export function maskModeValue(maskMode, hasAlpha) {
  if (maskMode === "alpha") return 0;
  if (maskMode === "dark") return 1;
  if (maskMode === "bright") return 2;
  return hasAlpha ? 0 : 1; // auto
}

// Choose a useful mask without exposing image-processing jargon in the UI.
// Transparent assets use alpha. Flattened assets inspect their outer band:
// a light surround implies dark artwork, while a dark surround implies light
// artwork. This covers the common logo/icon cases without a manual selector.
export function inferMaskMode(pixels, width, height) {
  let hasAlpha = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 250) {
      hasAlpha = true;
      break;
    }
  }
  if (hasAlpha) return "alpha";

  const band = Math.max(1, Math.round(Math.min(width, height) * 0.04));
  let luminance = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const offset = (y * width + x) * 4;
      luminance += pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
      count += 1;
    }
  }
  return count > 0 && luminance / count >= 127.5 ? "dark" : "bright";
}

// Jump schedule from the verified radiance-cascades example: size/2 ... 1,
// plus two extra 1-jumps to clean up stragglers.
export function computeJumps(res) {
  const count = Math.ceil(Math.log2(Math.max(res, 2)));
  return [
    ...Array.from({ length: count }, (_, i) => Math.max(1, 2 ** (count - i - 1))),
    1,
    1,
  ];
}

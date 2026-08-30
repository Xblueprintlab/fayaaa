import { expect, it } from "vitest";
// @ts-expect-error TypeScript does not infer declarations across the .mjs boundary.
import { DEFAULTS } from "../shared/params.mjs";
// @ts-expect-error TypeScript does not infer declarations across the .mjs boundary.
import { PRESETS } from "../shared/presets.mjs";

const FIRE_REFERENCE = {
  baseColor: "#160b04",
  topLight: 1.25,
  rimColor: "#ffece4",
  rimWidth: 0.0005,
  hotColor: "#ff5a1e",
  rimIntensity: 0,
  coolColor: "#7a1004",
  glowSpread: 0.005,
  bgColor: "#180e01",
  glowIntensity: 2.65,
  shadeFalloff: 3.2,
  sheenWidth: 0.035,
  sheenStrength: 0.83,
  innerGlow: 1.11,
  heatFalloff: 4.3,
  flickerAmount: 0.12,
  flickerSpeed: 0.8,
  waverAmount: 0.0095,
  waverScale: 60,
  grainAmount: 0.22,
  grainScale: 1.6,
  grainSpeed: 0.4,
  vignetteStrength: 0,
  vignetteRadius: 0.95,
  exposure: 0.05,
  rimSoftness: 0,
  edgeSharpness: 0.85,
  scale: 0.46,
  offsetX: 0,
  offsetY: 0.01,
  threshold: 0.98,
  softness: 0,
  invert: false,
  maskMode: "alpha",
  speed: 0.8,
  heatAngle: 64,
};

it("keeps the exact Fire reference as both defaults and the named preset", () => {
  expect(DEFAULTS).toEqual(FIRE_REFERENCE);
  expect(PRESETS.fire).toEqual(FIRE_REFERENCE);
});

import { fileURLToPath } from "node:url";
import { resolveShader } from "@vgpu/wgsl/runtime";
import { effect, init, target } from "vgpu/node";
import { expect, it } from "vitest";

const SIZE = 64;

// One value for every EmberParams field — the WGSL names are the contract.
const EMBER_PARAMS = {
  baseColor: [0.7, 0.62, 0.68], topLight: 1.1,
  rimColor: [1.0, 0.94, 0.9], rimWidth: 0.004,
  hotColor: [1.0, 0.35, 0.08], rimIntensity: 1.5,
  coolColor: [0.45, 0.05, 0.02], glowSpread: 0.05,
  bgColor: [0.015, 0.03, 0.015], glowIntensity: 1.4,
  shadeFalloff: 2.2, sheenWidth: 0.05, sheenStrength: 0.5, innerGlow: 0.5,
  heatFalloff: 6.0, flickerAmount: 0.0, flickerSpeed: 1.0, waverAmount: 0.0,
  waverScale: 14.0, grainAmount: 0.04, grainScale: 1.5, grainSpeed: 0.0,
  vignetteStrength: 0.5, vignetteRadius: 0.9, exposure: 0.0, rimSoftness: 0.25,
  edgeSharpness: 0.85,
};

async function renderEntry(
  fixture: string,
  set: Record<string, unknown>,
): Promise<Uint8Array> {
  const entry = fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url));
  const resolved = await resolveShader({ entry });
  const gpu = await init();
  try {
    const colorTarget = target(gpu, { size: [SIZE, SIZE] });
    const fx = effect(gpu, resolved.wgsl, { set });
    fx.draw(colorTarget);
    const pixels = await colorTarget.read();
    await gpu.settled();
    return Uint8Array.from(pixels);
  } finally {
    gpu.dispose();
  }
}

it("jfa helpers produce exact known values", async () => {
  const pixels = await renderEntry("jfa-entry.wgsl", {});
  for (let i = 0; i < pixels.length; i += 4) {
    expect([pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]).toEqual([255, 255, 255, 255]);
  }
});

it("ember composite renders non-trivial, opaque pixels", async () => {
  const pixels = await renderEntry("ember-entry.wgsl", {
    params: EMBER_PARAMS,
    frameData: { time: 0.5 },
  });
  expect(pixels.length).toBe(SIZE * SIZE * 4);

  let colorSum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    colorSum += pixels[i] + pixels[i + 1] + pixels[i + 2];
    expect(pixels[i + 3]).toBe(255);
  }
  expect(colorSum).toBeGreaterThan(0);

  // The bottom must burn hotter than the top. The glow is orange (red >> blue)
  // while the rim is near-white (red ~ blue), so summed red-minus-blue isolates
  // heat and must dominate in the bottom half.
  let topHeat = 0;
  let bottomHeat = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = (y * SIZE + x) * 4;
      const heat = pixels[i] - pixels[i + 2];
      if (y < SIZE / 2) topHeat += heat;
      else bottomHeat += heat;
    }
  }
  expect(bottomHeat).toBeGreaterThan(topHeat * 2);
});

it("ember composite renders deterministically for a fixed time", async () => {
  const set = { params: EMBER_PARAMS, frameData: { time: 1.25 } };
  const a = await renderEntry("ember-entry.wgsl", set);
  const b = await renderEntry("ember-entry.wgsl", set);
  expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
});

import { expect, it } from "vitest";
// @ts-expect-error TypeScript does not infer declarations across the .mjs boundary.
import { inferMaskMode } from "../shared/params.mjs";

function solid(width: number, height: number, value: number, alpha = 255): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
    pixels[i + 3] = alpha;
  }
  return pixels;
}

it("uses alpha when the source contains transparency", () => {
  expect(inferMaskMode(solid(8, 8, 20, 0), 8, 8)).toBe("alpha");
});

it("finds dark artwork on a light flattened background", () => {
  expect(inferMaskMode(solid(8, 8, 245), 8, 8)).toBe("dark");
});

it("finds light artwork on a dark flattened background", () => {
  expect(inferMaskMode(solid(8, 8, 10), 8, 8)).toBe("bright");
});

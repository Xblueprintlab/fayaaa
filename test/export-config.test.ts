import { describe, expect, it } from "vitest";
import {
  chooseVideoFormat,
  clampFrame,
  exportAspect,
  exportDimensions,
  exportFrameParams,
} from "../src/export-config";

it("maps every output ratio to its exact canvas aspect", () => {
  expect(exportAspect("16:9")).toBe(16 / 9);
  expect(exportAspect("1:1")).toBe(1);
  expect(exportAspect("4:5")).toBe(4 / 5);
  expect(exportAspect("9:16")).toBe(9 / 16);
});

describe("export configuration", () => {
  it("returns deliberate pixel dimensions for every sharing ratio", () => {
    expect(exportDimensions({ ratio: "16:9", quality: "high" })).toEqual([1920, 1080]);
    expect(exportDimensions({ ratio: "1:1", quality: "max" })).toEqual([1440, 1440]);
    expect(exportDimensions({ ratio: "4:5", quality: "high" })).toEqual([1080, 1350]);
    expect(exportDimensions({ ratio: "9:16", quality: "standard" })).toEqual([720, 1280]);
  });

  it("selects H.264 MP4 first and only falls back when AVC is unavailable", () => {
    expect(chooseVideoFormat(["vp9", "avc"])).toEqual({ format: "mp4", codec: "avc" });
    expect(chooseVideoFormat(["vp9"])).toEqual({ format: "webm", codec: "vp9" });
    expect(chooseVideoFormat([])).toBeUndefined();
  });

  it("keeps framing offsets inside the exportable crop", () => {
    expect(clampFrame(2)).toBe(1);
    expect(clampFrame(-2)).toBe(-1);
    expect(clampFrame(0.25)).toBe(0.25);
  });

  it("applies one deterministic frame transform for previews and exports", () => {
    expect(exportFrameParams(
      { scale: 0.46, offsetX: 0.05, offsetY: -0.03 },
      { scale: 1.4, frameX: -0.75, frameY: 0.5 },
    )).toEqual({
      scale: 0.644,
      offsetX: 0.185,
      offsetY: -0.12,
    });
  });
});

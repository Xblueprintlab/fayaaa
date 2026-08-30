import { describe, expect, it } from "vitest";
import { chooseVideoFormat, clampFrame, exportDimensions } from "../src/export-config";

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
});

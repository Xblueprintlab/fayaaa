import { describe, expect, it } from "vitest";
import {
  isPersistedPlaygroundAsset,
  MAX_PERSISTED_ASSET_BYTES,
  normalizeLoadedPlaygroundAsset,
} from "../src/playground-persistence";

describe("persisted playground assets", () => {
  const valid = () => ({
    version: 2 as const,
    blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
    name: "subject.png",
  });

  it("accepts only the current bounded PNG record", () => {
    expect(isPersistedPlaygroundAsset(valid())).toBe(true);
    expect(isPersistedPlaygroundAsset({ blob: valid().blob, name: "legacy.png" })).toBe(false);
    expect(isPersistedPlaygroundAsset({ ...valid(), blob: new Blob(["x"], { type: "image/jpeg" }) })).toBe(false);
    expect(isPersistedPlaygroundAsset({ ...valid(), blob: new Blob([new Uint8Array(MAX_PERSISTED_ASSET_BYTES + 1)], { type: "image/png" }) })).toBe(false);
    expect(isPersistedPlaygroundAsset({ ...valid(), name: "" })).toBe(false);
  });

  it("returns bounded legacy records for validation and migration", () => {
    const legacy = { blob: new Blob(["legacy"], { type: "image/jpeg" }), name: "legacy.jpg" };
    expect(normalizeLoadedPlaygroundAsset(legacy)).toEqual({ version: 1, ...legacy });
    expect(normalizeLoadedPlaygroundAsset({ ...legacy, blob: new Blob([]) })).toBeUndefined();
  });
});

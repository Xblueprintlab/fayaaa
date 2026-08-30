import { describe, expect, it } from "vitest";
import {
  assertSafeImageDimensions,
  MAX_IMAGE_BYTES,
  validateImageInput,
} from "../src/image-input";

function png(width: number, height: number): Blob {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes], { type: "image/png" });
}

function jpeg(width: number, height: number): Blob {
  const bytes = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  return new Blob([bytes], { type: "image/jpeg" });
}

function webp(width: number, height: number): Blob {
  const bytes = new Uint8Array(30);
  bytes.set([..."RIFF"].map((value) => value.charCodeAt(0)), 0);
  bytes.set([..."WEBP"].map((value) => value.charCodeAt(0)), 8);
  bytes.set([..."VP8X"].map((value) => value.charCodeAt(0)), 12);
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes.set([encodedWidth & 0xff, (encodedWidth >>> 8) & 0xff, (encodedWidth >>> 16) & 0xff], 24);
  bytes.set([encodedHeight & 0xff, (encodedHeight >>> 8) & 0xff, (encodedHeight >>> 16) & 0xff], 27);
  return new Blob([bytes], { type: "image/webp" });
}

describe("image input validation", () => {
  it.each([
    [png(1024, 1024), "image/png"],
    [jpeg(640, 480), "image/jpeg"],
    [webp(320, 240), "image/webp"],
  ])("accepts a bounded image header", async (blob, mime) => {
    await expect(validateImageInput(blob)).resolves.toMatchObject({ mime });
  });

  it("rejects oversized dimensions before browser decode", async () => {
    await expect(validateImageInput(png(8192, 8192))).rejects.toThrow("dimensions");
    await expect(validateImageInput(jpeg(8192, 8192))).rejects.toThrow("dimensions");
    await expect(validateImageInput(webp(8192, 8192))).rejects.toThrow("dimensions");
  });

  it("rejects unsupported, empty, mismatched, and oversized files", async () => {
    await expect(validateImageInput(new Blob(["GIF89a"], { type: "image/gif" }))).rejects.toThrow("file type");
    await expect(validateImageInput(new Blob([], { type: "image/png" }))).rejects.toThrow("empty");
    await expect(validateImageInput(new Blob(["not png"], { type: "image/png" }))).rejects.toThrow("signature");
    await expect(validateImageInput(new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: "image/png" }))).rejects.toThrow("size");
  });

  it("allows simple bounded SVG and rejects active or expensive SVG", async () => {
    const simple = new Blob(['<svg viewBox="0 0 128 128"><path d="M0 0h1v1z"/></svg>'], { type: "image/svg+xml" });
    await expect(validateImageInput(simple)).resolves.toMatchObject({ mime: "image/svg+xml", width: 128, height: 128 });
    const external = new Blob(['<svg><image href="https://example.com/x.png"/></svg>'], { type: "image/svg+xml" });
    await expect(validateImageInput(external)).rejects.toThrow("unsupported element");
    const externalUse = new Blob(['<svg><use href="https://example.com/x.svg#x"/></svg>'], { type: "image/svg+xml" });
    await expect(validateImageInput(externalUse)).rejects.toThrow("external reference");
    const internal = new Blob(['<svg><defs><path id="x" d="M0 0"/></defs><use href="#x"/></svg>'], { type: "image/svg+xml" });
    await expect(validateImageInput(internal)).resolves.toMatchObject({ mime: "image/svg+xml" });
    const recursive = new Blob(['<svg><g id="x"><use href="#x"/></g></svg>'], { type: "image/svg+xml" });
    await expect(validateImageInput(recursive)).rejects.toThrow("unsafe composed");
    const selfReferentialUse = new Blob(['<svg><use id="x" href="#x"/></svg>'], { type: "image/svg+xml" });
    await expect(validateImageInput(selfReferentialUse)).rejects.toThrow("unsafe composed");
    const useCycle = new Blob(['<svg><use id="x" href="#y"/><use id="y" href="#x"/></svg>'], { type: "image/svg+xml" });
    await expect(validateImageInput(useCycle)).rejects.toThrow("unsafe composed");
    const useChain = new Blob(['<svg><path id="shape" d="M0 0"/><use id="x" href="#shape"/><use id="y" href="#x"/></svg>'], { type: "image/svg+xml" });
    await expect(validateImageInput(useChain)).rejects.toThrow("unsafe composed");
    const expensiveExpansion = new Blob([
      `<svg><defs><g id="shape">${"<rect width=\"1\" height=\"1\"/>".repeat(1_000)}</g></defs>${"<use href=\"#shape\"/>".repeat(10)}</svg>`,
    ], { type: "image/svg+xml" });
    await expect(validateImageInput(expensiveExpansion)).rejects.toThrow("expanded element count");
    const animated = new Blob(['<svg><path><animate attributeName="d"/></path></svg>'], { type: "image/svg+xml" });
    await expect(validateImageInput(animated)).rejects.toThrow("unsupported element");
    const tooMany = new Blob([`<svg>${"<path/>".repeat(2_001)}</svg>`], { type: "image/svg+xml" });
    await expect(validateImageInput(tooMany)).rejects.toThrow("element count");
  });

  it("enforces both edge and pixel limits", () => {
    expect(() => assertSafeImageDimensions(4096, 4096)).not.toThrow();
    expect(() => assertSafeImageDimensions(4097, 4096)).toThrow("dimensions");
    expect(() => assertSafeImageDimensions(8193, 1)).toThrow("dimensions");
  });

  it("rejects an oversized SVG dimension even when the other dimension is omitted", async () => {
    const widthOnly = new Blob(['<svg width="9000000"><rect width="1" height="1"/></svg>'], { type: "image/svg+xml" });
    await expect(validateImageInput(widthOnly)).rejects.toThrow("dimensions");
  });
});

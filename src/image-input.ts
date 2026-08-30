const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 8192;
export const MAX_IMAGE_PIXELS = 4096 * 4096;
const MAX_SVG_BYTES = 512 * 1024;
const MAX_SVG_ELEMENTS = 2_000;
const MAX_SVG_EXPANDED_ELEMENTS = 10_000;
const MAX_SVG_PATH_DATA = 256 * 1024;
const SVG_ELEMENTS = new Set([
  "svg", "g", "defs", "title", "desc", "path", "rect", "circle", "ellipse",
  "line", "polyline", "polygon", "lineargradient", "radialgradient", "stop",
  "clippath", "mask", "symbol", "text", "tspan", "use",
]);

export type ValidatedImageInput = {
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  width?: number;
  height?: number;
};

function fail(message: string): never {
  throw new Error(`Unsafe image input: ${message}`);
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function assertSafeImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    fail("invalid dimensions");
  }
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    fail("dimensions exceed the supported limit");
  }
}

function readPngDimensions(bytes: Uint8Array): [number, number] {
  if (
    bytes.length < 24 ||
    !bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    !bytesEqual(bytes, 12, [0x49, 0x48, 0x44, 0x52])
  ) {
    fail("PNG signature is invalid");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

function readJpegDimensions(bytes: Uint8Array): [number, number] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("JPEG signature is invalid");
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) fail("JPEG segment is malformed");
    if (sofMarkers.has(marker)) {
      if (length < 7) fail("JPEG frame is malformed");
      return [
        (bytes[offset + 5] << 8) | bytes[offset + 6],
        (bytes[offset + 3] << 8) | bytes[offset + 4],
      ];
    }
    offset += length;
  }
  fail("JPEG dimensions are missing");
}

function readWebpDimensions(bytes: Uint8Array): [number, number] {
  if (
    bytes.length < 30 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP"
  ) {
    fail("WebP signature is invalid");
  }
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    return [
      1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    ];
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) fail("WebP lossless header is invalid");
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (chunk === "VP8 ") {
    if (!bytesEqual(bytes, 23, [0x9d, 0x01, 0x2a])) fail("WebP frame header is invalid");
    return [
      (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    ];
  }
  fail("WebP dimensions are missing");
}

function parseSvgLength(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
  return match ? Number(match[1]) : undefined;
}

function validateSvg(svg: string): Pick<ValidatedImageInput, "width" | "height"> {
  if (!/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[^]*?-->\s*)*<svg(?:\s|>)/i.test(svg)) {
    fail("SVG root is invalid");
  }
  if (/<!DOCTYPE|<!ENTITY|\bon[a-z]+\s*=|\burl\s*\(/i.test(svg)) {
    fail("SVG contains an active or external reference");
  }
  const elements = [...svg.matchAll(/<\s*([a-z][\w:-]*)(?:\s|\/?>)/gi)];
  if (elements.some((match) => !SVG_ELEMENTS.has(match[1].toLowerCase()))) {
    fail("SVG contains an unsupported element");
  }
  const elementCount = elements.length;
  if (elementCount > MAX_SVG_ELEMENTS) fail("SVG element count exceeds the supported limit");
  const idContainersWithUse = new Set<string>();
  const idsOnUse = new Set<string>();
  const complexityById = new Map<string, number>();
  const ids = new Set<string>();
  const references: string[] = [];
  const stack: Array<{ id?: string; containsUse: boolean; complexity: number }> = [];
  for (const token of svg.matchAll(/<\s*(\/?)\s*([a-z][\w:-]*)([^>]*)>/gi)) {
    const closing = token[1] === "/";
    const tag = token[2].toLowerCase();
    const attributes = token[3];
    if (closing) {
      const frame = stack.pop();
      if (frame?.id) {
        complexityById.set(frame.id, frame.complexity);
        if (frame.containsUse) idContainersWithUse.add(frame.id);
      }
      continue;
    }
    for (const frame of stack) frame.complexity += 1;
    const id = attributes.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    if (id) {
      if (ids.has(id)) fail("SVG contains duplicate identifiers");
      ids.add(id);
    }
    if (tag === "use") {
      const reference = attributes.match(/\b(?:href|xlink:href)\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!reference?.startsWith("#") || reference.length < 2) fail("SVG contains an external reference");
      references.push(reference.slice(1));
      if (id) idsOnUse.add(id);
      for (const frame of stack) frame.containsUse = true;
    } else if (/\b(?:href|xlink:href)\s*=/i.test(attributes)) {
      fail("SVG contains an external reference");
    }
    if (attributes.trimEnd().endsWith("/")) {
      if (id) complexityById.set(id, 1);
    } else {
      stack.push({ id, containsUse: tag === "use", complexity: 1 });
    }
  }
  if (
    references.length > 256 ||
    references.some((id) => !ids.has(id) || idsOnUse.has(id) || idContainersWithUse.has(id))
  ) {
    fail("SVG contains an unsafe composed reference");
  }
  const expandedElements = elementCount + references.reduce(
    (total, id) => total + (complexityById.get(id) ?? 1),
    0,
  );
  if (expandedElements > MAX_SVG_EXPANDED_ELEMENTS) {
    fail("SVG expanded element count exceeds the supported limit");
  }
  const pathBytes = (svg.match(/\bd\s*=\s*["'][^"']*["']/gi) ?? []).reduce(
    (total, value) => total + value.length,
    0,
  );
  if (pathBytes > MAX_SVG_PATH_DATA) fail("SVG path data exceeds the supported limit");

  const root = svg.match(/<svg\b([^>]*)>/i)?.[1] ?? "";
  const attribute = (name: string) => root.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  let width = parseSvgLength(attribute("width"));
  let height = parseSvgLength(attribute("height"));
  const viewBox = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if ((!width || !height) && viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    width ||= Math.abs(viewBox[2]);
    height ||= Math.abs(viewBox[3]);
  }
  if (width !== undefined && (!Number.isFinite(width) || width < 1 || width > MAX_IMAGE_EDGE)) {
    fail("dimensions exceed the supported limit");
  }
  if (height !== undefined && (!Number.isFinite(height) || height < 1 || height > MAX_IMAGE_EDGE)) {
    fail("dimensions exceed the supported limit");
  }
  if (width && height) assertSafeImageDimensions(Math.ceil(width), Math.ceil(height));
  return { width, height };
}

export async function validateImageInput(blob: Blob): Promise<ValidatedImageInput> {
  const mime = blob.type.trim().toLowerCase().split(";", 1)[0] as ValidatedImageInput["mime"];
  if (!ALLOWED_IMAGE_TYPES.has(mime)) fail("file type is not supported");
  if (blob.size < 1) fail("file is empty");
  if (blob.size > MAX_IMAGE_BYTES) fail("file exceeds the supported size");

  if (mime === "image/svg+xml") {
    if (blob.size > MAX_SVG_BYTES) fail("SVG exceeds the supported size");
    return { mime, ...validateSvg(await blob.text()) };
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const [width, height] = mime === "image/png"
    ? readPngDimensions(bytes)
    : mime === "image/jpeg"
      ? readJpegDimensions(bytes)
      : readWebpDimensions(bytes);
  assertSafeImageDimensions(width, height);
  return { mime, width, height };
}

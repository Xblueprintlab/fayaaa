export type ExportKind = "image" | "video";
export type ExportRatio = "16:9" | "1:1" | "4:5" | "9:16";
export type ExportQuality = "standard" | "high" | "max";
export type VideoFormat = "mp4" | "webm";

export type ExportSettings = {
  kind: ExportKind;
  ratio: ExportRatio;
  quality: ExportQuality;
  fps: 24 | 30 | 60;
  duration: 3 | 5 | 10;
  frameX: number;
  frameY: number;
  scale: number;
};

export type ExportFrameParams = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

const QUALITY_EDGE = { standard: 720, high: 1080, max: 1440 } as const;

const RATIO_ASPECT = {
  "16:9": 16 / 9,
  "1:1": 1,
  "4:5": 4 / 5,
  "9:16": 9 / 16,
} as const;

export const VIDEO_BITRATES = {
  standard: 8_000_000,
  high: 16_000_000,
  max: 28_000_000,
} as const;

export const IMAGE_QUALITY_LABELS = {
  standard: "720 px",
  high: "1080 px",
  max: "1440 px",
} as const;

export function exportAspect(ratio: ExportRatio): number {
  return RATIO_ASPECT[ratio];
}

export function exportDimensions(settings: Pick<ExportSettings, "ratio" | "quality">): [number, number] {
  const edge = QUALITY_EDGE[settings.quality];
  if (settings.ratio === "1:1") return [edge, edge];
  if (settings.ratio === "4:5") return [edge, Math.round((edge * 5) / 4)];
  if (settings.ratio === "9:16") return [edge, Math.round((edge * 16) / 9)];
  return [Math.round((edge * 16) / 9), edge];
}

export function chooseVideoFormat(codecs: readonly string[]): { format: VideoFormat; codec: "avc" | "vp9" | "vp8" } | undefined {
  if (codecs.includes("avc")) return { format: "mp4", codec: "avc" };
  if (codecs.includes("vp9")) return { format: "webm", codec: "vp9" };
  if (codecs.includes("vp8")) return { format: "webm", codec: "vp8" };
  return undefined;
}

export function clampFrame(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Convert the modal's normalized framing controls into the shader's subject
 * transform. Preview, still export, and video export all call this function so
 * a frame only has one geometric interpretation.
 */
export function exportFrameParams(
  params: ExportFrameParams,
  settings: Pick<ExportSettings, "frameX" | "frameY" | "scale">,
): ExportFrameParams {
  return {
    scale: params.scale * settings.scale,
    offsetX: params.offsetX - settings.frameX * 0.18,
    offsetY: params.offsetY - settings.frameY * 0.18,
  };
}

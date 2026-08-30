import { clock, frame, frameLoop, init, surface } from "vgpu";
import type { FrameLoopHandle } from "vgpu";
import {
  BufferTarget,
  BlobSource,
  ALL_FORMATS,
  CanvasSource,
  getEncodableVideoCodecs,
  Mp4OutputFormat,
  Input,
  Output,
  Quality,
  WebMOutputFormat,
} from "mediabunny";
import type { VideoCodec } from "mediabunny";
import { computeRect, DEFAULTS, inferMaskMode } from "../shared/params.mjs";
import {
  mountDialKit,
  type PlaygroundDialValues,
  type ShowcasePresetId,
} from "./dialkit-controls";
import {
  mountExportDialKit,
  type ExportDialValues,
} from "./export-dialkit-controls";
import { mountMobileControls } from "./mobile-controls";
import { mountPlayground } from "./playground-page";
import { EffectTransition, effectLoopTarget, type EffectPhase } from "./effect-transition";
import { downloadBlob } from "./export-utils";
import {
  chooseVideoFormat,
  clampFrame,
  exportDimensions,
  VIDEO_BITRATES,
  type ExportSettings,
} from "./export-config";
import { FireAudio } from "./fire-audio";
import {
  clearPlaygroundAsset,
  loadPlaygroundAsset,
  loadPlaygroundSettings,
  savePlaygroundAsset,
  savePlaygroundSettings,
} from "./playground-persistence";
import { assetUrl } from "./base-path";
import "./app.css";
import { EmberPipeline } from "./pipeline";

type ParamState = Record<string, number | string | boolean>;

type PreviewMode = "shape" | "image" | "paper";
type LookId = "fire" | "plasma" | "ghost";
type SubjectKind = "image" | "text";
type BackgroundMode = "color" | "image" | "transparent";
type HeatDirection = number | "full";
type ShaderBlend = "normal" | "screen" | "add" | "multiply" | "overlay";
type ImageTreatment = "edge" | "material";
type AutomaticMaskMode = "alpha" | "dark" | "bright";
type VideoExportSettings = ExportSettings;
type RasterizedSource = {
  canvas: HTMLCanvasElement;
  hasAlpha: boolean;
  autoMaskMode: AutomaticMaskMode;
  aspect: number;
  name: string;
  previewUrl: string;
  kind: SubjectKind;
  // Burn around is an image-only presentation. Intro art, text, and the
  // built-in icon marks always use the canonical Fire compositor.
  supportsBurnAround?: boolean;
};

type ShowcaseScene = {
  label: string;
  look: LookId;
  subjectColor: string;
  subject:
    | { kind: "image"; url: string; name: string; supportsBurnAround: boolean }
    | { kind: "text"; value: string };
  background:
    | { mode: "color"; color: string }
    | { mode: "image"; url: string; name: string }
    | { mode: "transparent" };
};

type CurrentSetupSnapshot = {
  source: RasterizedSource;
  backgroundSource?: RasterizedSource;
  backgroundMode: BackgroundMode;
  colors: {
    baseColor: string;
    rimColor: string;
    hotColor: string;
    coolColor: string;
    bgColor: string;
  };
  look: LookId;
  subjectColor: string;
  text: string;
};

type EffectIntent = "auto" | "source" | "result";
type LogoReplayPhase = "idle" | "cooling" | "holding";
type PendingSourceSwap = {
  source: RasterizedSource;
  mode: PreviewMode;
  request: number;
  selection: number;
  userSource: boolean;
  revokeIfCanceled: boolean;
};

type PresentationSnapshot = {
  params: ParamState;
  mode: PreviewMode;
  source?: HTMLCanvasElement;
  sourceRect?: { x: number; y: number; width: number; height: number };
  sourceAspect: number;
  sourceHasAlpha: boolean;
  sourceMaskMode: AutomaticMaskMode;
  blend: GlobalCompositeOperation;
  shaderBlendMode: ShaderBlend;
  shaderBlend: GlobalCompositeOperation;
  sourceAlpha: number;
  alpha: number;
  animationTime: number;
  effectProgress: number;
  motionPaused: boolean;
  backgroundMode: BackgroundMode;
  imageTreatment: ImageTreatment;
  background?: HTMLCanvasElement;
};

const EXPORT_WIDTH = 1280;
const EXPORT_HEIGHT = 720;
const VIDEO_QUALITIES = {
  standard: { bitrate: VIDEO_BITRATES.standard, label: "720p" },
  high: { bitrate: VIDEO_BITRATES.high, label: "1080p" },
  max: { bitrate: VIDEO_BITRATES.max, label: "1440p" },
} as const;
const SHAPE_SOURCE_OPACITY = 0.82;
const PAPER_SOURCE_OPACITY = 0.9;
const PAPER_MULTIPLY_SHADER_OPACITY = 0.86;

const MODE_COPY: Record<PreviewMode, string> = {
  shape: "The whole logo stays readable while the heat travels across it.",
  image: "The visible shape becomes animated heat.",
  paper: "The paper stays visible while the heat blends into its torn edge.",
};

const STAGE_COPY: Record<PreviewMode, string> = {
  shape: "plain logo → fire reveal",
  image: "image edge → fire",
  paper: "paper → blended fire",
};

const LOOKS: Record<LookId, Partial<ParamState>> = {
  fire: {
    baseColor: String(DEFAULTS.baseColor),
    rimColor: String(DEFAULTS.rimColor),
    hotColor: String(DEFAULTS.hotColor),
    coolColor: String(DEFAULTS.coolColor),
    bgColor: String(DEFAULTS.bgColor),
  },
  plasma: {
    baseColor: "#080610",
    rimColor: "#bff8ff",
    hotColor: "#f02cae",
    coolColor: "#5f19a8",
    bgColor: "#08060f",
  },
  ghost: {
    baseColor: "#03100c",
    rimColor: "#f2fff9",
    hotColor: "#7dffcf",
    coolColor: "#087a66",
    bgColor: "#04100c",
  },
};

const LOOK_COLOR_KEYS = ["rimColor", "hotColor", "coolColor", "bgColor"] as const;

const LOOK_LABELS: Record<LookId, string> = {
  fire: "Fire",
  plasma: "Violet",
  ghost: "Mint",
};

const SHOWCASE_SCENES: Record<Exclude<ShowcasePresetId, "current">, ShowcaseScene> = {
  "brand-mark": {
    label: "Brand mark",
    look: "fire",
    subjectColor: String(DEFAULTS.baseColor),
    subject: {
      kind: "image",
      url: assetUrl("artifact-mark.svg"),
      name: "Artifact",
      supportsBurnAround: false,
    },
    background: { mode: "color", color: "#180e01" },
  },
  "burning-painting": {
    label: "Burning painting",
    look: "fire",
    subjectColor: String(DEFAULTS.baseColor),
    subject: {
      kind: "image",
      url: assetUrl("art-painting.jpg"),
      name: "Oil painting",
      supportsBurnAround: true,
    },
    background: { mode: "color", color: "#0d0702" },
  },
  "violet-type": {
    label: "Violet type",
    look: "plasma",
    subjectColor: "#080610",
    subject: { kind: "text", value: "FAYAAA" },
    background: { mode: "color", color: "#08060f" },
  },
  "paper-flame": {
    label: "Paper flame",
    look: "fire",
    subjectColor: String(DEFAULTS.baseColor),
    subject: {
      kind: "image",
      url: assetUrl("fayaaa-mark.png"),
      name: "Fayaaa flame",
      supportsBurnAround: true,
    },
    background: { mode: "color", color: "#120a04" },
  },
};

const SHADER_BLEND_CSS: Record<ShaderBlend, string> = {
  normal: "normal",
  screen: "screen",
  add: "plus-lighter",
  multiply: "multiply",
  overlay: "overlay",
};

const SHADER_BLEND_CANVAS: Record<ShaderBlend, GlobalCompositeOperation> = {
  normal: "source-over",
  screen: "screen",
  add: "lighter",
  multiply: "multiply",
  overlay: "overlay",
};

const SHADER_BLEND_UNIFORM: Record<ShaderBlend, number> = {
  normal: 0,
  screen: 1,
  add: 2,
  multiply: 3,
  overlay: 4,
};

const restoredSettings = loadPlaygroundSettings();
// Vite preserves `hot.data` across module replacements. Treat an HMR update
// as a continuation of the current playground session: replaying the intro
// here would temporarily replace the active GPU source with its Artifact mark.
const hotReloaded = Boolean(import.meta.hot?.data.fayaaaMounted);
if (import.meta.hot) import.meta.hot.data.fayaaaMounted = true;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing DOM element: ${selector}`);
  return element;
}

type RouteSourceAsset = {
  url: string;
  name: string;
};

async function loadInitialSourceAsset(): Promise<RouteSourceAsset> {
  const asset = await import("./assets/apple-logo.svg");
  return { url: asset.default, name: "Apple" };
}

const routeSourceAsset = await loadInitialSourceAsset();
const initialPreviewMode = mountPlayground(assetUrl("sample-fire.png"));
const canvas = required<HTMLCanvasElement>("#playground");
const shaderStage = required<HTMLElement>("#shader-stage");
const videoExportModal = required<HTMLElement>("#video-export-modal");
const videoFramePreview = required<HTMLCanvasElement>("#video-frame-preview");
const videoExportSummary = required<HTMLOutputElement>("#video-export-summary");
const videoExportConfirm = required<HTMLButtonElement>(".video-export-confirm");
const exportProgress = required<HTMLElement>("#export-progress");
const exportProgressTitle = required<HTMLElement>("#export-progress-title");
const exportProgressDetail = required<HTMLElement>("#export-progress-detail");
const exportProgressMeter = required<HTMLProgressElement>("#export-progress-meter");
const demoShell = required<HTMLElement>("#demo-shell");
const fileInput = required<HTMLInputElement>("#file");
const backgroundFileInput = required<HTMLInputElement>("#background-file");
const dropHint = required<HTMLElement>("#drop-hint");
const sourceName = required<HTMLElement>("#source-name");
const sourcePreview = required<HTMLImageElement>("#source-preview");
const toolbarSourceThumbnail = required<HTMLImageElement>("#toolbar-source-thumbnail");
const subjectModeLabel = required<HTMLElement>("#subject-mode-label");
const stageTextHitarea = required<HTMLButtonElement>("#stage-text-hitarea");
const stageTextEditor = required<HTMLInputElement>("#stage-text-editor");
const backgroundPreview = required<HTMLImageElement>("#background-preview");
const backgroundModeLabel = required<HTMLElement>("#background-mode-label");
const backgroundSwatch = required<HTMLElement>("#background-swatch");
const backgroundColorInput = required<HTMLInputElement>("#background-color");
const backgroundColorValue = required<HTMLOutputElement>("#background-color-value");
const backgroundColorCustom = required<HTMLButtonElement>("#background-color-custom");
const backgroundFileName = required<HTMLElement>("#background-file-name");
const angleValue = required<HTMLOutputElement>("#angle-value");
const gpuStatus = required<HTMLElement>("#gpu-status");
const srStatus = required<HTMLElement>("#sr-status");
const modeDescription = required<HTMLElement>("#mode-description");
const stageNote = required<HTMLElement>("#stage-note");
const blendSelect = required<HTMLSelectElement>("#blend-mode");
const motionToggle = required<HTMLButtonElement>("#motion-toggle");
const compareSourceButton = required<HTMLButtonElement>("#compare-source");
const exportStatus = required<HTMLElement>("#export-status");
const presetSelect = required<HTMLSelectElement>("#preset");
const downloadPicker = required<HTMLElement>("[data-download-picker]");
const soundToggle = required<HTMLButtonElement>("#sound-toggle");
const replayIntroButton = required<HTMLButtonElement>("#replay-intro");
const toolbarMenus = [...document.querySelectorAll<HTMLElement>("[data-toolbar-menu]")];
const pngNotes = [...document.querySelectorAll<HTMLElement>("[data-png-note]")];
const recordNotes = [...document.querySelectorAll<HTMLElement>("[data-record-note]")];

document.addEventListener("click", (event) => {
  for (const menu of toolbarMenus) {
    if (menu.classList.contains("is-open") && !menu.contains(event.target as Node)) {
      setToolbarMenuOpen(menu, false);
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeToolbarMenus();
  }
});

for (const menu of toolbarMenus) {
  const trigger = menu.querySelector<HTMLElement>(".toolbar-trigger, .download-trigger");
  if (!trigger) continue;
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    const shouldOpen = !menu.classList.contains("is-open");
    closeToolbarMenus();
    if (shouldOpen) setToolbarMenuOpen(menu, true);
  });
}

function createTypeSource(text = "Fayaaa"): HTMLCanvasElement {
  const value = text.trim().slice(0, 40) || "Fayaaa";
  const source = document.createElement("canvas");
  source.height = 320;
  const measuringContext = source.getContext("2d");
  if (!measuringContext) return source;
  measuringContext.font = "750 220px Inter, Arial, sans-serif";
  source.width = Math.max(240, Math.min(1024, Math.ceil(measuringContext.measureText(value).width + 96)));
  const context = source.getContext("2d");
  if (!context) return source;
  context.fillStyle = "#fff";
  context.font = "750 220px Inter, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(value, source.width / 2, source.height / 2 + 4, 920);
  return source;
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const effectTransition = new EffectTransition(reducedMotion.matches ? 1 : 0);
const restoredLook = LOOKS[restoredSettings.look as LookId] ?? LOOKS.fire;
const state: ParamState = {
  ...DEFAULTS,
  ...restoredLook,
  maskMode: "auto",
  bgColor: restoredSettings.backgroundColor ?? restoredLook.bgColor ?? DEFAULTS.bgColor,
  baseColor: restoredSettings.subjectColor ?? DEFAULTS.baseColor,
};
const modeAngles: Record<PreviewMode, HeatDirection> = {
  shape: Number(DEFAULTS.heatAngle),
  image: Number(DEFAULTS.heatAngle),
  paper: Number(DEFAULTS.heatAngle),
};
// The one true heat angle: the attract loop, hover steering, and the intro's
// sweep all drive this single number so every handoff is continuous.
let heatCurrent = Number(DEFAULTS.heatAngle);
// Attract mode: the fire slowly circles the subject so visitors see the
// hover effect without touching anything — and stops FOREVER at the first
// real interaction, keeping the user's chosen direction stable after that.
let attractOrbitActive = true;
let lastDialDirection: string | undefined;
let previewMode: PreviewMode = initialPreviewMode;
let backgroundMode: BackgroundMode = restoredSettings.backgroundMode ?? "color";
let selectedSubjectKind: SubjectKind = restoredSettings.subjectKind ?? "image";

// The intro plays once per browser session (per the motion brief) — a reload
// mid-session boots straight into the app.
const INTRO_SEEN_KEY = "fayaaa-intro-seen";
function introAlreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
function markIntroSeen(): void {
  try {
    window.sessionStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    // storage unavailable (private mode) — the intro just replays next load
  }
}

// Debug/replay hook: `?intro` in the URL forces the intro on any load, and
// `replayIntro()` in the console replays it mid-session without a reload.
const introForced = new URLSearchParams(window.location.search).has("intro");
let introRunning = false;

// Hide the chrome from first paint when the intro is likely to run; the boot
// sequence removes the class immediately if the intro turns out to be skipped
// (reduced motion, restored custom subject, already seen, or no WebGPU).
if (
  !hotReloaded &&
  !reducedMotion.matches &&
  (introForced || (selectedSubjectKind === "image" && !introAlreadySeen()))
) {
  document.body.classList.add("intro-playing");
}

// Wired by the GPU boot; the stage button replays the intro on demand.
let introReplayController: (() => void) | undefined;

replayIntroButton.addEventListener("click", () => {
  if (reducedMotion.matches) {
    announce("The intro stays off while reduced motion is on.");
    return;
  }
  if (!introReplayController) {
    announce("The intro needs the live WebGPU preview.");
    return;
  }
  introReplayController();
  announce("Replaying the fayaaa intro");
});
let currentSourceAspect = 0.62;
let currentSource: RasterizedSource | undefined;
let backgroundSource: RasterizedSource | undefined;
let backgroundObjectUrl: string | undefined;
let userLogoSource: RasterizedSource | undefined;
let userImageSource: RasterizedSource | undefined;
let userPaperSource: RasterizedSource | undefined;
let userTextSource: RasterizedSource | undefined;
const userPreviewObjectUrls: Partial<Record<PreviewMode, string>> = {};
let sourceController: ((mode: PreviewMode) => Promise<void>) | undefined;
let lookController: ((look: LookId) => void) | undefined;
let gpuFailed = false;
let pendingFile: File | undefined;
let pendingFileSupportsBurnAround = true;
let pendingBackgroundFile: File | undefined;
let requestedLook: LookId = restoredSettings.look ?? "fire";
let subjectColor = restoredSettings.subjectColor ?? String(DEFAULTS.baseColor);
let lookAnimationFrame = 0;
let sourceSelectionVersion = 0;
let effectIntent: EffectIntent = "auto";
let activeBlend = restoredSettings.blend ?? "multiply";
let pendingBlend: string | undefined;
let logoReplayPhase: LogoReplayPhase = "idle";
let latestDialValues: PlaygroundDialValues | undefined;
let applyDialValues: ((values: PlaygroundDialValues) => void) | undefined;
let shaderBlend: ShaderBlend = "normal";
let imageTreatment: ImageTreatment = "material";
let shaderBlendController: ((blend: ShaderBlend) => void) | undefined;
let textSourceLoader: ((text: string, instant?: boolean) => void) | undefined;
let backgroundImageLoader: ((blob: Blob, name?: string) => Promise<void>) | undefined;
let backgroundModeController: ((mode: BackgroundMode) => void) | undefined;
let backgroundColorController: ((color: string) => void) | undefined;
let subjectColorController: ((color: string) => void) | undefined;
let showcasePresetController: ((preset: ShowcasePresetId) => Promise<void>) | undefined;
let pendingShowcasePreset: ShowcasePresetId | undefined;
let videoRecorder: ((settings: VideoExportSettings, signal: AbortSignal) => Promise<void>) | undefined;
let imageExporter: ((settings: VideoExportSettings, signal: AbortSignal) => Promise<void>) | undefined;
let exportAbortController: AbortController | undefined;
let exportDialkitCleanup: (() => void) | undefined;
let exportRunning = false;
let exportReturnFocus: HTMLElement | undefined;
let textSubjectValue = restoredSettings.text ?? "Fayaaa";
let textEditorStartValue = textSubjectValue;
let textEditorOpen = false;
let textUpdateTimer = 0;

function burnAroundActive(): boolean {
  return imageTreatment === "edge" &&
    !introRunning &&
    currentSource?.supportsBurnAround === true;
}

const BUILT_IN_ICON_SOURCES = new Set(["Apple", "Flame", "Artifact"]);

function announce(message: string): void {
  srStatus.textContent = message;
}

function setToolbarMenuOpen(menu: HTMLElement, open: boolean): void {
  menu.classList.toggle("is-open", open);
  menu.querySelector<HTMLElement>(".toolbar-trigger, .download-trigger")
    ?.setAttribute("aria-expanded", String(open));
  const popover = menu.querySelector<HTMLElement>(".toolbar-popover, .download-options");
  if (popover) popover.hidden = !open;
}

function closeToolbarMenus(): void {
  for (const menu of toolbarMenus) setToolbarMenuOpen(menu, false);
}

let videoPreviewFrame = 0;

function updateVideoExportUi(): void {
  const [width, height] = videoDimensions(videoExportSettings);
  const isVideo = videoExportSettings.kind === "video";
  videoFramePreview.style.aspectRatio = `${width} / ${height}`;
  videoFramePreview.dataset.ratio = videoExportSettings.ratio;
  videoExportSummary.value = isVideo
    ? `${width} × ${height} · ${videoExportSettings.fps} FPS · ${videoExportSettings.duration}s`
    : `${width} × ${height} · lossless PNG`;
  videoExportSummary.textContent = videoExportSummary.value;
  videoExportConfirm.textContent = isVideo ? "Download video" : "Download image";
}

function drawVideoFramePreview(): void {
  videoPreviewFrame = 0;
  if (!videoExportOpen) return;
  const [ratioWidth, ratioHeight] = videoDimensions(videoExportSettings);
  const previewLongEdge = 720;
  if (ratioWidth >= ratioHeight) {
    videoFramePreview.width = previewLongEdge;
    videoFramePreview.height = Math.round((previewLongEdge * ratioHeight) / ratioWidth);
  } else {
    videoFramePreview.height = previewLongEdge;
    videoFramePreview.width = Math.round((previewLongEdge * ratioWidth) / ratioHeight);
  }
  const context = videoFramePreview.getContext("2d");
  if (!context || canvas.width === 0 || canvas.height === 0) return;
  const sourceAspect = canvas.width / canvas.height;
  const targetAspect = videoFramePreview.width / videoFramePreview.height;
  let cropWidth = canvas.width;
  let cropHeight = canvas.height;
  if (sourceAspect > targetAspect) cropWidth = canvas.height * targetAspect;
  else cropHeight = canvas.width / targetAspect;
  cropWidth /= videoExportSettings.scale;
  cropHeight /= videoExportSettings.scale;
  const travelX = Math.max(0, canvas.width - cropWidth) * 0.5;
  const travelY = Math.max(0, canvas.height - cropHeight) * 0.5;
  const sourceX = (canvas.width - cropWidth) * 0.5 + videoExportSettings.frameX * travelX;
  const sourceY = (canvas.height - cropHeight) * 0.5 + videoExportSettings.frameY * travelY;
  context.clearRect(0, 0, videoFramePreview.width, videoFramePreview.height);
  context.drawImage(
    canvas,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    videoFramePreview.width,
    videoFramePreview.height,
  );
  videoPreviewFrame = requestAnimationFrame(drawVideoFramePreview);
}

function openVideoExport(): void {
  closeToolbarMenus();
  exportReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  // Every export starts from the composition exactly as it exists on the
  // playground. Reframing remains available inside this modal, but stale
  // export-only zoom/offsets must never override the user's tuned dials.
  videoExportSettings.frameX = 0;
  videoExportSettings.frameY = 0;
  videoExportSettings.scale = 1;
  videoExportOpen = true;
  videoExportModal.hidden = false;
  document.body.classList.add("video-export-open");
  mountVideoExportControls();
  updateVideoExportUi();
  cancelAnimationFrame(videoPreviewFrame);
  videoPreviewFrame = requestAnimationFrame(drawVideoFramePreview);
  required<HTMLButtonElement>(".video-export-close").focus({ preventScroll: true });
}

function closeVideoExport(): void {
  if (exportRunning) {
    exportAbortController?.abort();
    exportRunning = false;
    exportProgress.hidden = true;
    videoExportConfirm.disabled = false;
  }
  videoExportOpen = false;
  videoExportModal.hidden = true;
  document.body.classList.remove("video-export-open");
  cancelAnimationFrame(videoPreviewFrame);
  exportDialkitCleanup?.();
  exportDialkitCleanup = undefined;
  exportReturnFocus?.focus();
}

required<HTMLButtonElement>(".video-export-close").addEventListener("click", closeVideoExport);
required<HTMLButtonElement>(".video-export-cancel").addEventListener("click", closeVideoExport);
videoExportModal.addEventListener("pointerdown", (event) => {
  if (event.target === videoExportModal) closeVideoExport();
});

let videoFramePointer = -1;
let videoFramePointerStart = { x: 0, y: 0, frameX: 0, frameY: 0 };
videoFramePreview.addEventListener("pointerdown", (event) => {
  videoFramePointer = event.pointerId;
  videoFramePointerStart = {
    x: event.clientX,
    y: event.clientY,
    frameX: videoExportSettings.frameX,
    frameY: videoExportSettings.frameY,
  };
  videoFramePreview.setPointerCapture(event.pointerId);
});
videoFramePreview.addEventListener("pointermove", (event) => {
  if (event.pointerId !== videoFramePointer) return;
  const bounds = videoFramePreview.getBoundingClientRect();
  videoExportSettings.frameX = clampFrame(videoFramePointerStart.frameX - ((event.clientX - videoFramePointerStart.x) / bounds.width) * 2);
  videoExportSettings.frameY = clampFrame(videoFramePointerStart.frameY - ((event.clientY - videoFramePointerStart.y) / bounds.height) * 2);
});
const stopVideoFrameDrag = (event: PointerEvent) => {
  if (event.pointerId !== videoFramePointer) return;
  videoFramePointer = -1;
  persistPlayground();
};
videoFramePreview.addEventListener("pointerup", stopVideoFrameDrag);
videoFramePreview.addEventListener("pointercancel", stopVideoFrameDrag);

videoExportConfirm.addEventListener("click", async () => {
  const exporter = videoExportSettings.kind === "video" ? videoRecorder : imageExporter;
  if (!exporter || exportRunning) return;
  const controller = new AbortController();
  exportAbortController = controller;
  exportRunning = true;
  exportProgress.hidden = false;
  videoExportConfirm.disabled = true;
  try {
    await exporter({ ...videoExportSettings }, controller.signal);
    if (!controller.signal.aborted) {
      exportRunning = false;
      closeVideoExport();
    }
  } finally {
    if (exportAbortController === controller) {
      exportRunning = false;
      exportProgress.hidden = true;
      videoExportConfirm.disabled = false;
      exportAbortController = undefined;
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && videoExportOpen) closeVideoExport();
  if (event.key === "Tab" && videoExportOpen) {
    const focusable = [...videoExportModal.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")].filter((item) => !item.closest("[hidden]"));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});

function setSubjectTab(kind: SubjectKind): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-subject-tab]")) {
    button.classList.toggle("is-active", button.dataset.subjectTab === kind);
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-subject-panel]")) {
    panel.hidden = panel.dataset.subjectPanel !== kind;
  }
}

function syncSubjectUi(source: RasterizedSource): void {
  selectedSubjectKind = source.kind;
  subjectModeLabel.textContent = source.kind === "text" ? "Text" : "Image";
  toolbarSourceThumbnail.src = source.previewUrl;
  demoShell.dataset.subject = source.kind;
  if (source.kind === "text") {
    textSubjectValue = source.name;
    if (!textEditorOpen) stageTextEditor.value = textSubjectValue;
  }
  stageTextHitarea.hidden = source.kind !== "text" || textEditorOpen;
  stageTextEditor.hidden = source.kind !== "text" || !textEditorOpen;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-sample-source]")) {
    const active = source.kind === "image" && button.dataset.sampleName === source.name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  setSubjectTab(source.kind);
}

function chooseSubjectKind(kind: SubjectKind): void {
  selectedSubjectKind = kind;
  persistPlayground();
  setSubjectTab(kind);
  if (kind === "text") {
    closeToolbarMenus();
    if (currentSource?.kind === "text") {
      stageTextHitarea.hidden = false;
      announce("Text subject selected. Click the text in the playground to edit it.");
      return;
    }
    textSourceLoader?.(textSubjectValue);
    return;
  }

  if (currentSource?.kind === "text") {
    closeToolbarMenus();
    void sourceController?.(previewMode);
  }
}

function closeStageTextEditor(): void {
  textEditorOpen = false;
  stageTextEditor.hidden = true;
  stageTextHitarea.hidden = currentSource?.kind !== "text";
  demoShell.classList.remove("text-editing");
}

function openStageTextEditor(): void {
  if (currentSource?.kind !== "text") return;
  textEditorOpen = true;
  textEditorStartValue = textSubjectValue;
  stageTextEditor.value = textSubjectValue;
  stageTextHitarea.hidden = true;
  stageTextEditor.hidden = false;
  demoShell.classList.add("text-editing");
  requestAnimationFrame(() => {
    stageTextEditor.focus();
    const end = stageTextEditor.value.length;
    stageTextEditor.setSelectionRange(end, end);
  });
}

function syncBackgroundUi(): void {
  backgroundModeLabel.textContent = "Background";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-background-mode]")) {
    button.classList.toggle("is-active", button.dataset.backgroundMode === backgroundMode);
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-background-panel]")) {
    panel.hidden = panel.dataset.backgroundPanel !== backgroundMode;
  }

  backgroundSwatch.classList.toggle("is-image", backgroundMode === "image");
  backgroundSwatch.classList.toggle("is-transparent", backgroundMode === "transparent");
  backgroundSwatch.style.setProperty("--background-swatch", String(state.bgColor));
  if (backgroundSource) {
    backgroundSwatch.style.setProperty("--background-image", `url("${backgroundSource.previewUrl}")`);
  } else {
    backgroundSwatch.style.removeProperty("--background-image");
  }
  backgroundPreview.hidden = backgroundMode !== "image" || !backgroundSource;
  demoShell.dataset.background = backgroundMode;
  syncStageBackground();
  syncSourceVisibility();
  backgroundModeController?.(backgroundMode);
}

function syncSourceVisibility(): void {
  // On a solid color the WebGPU composite already contains both the subject
  // and its background. Keeping the DOM source underneath duplicates that
  // subject whenever the canvas is reconfigured or its SDF is rebuilt (boot,
  // refresh, DialKit reset). During a reveal over an image/transparent
  // background the source is the starting frame. Burn around samples the
  // source texture inside WebGPU, so showing the DOM preview would duplicate
  // the image and turn the material transition into a cheap underlay.
  const gpuReady = document.body.classList.contains("gpu-ready");
  const sourceVisibility = burnAroundActive()
    ? 0
    : shaderBlend !== "normal"
      ? 1
      : backgroundMode !== "color"
        ? Math.max(0, 1 - effectTransition.value)
        : 0;
  sourcePreview.style.opacity = gpuReady ? String(sourceVisibility) : "0";
}

function chooseBackgroundMode(mode: BackgroundMode): void {
  if (mode === "image" && !backgroundSource) {
    backgroundFileInput.click();
    return;
  }
  backgroundMode = mode;
  syncBackgroundUi();
  persistPlayground();
  announce(
    mode === "transparent"
      ? "Transparent background selected"
      : mode === "image"
        ? "Image background selected"
        : "Color background selected",
  );
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-subject-tab]")) {
  button.addEventListener("click", () => chooseSubjectKind(button.dataset.subjectTab as SubjectKind));
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-background-mode]")) {
  button.addEventListener("click", () => chooseBackgroundMode(button.dataset.backgroundMode as BackgroundMode));
}

required<HTMLButtonElement>("[data-edit-text]").addEventListener("click", openStageTextEditor);

stageTextEditor.addEventListener("input", () => {
  window.clearTimeout(textUpdateTimer);
  if (!stageTextEditor.value.trim()) return;
  textUpdateTimer = window.setTimeout(() => {
    textSourceLoader?.(stageTextEditor.value, true);
  }, 70);
});

stageTextEditor.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    window.clearTimeout(textUpdateTimer);
    if (textSubjectValue !== textEditorStartValue) textSourceLoader?.(textEditorStartValue, true);
    stageTextEditor.value = textEditorStartValue;
    closeStageTextEditor();
    announce("Text edit canceled");
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    stageTextEditor.blur();
  }
});

stageTextEditor.addEventListener("blur", () => {
  if (!textEditorOpen) return;
  window.clearTimeout(textUpdateTimer);
  textSourceLoader?.(stageTextEditor.value, true);
  closeStageTextEditor();
  announce("Text updated in the playground");
});

required<HTMLButtonElement>("[data-upload-background]").addEventListener("click", () => {
  backgroundFileInput.click();
});

const fireAudio = new FireAudio(assetUrl("fire-burning.mp3"));
let soundOn = false;
let soundBusy = false;

function syncSoundToggle(): void {
  soundToggle.classList.toggle("is-on", soundOn);
  soundToggle.setAttribute("aria-pressed", String(soundOn));
  soundToggle.setAttribute("aria-label", soundOn ? "Turn fire sound off" : "Turn fire sound on");
}

soundToggle.addEventListener("click", async () => {
  if (soundBusy) return;
  soundBusy = true;
  soundOn = !soundOn;
  syncSoundToggle();
  try {
    await fireAudio.setEnabled(soundOn);
    announce(soundOn ? "Fire sound on. Hover the flame to lean into it." : "Fire sound off");
  } catch (error) {
    console.error(error);
    soundOn = false;
    syncSoundToggle();
    announce("The fire sound could not be loaded.");
  } finally {
    soundBusy = false;
  }
});

// Feed the pointer's distance from the burning subject into the audio, so
// hovering toward the flame raises the crackle and pans it under the cursor.
let audioPointerFrame = 0;
let audioPointerPosition = { x: 0, y: 0 };
const updateAudioPointer = () => {
  audioPointerFrame = 0;
  const bounds = shaderStage.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const [x0, y0, x1, y1] = computeRect(currentSourceAspect, state);
  const aspect = bounds.width / bounds.height;
  const side = Math.max(aspect, 1);
  const centerXNorm = 0.5 + ((((x0 + x1) * 0.5) - 0.5) * side) / aspect;
  const centerYNorm = 0.5 + (((y0 + y1) * 0.5) - 0.5) * side;
  const dx = audioPointerPosition.x - (bounds.left + bounds.width * centerXNorm);
  const dy = audioPointerPosition.y - (bounds.top + bounds.height * centerYNorm);
  const reach = Math.max(1, Math.min(bounds.width, bounds.height) * 0.55);
  fireAudio.setPointer(1 - Math.min(1, Math.hypot(dx, dy) / reach), dx / (bounds.width * 0.5));
};
shaderStage.addEventListener("pointerenter", (event) => {
  fireAudio.setHovering(true);
  audioPointerPosition = { x: event.clientX, y: event.clientY };
  if (!audioPointerFrame) audioPointerFrame = requestAnimationFrame(updateAudioPointer);
});
shaderStage.addEventListener("pointermove", (event) => {
  audioPointerPosition = { x: event.clientX, y: event.clientY };
  if (!audioPointerFrame) audioPointerFrame = requestAnimationFrame(updateAudioPointer);
});
shaderStage.addEventListener("pointerleave", () => {
  fireAudio.setHovering(false);
});

const dialkitCleanup = mountDialKit(required<HTMLElement>("#dialkit-root"), {
  initialSubjectColor: subjectColor,
  onValues(values) {
    latestDialValues = values;
    applyDialValues?.(values);
    fireAudio.setDials({
      intensity: values.fire.intensity,
      speed: values.motion.speed,
      flicker: values.motion.flicker,
      grain: values.motion.grain,
    });
  },
  onAction(action) {
    if (action === "resetToDefault") {
      announce("Parameters reset to default");
      return;
    }
  },
  onPreset(preset) {
    if (showcasePresetController) void showcasePresetController(preset);
    else pendingShowcasePreset = preset;
  },
  onPalette(look) {
    requestedLook = look;
    syncLookUi(look);
    lookController?.(look);
    persistPlayground();
  },
  onSubjectColor(color) {
    applySubjectColor(color);
  },
});

function applySubjectColor(color: string): void {
  subjectColor = color;
  state.baseColor = color;
  subjectColorController?.(color);
  persistPlayground();
  announce(`Subject color ${color}`);
}

const mobileControlsCleanup = mountMobileControls({
  getSubjectColor: () => subjectColor,
  onSubjectColor: applySubjectColor,
});

function circularDistance(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function readHeatDirection(value: unknown): HeatDirection {
  if (value === "full") return "full";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(DEFAULTS.heatAngle);
}

function updateDirectionUi(angle: HeatDirection): void {
  if (angle === "full") {
    angleValue.value = "Full";
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-angle]")) {
      button.classList.remove("is-active");
      button.setAttribute("aria-pressed", "false");
    }
    return;
  }
  const normalized = ((angle % 360) + 360) % 360;
  angleValue.value = `${Math.round(normalized)}°`;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-angle]")) {
    const targetAngle = Number(button.dataset.angle);
    const active = circularDistance(normalized, targetAngle) < 16;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function updateSourceBounds(): void {
  const bounds = shaderStage.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const aspect = bounds.width / bounds.height;
  const side = Math.max(aspect, 1);
  const [x0, y0, x1, y1] = computeRect(currentSourceAspect, state);
  const left = 0.5 + ((x0 - 0.5) * side) / aspect;
  const top = 0.5 + (y0 - 0.5) * side;
  const width = ((x1 - x0) * side) / aspect;
  const height = (y1 - y0) * side;
  demoShell.style.setProperty("--source-left", `${left * 100}%`);
  demoShell.style.setProperty("--source-top", `${top * 100}%`);
  demoShell.style.setProperty("--source-width", `${width * 100}%`);
  demoShell.style.setProperty("--source-height", `${height * 100}%`);
}

function syncStageBackground(): void {
  const color = String(state.bgColor);
  demoShell.style.setProperty("--shader-bg", backgroundMode === "color" ? color : "transparent");
  backgroundColorInput.value = color;
  backgroundColorValue.value = color;
  backgroundColorValue.textContent = color;
  backgroundSwatch.style.setProperty("--background-swatch", color);
  let presetSelected = false;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-background-color]")) {
    const selected = button.dataset.backgroundColor?.toLowerCase() === color.toLowerCase();
    button.setAttribute("aria-pressed", String(selected));
    presetSelected ||= selected;
  }
  backgroundColorCustom.setAttribute("aria-pressed", String(!presetSelected));
  backgroundColorCustom.style.setProperty("--custom-color", color);
}

function syncModeUi(mode: PreviewMode): void {
  previewMode = mode;
  demoShell.dataset.mode = mode;
  demoShell.dataset.blend = mode === "paper" ? activeBlend : "normal";
  modeDescription.textContent = MODE_COPY[mode];
  stageNote.textContent = STAGE_COPY[mode];
  syncStageBackground();
}
syncModeUi(previewMode);
syncBackgroundUi();

backgroundColorInput.addEventListener("input", () => {
  const color = backgroundColorInput.value;
  state.bgColor = color;
  backgroundColorValue.value = color;
  backgroundColorValue.textContent = color;
  backgroundColorController?.(color);
  syncStageBackground();
  persistPlayground();
  announce(`Background color ${color}`);
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-background-color]")) {
  button.addEventListener("click", () => {
    const color = button.dataset.backgroundColor;
    if (!color) return;
    state.bgColor = color;
    backgroundColorController?.(color);
    syncStageBackground();
    persistPlayground();
    announce(`${button.getAttribute("aria-label") ?? "Canvas"} background applied`);
  });
}

backgroundColorCustom.addEventListener("click", () => backgroundColorInput.click());

function syncLookUi(look: LookId | "custom"): void {
  presetSelect.value = look;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-palette]")) {
    button.setAttribute("aria-pressed", String(button.dataset.palette === look));
  }
  const fireSwatch = document.querySelector<HTMLElement>("#fire-swatch");
  const colors: Record<LookId, string> = {
    fire: "#ff3415, #ff9b36, #ffe2a1, #ff3415",
    plasma: "#7d20ff, #ef30d8, #ff9bf2, #7d20ff",
    ghost: "#4ee6bd, #b7ffe8, #effff9, #4ee6bd",
  };
  if (fireSwatch && look !== "custom") {
    fireSwatch.style.background = `conic-gradient(from 210deg, ${colors[look]})`;
  }
}

function colorChannels(value: string): [number, number, number] {
  const normalized = value.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function mixHex(from: string, to: string, amount: number): string {
  const start = colorChannels(from);
  const end = colorChannels(to);
  const channels = start.map((value, index) =>
    Math.round(value + (end[index] - value) * amount).toString(16).padStart(2, "0"),
  );
  return `#${channels.join("")}`;
}

const gpuActionButtons = [...document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
  "[data-angle], [data-upload], [data-upload-background], [data-subject-tab], [data-edit-text], " +
  "[data-finish-text], [data-use-sample], " +
  "[data-export-frame], [data-record-clip], " +
  "#motion-toggle, #replay-logo, #compare-source, #export, #clear-image, #reset, #preset",
)];
for (const button of gpuActionButtons) button.disabled = true;

blendSelect.value = activeBlend;
blendSelect.addEventListener("change", () => {
  if (captureBusy || exportRecording) {
    blendSelect.value = pendingBlend ?? activeBlend;
    announce("Finish the current export before changing the blend mode.");
    return;
  }

  const requestedBlend = blendSelect.value;
  if (requestedBlend === activeBlend) {
    pendingBlend = undefined;
    needsFrame = true;
    announce(`Paper blend mode remains ${activeBlend}`);
    return;
  }

  if (
    previewMode !== "paper" ||
    reducedMotion.matches ||
    (effectTransition.settled && effectTransition.value === 0)
  ) {
    activeBlend = requestedBlend;
    pendingBlend = undefined;
    demoShell.dataset.blend = previewMode === "paper" ? activeBlend : "normal";
    needsFrame = true;
    persistPlayground();
    announce(`Paper blend mode: ${activeBlend}`);
    return;
  }

  // A blend mode is discrete. Cool the shader to its real source first so the
  // switch happens invisibly, then let the same edge ignite again.
  pendingBlend = requestedBlend;
  effectTransition.setTarget(0);
  needsFrame = true;
  announce(`Preparing ${requestedBlend} blend at the source image`);
});

let comparingSource = false;
function syncSourceComparison(): void {
  demoShell.dataset.effectIntent = effectIntent;
  compareSourceButton.textContent = comparingSource ? "Show Fayaaa" : "Show source";
  compareSourceButton.setAttribute("aria-pressed", String(comparingSource));
  exportStatus.textContent = comparingSource
    ? "Source view is for comparison. Show Fayaaa before exporting."
    : "Ready to export the Fayaaa result.";
}
compareSourceButton.addEventListener("click", () => {
  if (captureBusy || exportRecording) {
    announce("Finish the current export first.");
    return;
  }
  comparingSource = !comparingSource;
  logoReplayPhase = "idle";
  effectIntent = comparingSource ? "source" : "result";
  effectTransition.setTarget(comparingSource ? 0 : 1);
  syncSourceComparison();
  needsFrame = true;
  announce(comparingSource ? "Showing the original source" : "Showing the Fayaaa result");
});
syncSourceComparison();

async function copyParams(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
    announce("Fayaaa parameters copied");
  } catch {
    announce("Parameter copy failed");
  }
}
required<HTMLButtonElement>("#copy-json").addEventListener("click", () => void copyParams());

let imageLoader: ((blob: Blob, name?: string, supportsBurnAround?: boolean) => Promise<void>) | undefined;
for (const sample of document.querySelectorAll<HTMLButtonElement>("[data-sample-source]")) {
  sample.addEventListener("click", async () => {
    if (captureBusy || exportRecording) {
      announce("Finish the current export before replacing the source.");
      return;
    }
    const url = sample.dataset.sampleSource;
    const name = sample.dataset.sampleName ?? "sample";
    if (!url) return;
    closeToolbarMenus();
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${name} request failed: ${response.status}`);
      const blob = await response.blob();
      const supportsBurnAround = sample.dataset.burnAround === "true";
      if (imageLoader) await imageLoader(blob, name, supportsBurnAround);
      else if (gpuFailed) announce("The live preview needs WebGPU in this browser.");
      else {
        pendingFile = new File([blob], name, { type: blob.type });
        pendingFileSupportsBurnAround = supportsBurnAround;
      }
    } catch (error) {
      console.error(error);
      announce("That sample could not be loaded.");
    }
  });
}

for (const trigger of document.querySelectorAll<HTMLButtonElement>("[data-upload]")) {
  trigger.addEventListener("click", () => {
    closeToolbarMenus();
    fileInput.click();
  });
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (captureBusy || exportRecording) {
    announce("Finish the current export before replacing the source.");
    fileInput.value = "";
    return;
  }
  if (imageLoader) void imageLoader(file, file.name);
  else if (gpuFailed) announce("The live preview needs WebGPU in this browser.");
  else {
    pendingFile = file;
    pendingFileSupportsBurnAround = true;
  }
  fileInput.value = "";
});

backgroundFileInput.addEventListener("change", () => {
  const file = backgroundFileInput.files?.[0];
  if (!file) return;
  if (captureBusy || exportRecording) {
    announce("Finish the current export before replacing the background.");
    backgroundFileInput.value = "";
    return;
  }
  if (backgroundImageLoader) void backgroundImageLoader(file, file.name);
  else if (gpuFailed) announce("The live preview needs WebGPU in this browser.");
  else pendingBackgroundFile = file;
  backgroundFileInput.value = "";
  closeToolbarMenus();
});

let dragDepth = 0;
function setDropHintActive(active: boolean): void {
  dropHint.hidden = !active;
  dropHint.classList.toggle("active", active);
  dropHint.setAttribute("aria-hidden", String(!active));
}
window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  setDropHintActive(true);
});
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDropHintActive(false);
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  setDropHintActive(false);
  const file = event.dataTransfer?.files?.[0];
  if (captureBusy || exportRecording) {
    announce("Finish the current export before replacing the source.");
    return;
  }
  if (!file || !file.type.startsWith("image")) {
    announce("Choose a PNG, JPG, SVG, or WebP image.");
    return;
  }
  if (imageLoader) void imageLoader(file, file.name);
  else if (gpuFailed) announce("The live preview needs WebGPU in this browser.");
  else {
    pendingFile = file;
    pendingFileSupportsBurnAround = true;
  }
});

let disposed = false;
let loop: FrameLoopHandle | undefined;
let gpu: Awaited<ReturnType<typeof init>> | undefined;
let pipeline: EmberPipeline | undefined;
let stageVisible = true;
let needsFrame = true;
let userPaused = restoredSettings.paused ?? false;
let motionPaused = reducedMotion.matches;
let animationTime = motionPaused ? 1 : 0;
let logoLoopTime = 0.08;
let exportRecording = false;
let captureBusy = false;
let webmCodecs: VideoCodec[] = [];
let encodableVideoCodecs: VideoCodec[] = [];
let videoExportOpen = false;
const videoExportSettings: VideoExportSettings = {
  kind: restoredSettings.video?.kind ?? "image",
  ratio: restoredSettings.video?.ratio ?? "16:9",
  fps: restoredSettings.video?.fps ?? 30,
  quality: restoredSettings.video?.quality ?? "high",
  duration: restoredSettings.video?.duration ?? 3,
  frameX: restoredSettings.video?.frameX ?? 0,
  frameY: restoredSettings.video?.frameY ?? 0,
  scale: restoredSettings.video?.scale ?? 1,
};

function persistPlayground(): void {
  savePlaygroundSettings({
    version: 1,
    subjectKind: selectedSubjectKind,
    text: textSubjectValue,
    subjectColor,
    backgroundMode,
    backgroundColor: String(state.bgColor),
    look: requestedLook,
    blend: activeBlend,
    paused: userPaused,
    video: { ...videoExportSettings },
  });
}

function mountVideoExportControls(): void {
  exportDialkitCleanup?.();
  exportDialkitCleanup = mountExportDialKit(
    required<HTMLElement>("#export-dialkit-root"),
    {
      kind: videoExportSettings.kind,
      ratio: videoExportSettings.ratio,
      quality: videoExportSettings.quality,
      scale: 100,
      fps: videoExportSettings.fps,
      duration: videoExportSettings.duration,
    },
    (values: ExportDialValues) => {
      if (exportRunning) return;
      const ratioChanged = values.ratio !== videoExportSettings.ratio;
      videoExportSettings.kind = values.kind;
      videoExportSettings.ratio = values.ratio;
      videoExportSettings.quality = values.quality;
      videoExportSettings.scale = values.scale / 100;
      videoExportSettings.fps = values.fps;
      videoExportSettings.duration = values.duration;
      if (ratioChanged) {
        videoExportSettings.frameX = 0;
        videoExportSettings.frameY = 0;
      }
      updateVideoExportUi();
      persistPlayground();
    },
  );
}

function videoDimensions(settings: VideoExportSettings): [number, number] {
  return exportDimensions(settings);
}

function syncMotionButton(): void {
  motionPaused = userPaused || reducedMotion.matches;
  const gpuReady = document.body.classList.contains("gpu-ready");
  motionToggle.textContent = reducedMotion.matches ? "Reduced motion" : motionPaused ? "Play" : "Pause";
  motionToggle.setAttribute("aria-pressed", String(!motionPaused));
  motionToggle.setAttribute(
    "aria-label",
    reducedMotion.matches ? "Fire motion disabled by reduced motion preference" : "Fire motion",
  );
  motionToggle.disabled = !gpuReady || reducedMotion.matches;
  const replayButton = document.querySelector<HTMLButtonElement>("#replay-logo");
  if (replayButton) replayButton.disabled = !gpuReady || reducedMotion.matches;
}
syncMotionButton();

function syncReducedMotion(event: MediaQueryListEvent): void {
  motionPaused = userPaused || event.matches;
  if (event.matches) {
    logoReplayPhase = "idle";
    effectTransition.snap(effectIntent === "source" ? 0 : 1);
  }
  syncMotionButton();
  needsFrame = true;
}
reducedMotion.addEventListener("change", syncReducedMotion);

const stageObserver = new IntersectionObserver(
  ([entry]) => {
    stageVisible = entry?.isIntersecting ?? true;
    if (stageVisible) needsFrame = true;
  },
  { threshold: 0.01 },
);
stageObserver.observe(shaderStage);

void (async () => {
  try {
    gpu = await init();
    if (disposed) return gpu.dispose();

    const ctx = gpu;
    const view = surface(ctx, canvas, { dpr: [1, 2] });
    pipeline = new EmberPipeline(ctx);
    const currentPipeline = pipeline;
    currentPipeline.applyEmberParams(state);
    currentPipeline.setTransitionEnabled(true);
    currentPipeline.setEffectProgress(effectTransition.value);
    const capturePipeline = new EmberPipeline(ctx);
    const syncPipelineBackgroundMode = () => {
      const edgeActive = burnAroundActive();
      currentPipeline.setCompositedBackground(
        backgroundMode !== "color" ||
          (!edgeActive && shaderBlend !== "normal"),
      );
    };
    const syncActiveTreatment = () => {
      const edgeActive = burnAroundActive();
      state.maskMode = edgeActive ? "alpha" : "auto";
      currentPipeline.setEdgeTreatment(edgeActive);
      canvas.style.mixBlendMode = edgeActive ? "normal" : SHADER_BLEND_CSS[shaderBlend];
      demoShell.dataset.imageTreatment = edgeActive ? "edge" : "material";
      syncPipelineBackgroundMode();
      syncSourceVisibility();
    };
    backgroundModeController = (mode) => {
      backgroundMode = mode;
      syncPipelineBackgroundMode();
      needsFrame = true;
    };
    shaderBlendController = (blend) => {
      shaderBlend = blend;
      currentPipeline.setBlendMode(SHADER_BLEND_UNIFORM[blend]);
      syncActiveTreatment();
      needsFrame = true;
    };
    backgroundColorController = () => {
      currentPipeline.applyEmberParams(state);
      needsFrame = true;
    };
    subjectColorController = (color) => {
      state.baseColor = color;
      currentPipeline.applyEmberParams(state);
      needsFrame = true;
    };
    backgroundModeController(backgroundMode);
    shaderBlendController(shaderBlend);
    updateDirectionUi(readHeatDirection(state.heatAngle));

    async function rasterizeImage(
      blob: Blob,
    ): Promise<Omit<RasterizedSource, "name" | "previewUrl" | "kind">> {
      const url = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const max = 1024;
        // SVGs re-rasterize losslessly at any scale, so draw them at the full
        // pipeline resolution — their intrinsic size (often a tiny viewBox
        // default like 150px) would otherwise staircase every magnified edge.
        // Bitmaps keep the no-upscale rule; enlarging them adds nothing.
        const isVector = blob.type === "image/svg+xml";
        const largest = Math.max(image.naturalWidth, image.naturalHeight) || max;
        const ratio = isVector ? max / largest : Math.min(1, max / largest);
        const staging = document.createElement("canvas");
        staging.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        staging.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const context = staging.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas 2D is unavailable");
        context.drawImage(image, 0, 0, staging.width, staging.height);

        const pixels = context.getImageData(0, 0, staging.width, staging.height).data;
        const autoMaskMode = inferMaskMode(pixels, staging.width, staging.height) as AutomaticMaskMode;
        return {
          canvas: staging,
          hasAlpha: autoMaskMode === "alpha",
          autoMaskMode,
          aspect: staging.width / staging.height,
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    async function sourceFromUrl(
      url: string,
      name: string,
      supportsBurnAround = false,
    ): Promise<RasterizedSource> {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${name} request failed: ${response.status}`);
      return {
        ...(await rasterizeImage(await response.blob())),
        name,
        previewUrl: url,
        kind: "image",
        supportsBurnAround,
      };
    }

    function commitSource(source: RasterizedSource): void {
      currentSource = source;
      currentSourceAspect = source.aspect;
      currentPipeline.setImage(source.canvas, source.hasAlpha, source.autoMaskMode);
      syncActiveTreatment();
      currentPipeline.rebuild(state);
      sourceName.textContent = source.name;
      sourcePreview.src = source.previewUrl;
      syncSubjectUi(source);
      updateSourceBounds();
      needsFrame = true;
    }

    function restartSourceReveal(): void {
      effectIntent = "auto";
      logoReplayPhase = "idle";
      comparingSource = false;
      syncSourceComparison();
      if (reducedMotion.matches) effectTransition.snap(1);
      else effectTransition.restart(0.12);
      currentPipeline.setEffectProgress(effectTransition.value);
      needsFrame = true;
    }

    const wordmarkCanvas = createTypeSource();
    const markSource: RasterizedSource = {
      canvas: wordmarkCanvas,
      hasAlpha: true,
      autoMaskMode: "alpha",
      aspect: wordmarkCanvas.width / wordmarkCanvas.height,
      name: "fayaaa logo",
      previewUrl: wordmarkCanvas.toDataURL("image/png"),
      kind: "text",
      supportsBurnAround: false,
    };
    const routeDefaultSource = routeSourceAsset
      ? await sourceFromUrl(routeSourceAsset.url, routeSourceAsset.name)
      : markSource;

    const [storedSubjectAsset, storedBackgroundAsset] = await Promise.all([
      loadPlaygroundAsset("subject"),
      loadPlaygroundAsset("background"),
    ]);
    if (storedSubjectAsset && selectedSubjectKind === "image") {
      const previewUrl = URL.createObjectURL(storedSubjectAsset.blob);
      userPreviewObjectUrls.image = previewUrl;
      userImageSource = {
        ...(await rasterizeImage(storedSubjectAsset.blob)),
        name: storedSubjectAsset.name,
        previewUrl,
        kind: "image",
        supportsBurnAround: !BUILT_IN_ICON_SOURCES.has(storedSubjectAsset.name),
      };
    }
    if (storedBackgroundAsset) {
      backgroundObjectUrl = URL.createObjectURL(storedBackgroundAsset.blob);
      backgroundSource = {
        ...(await rasterizeImage(storedBackgroundAsset.blob)),
        name: storedBackgroundAsset.name,
        previewUrl: backgroundObjectUrl,
        kind: "image",
        supportsBurnAround: false,
      };
      backgroundPreview.src = backgroundObjectUrl;
      backgroundFileName.textContent = storedBackgroundAsset.name;
      syncBackgroundUi();
    } else if (backgroundMode === "image") {
      backgroundMode = "color";
      syncBackgroundUi();
      persistPlayground();
    }

    let uploadRequest = 0;
    let pendingSourceSwap: PendingSourceSwap | undefined;
    let sourceCommitScheduled = false;

    function cancelPendingSourceSwap(): void {
      if (pendingSourceSwap?.revokeIfCanceled) URL.revokeObjectURL(pendingSourceSwap.source.previewUrl);
      pendingSourceSwap = undefined;
    }

    function queueSourceSwap(swap: PendingSourceSwap): void {
      cancelPendingSourceSwap();
      pendingSourceSwap = swap;
      effectIntent = "auto";
      logoReplayPhase = "idle";
      comparingSource = false;
      effectTransition.setTarget(0);
      syncSourceComparison();
      needsFrame = true;
    }

    function commitPendingSourceSwap(): void {
      const pending = pendingSourceSwap;
      if (!pending || effectTransition.target !== 0 || !effectTransition.settled) return;
      if (pending.request !== uploadRequest || pending.selection !== sourceSelectionVersion) {
        cancelPendingSourceSwap();
        return;
      }

      if (pending.userSource) {
        if (pending.source.kind === "text") {
          userTextSource = pending.source;
        } else {
          if (pending.mode === "shape") userLogoSource = pending.source;
          else if (pending.mode === "paper") userPaperSource = pending.source;
          else userImageSource = pending.source;
          const previousUrl = userPreviewObjectUrls[pending.mode];
          if (previousUrl && previousUrl !== pending.source.previewUrl) URL.revokeObjectURL(previousUrl);
          userPreviewObjectUrls[pending.mode] = pending.source.previewUrl;
        }
      } else {
        const previousUrl = userPreviewObjectUrls[pending.mode];
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        delete userPreviewObjectUrls[pending.mode];
      }

      pendingSourceSwap = undefined;
      commitSource(pending.source);
      restartSourceReveal();
      announce(`${pending.source.name} is ready. Igniting its edge.`);
    }

    function schedulePendingSourceCommit(): void {
      if (sourceCommitScheduled || !pendingSourceSwap) return;
      if (effectTransition.target !== 0 || !effectTransition.settled) return;
      sourceCommitScheduled = true;
      // setImage/rebuild submits its own GPU frame. Run it after the active
      // render callback has fully unwound so VGPU never sees a nested frame.
      queueMicrotask(() => {
        sourceCommitScheduled = false;
        if (!disposed) commitPendingSourceSwap();
      });
    }

    function commitPendingBlend(): void {
      if (!pendingBlend || effectTransition.target !== 0 || !effectTransition.settled) return;
      activeBlend = pendingBlend;
      pendingBlend = undefined;
      blendSelect.value = activeBlend;
      demoShell.dataset.blend = previewMode === "paper" ? activeBlend : "normal";
      // Give the unchanged source one short, readable beat before the edge
      // returns. This also makes rapid blend changes reverse cleanly.
      effectTransition.hold(0.04);
      needsFrame = true;
      persistPlayground();
      announce(`Paper blend mode: ${activeBlend}`);
    }

    sourceController = async (mode) => {
      if (mode !== previewMode) return;
      setHeatAngle(modeAngles[mode]);
      let source: RasterizedSource;
      if (mode === "paper") {
        source = userPaperSource ?? routeDefaultSource;
      } else if (mode === "image") {
        source = userImageSource ?? routeDefaultSource;
      } else {
        source = userLogoSource ?? markSource;
      }
      if (!currentSource) {
        commitSource(source);
        restartSourceReveal();
      } else {
        queueSourceSwap({
          source,
          mode,
          request: uploadRequest,
          selection: sourceSelectionVersion,
          userSource: Boolean(
            mode === "shape" ? userLogoSource : mode === "paper" ? userPaperSource : userImageSource
          ),
          revokeIfCanceled: false,
        });
      }
    };

    state.heatAngle = modeAngles[previewMode];
    currentPipeline.applyEmberParams(state);
    updateDirectionUi(readHeatDirection(state.heatAngle));
    // The intro only plays on a default boot: motion allowed, image subject,
    // and no restored upload. Otherwise reveal the chrome right away.
    const introPlanned =
      !pendingShowcasePreset &&
      !hotReloaded &&
      !reducedMotion.matches &&
      (introForced ||
        (selectedSubjectKind === "image" && !userImageSource && !introAlreadySeen()));
    if (!introPlanned) document.body.classList.remove("intro-playing");
    if (introPlanned) {
      // The intro commits its own sources once the frame loop is running.
    } else if (selectedSubjectKind === "text") {
      const sourceCanvas = createTypeSource(textSubjectValue);
      userTextSource = {
        canvas: sourceCanvas,
        hasAlpha: true,
        autoMaskMode: "alpha",
        aspect: sourceCanvas.width / sourceCanvas.height,
        name: textSubjectValue,
        previewUrl: sourceCanvas.toDataURL("image/png"),
        kind: "text",
        supportsBurnAround: false,
      };
      commitSource(userTextSource);
      restartSourceReveal();
    } else {
      await sourceController(previewMode);
    }

    let currentSetupSnapshot: CurrentSetupSnapshot | undefined;
    let showcaseRequest = 0;
    const showcaseImageCache = new Map<string, RasterizedSource>();

    const loadShowcaseImage = async (
      url: string,
      name: string,
      supportsBurnAround = false,
    ): Promise<RasterizedSource> => {
      const key = `${url}:${supportsBurnAround}`;
      const cached = showcaseImageCache.get(key);
      if (cached) return cached;
      const source = await sourceFromUrl(url, name, supportsBurnAround);
      showcaseImageCache.set(key, source);
      return source;
    };

    const captureCurrentSetup = (): void => {
      if (currentSetupSnapshot || !currentSource) return;
      currentSetupSnapshot = {
        source: currentSource,
        backgroundSource,
        backgroundMode,
        colors: {
          baseColor: String(state.baseColor),
          rimColor: String(state.rimColor),
          hotColor: String(state.hotColor),
          coolColor: String(state.coolColor),
          bgColor: String(state.bgColor),
        },
        look: requestedLook,
        subjectColor,
        text: textSubjectValue,
      };
    };

    const applyLookInstantly = (look: LookId, backgroundColor?: string): void => {
      cancelAnimationFrame(lookAnimationFrame);
      lookAnimationFrame = 0;
      requestedLook = look;
      const colors = LOOKS[look] as Record<(typeof LOOK_COLOR_KEYS)[number], string>;
      for (const key of LOOK_COLOR_KEYS) state[key] = colors[key];
      if (backgroundColor) state.bgColor = backgroundColor;
      syncLookUi(look);
      currentPipeline.applyEmberParams(state);
    };

    showcasePresetController = async (preset) => {
      if (captureBusy || exportRecording) {
        announce("Finish the current export before changing the preset.");
        return;
      }

      const request = ++showcaseRequest;
      closeToolbarMenus();
      closeStageTextEditor();

      if (preset === "current") {
        const snapshot = currentSetupSnapshot;
        if (!snapshot) {
          announce("Current setup is already active");
          return;
        }
        sourceSelectionVersion += 1;
        cancelPendingSourceSwap();
        requestedLook = snapshot.look;
        subjectColor = snapshot.subjectColor;
        textSubjectValue = snapshot.text;
        Object.assign(state, snapshot.colors);
        subjectColorController?.(subjectColor);
        syncLookUi(snapshot.look);
        backgroundSource = snapshot.backgroundSource;
        backgroundMode = snapshot.backgroundMode;
        if (backgroundSource) {
          backgroundPreview.src = backgroundSource.previewUrl;
          backgroundFileName.textContent = backgroundSource.name;
        }
        syncBackgroundUi();
        commitSource(snapshot.source);
        restartSourceReveal();
        persistPlayground();
        announce("Current setup restored");
        return;
      }

      captureCurrentSetup();
      const scene = SHOWCASE_SCENES[preset];
      const subjectPromise = scene.subject.kind === "text"
        ? Promise.resolve<RasterizedSource>((() => {
          const sourceCanvas = createTypeSource(scene.subject.value);
          return {
            canvas: sourceCanvas,
            hasAlpha: true,
            autoMaskMode: "alpha",
            aspect: sourceCanvas.width / sourceCanvas.height,
            name: scene.subject.value,
            previewUrl: sourceCanvas.toDataURL("image/png"),
            kind: "text",
            supportsBurnAround: false,
          };
        })())
        : loadShowcaseImage(
          scene.subject.url,
          scene.subject.name,
          scene.subject.supportsBurnAround,
        );
      const backgroundPromise = scene.background.mode === "image"
        ? loadShowcaseImage(scene.background.url, scene.background.name)
        : Promise.resolve(undefined);

      try {
        const [subject, sceneBackground] = await Promise.all([subjectPromise, backgroundPromise]);
        if (request !== showcaseRequest) return;
        sourceSelectionVersion += 1;
        cancelPendingSourceSwap();
        subjectColor = scene.subjectColor;
        state.baseColor = scene.subjectColor;
        subjectColorController?.(scene.subjectColor);
        applyLookInstantly(
          scene.look,
          scene.background.mode === "color" ? scene.background.color : undefined,
        );
        if (sceneBackground) {
          backgroundSource = sceneBackground;
          backgroundPreview.src = sceneBackground.previewUrl;
          backgroundFileName.textContent = sceneBackground.name;
        }
        backgroundMode = scene.background.mode;
        syncBackgroundUi();
        if (scene.subject.kind === "text") textSubjectValue = scene.subject.value;
        commitSource(subject);
        restartSourceReveal();
        persistPlayground();
        announce(`${scene.label} preset applied`);
      } catch (error) {
        console.error(error);
        announce("That preset could not be loaded.");
      }
    };

    if (pendingShowcasePreset) {
      const preset = pendingShowcasePreset;
      pendingShowcasePreset = undefined;
      void showcasePresetController(preset);
    }

    function updateExportDetails(): void {
      const dimensions = `${EXPORT_WIDTH} × ${EXPORT_HEIGHT}`;
      for (const note of pngNotes) note.textContent = `${dimensions} flattened PNG`;
      if (webmCodecs.length > 0) {
        for (const note of recordNotes) note.textContent = `${dimensions} · 3 second flattened WebM`;
      }
    }

    view.onResize(({ width, height }) => {
      currentPipeline.composite.set({ g: { size: [width, height], aspect: width / height } });
      updateSourceBounds();
      updateExportDetails();
      needsFrame = true;
    });
    updateExportDetails();

    applyDialValues = (values) => {
      const previousImage = [state.scale, state.offsetX, state.offsetY].join(":");
      const nextShaderBlend = values.fire.blend as ShaderBlend;
      const nextImageTreatment = values.fire.treatment as ImageTreatment;
      const treatmentChanged = nextImageTreatment !== imageTreatment;
      // Choosing a Direction from the dials ends the attract loop for good
      // (the first onValues call is the boot sync, not a choice).
      if (lastDialDirection !== undefined && values.fire.direction !== lastDialDirection) {
        attractOrbitActive = false;
      }
      lastDialDirection = values.fire.direction;
      Object.assign(state, {
        scale: values.subject.size / 100,
        offsetX: values.subject.leftRight / 100,
        offsetY: values.subject.upDown / 100,
        // The recovered playground used the supplied alpha boundary: a flat
        // photo burns at its outer rectangle and a transparent PNG follows its
        // silhouette. The newer treatment intentionally infers light/dark
        // image detail so the fire can travel through pixels inside the image.
        maskMode: "auto",
        heatAngle: readHeatDirection(values.fire.direction),
        glowIntensity: values.fire.intensity * 0.05,
        glowSpread: 0.001 + values.fire.spread * 0.0005,
        innerGlow: values.fire.insideGlow * 0.02,
        edgeSharpness: values.fire.sharpness / 100,
        speed: values.motion.speed * 0.02,
        flickerAmount: values.motion.flicker * 0.005,
        waverAmount: values.motion.shimmer * 0.0005,
        grainAmount: values.motion.grain * 0.005,
      });

      currentPipeline.applyEmberParams(state);
      imageTreatment = nextImageTreatment;
      syncActiveTreatment();
      shaderBlendController?.(nextShaderBlend);
      syncPipelineBackgroundMode();
      syncSourceVisibility();
      const nextImage = [state.scale, state.offsetX, state.offsetY].join(":");
      if (nextImage !== previousImage || treatmentChanged) currentPipeline.rebuild(state);
      modeAngles[previewMode] = readHeatDirection(state.heatAngle);
      updateDirectionUi(readHeatDirection(state.heatAngle));
      syncStageBackground();
      updateSourceBounds();
      needsFrame = true;
    };
    if (latestDialValues) applyDialValues(latestDialValues);

    imageLoader = async (blob, name = "uploaded image", supportsBurnAround = true) => {
      if (captureBusy || exportRecording) {
        announce("Finish the current export before replacing the source.");
        return;
      }
      const request = ++uploadRequest;
      const selection = sourceSelectionVersion;
      const targetMode = previewMode;
      try {
        const rasterized = await rasterizeImage(blob);
        if (request !== uploadRequest || selection !== sourceSelectionVersion) return;
        const previewUrl = URL.createObjectURL(blob);
        const source: RasterizedSource = {
          ...rasterized,
          name,
          previewUrl,
          kind: "image",
          supportsBurnAround,
        };
        selectedSubjectKind = "image";
        void savePlaygroundAsset("subject", blob, name);
        persistPlayground();
        syncModeUi(targetMode);
        queueSourceSwap({
          source,
          mode: targetMode,
          request,
          selection,
          userSource: true,
          revokeIfCanceled: true,
        });
        announce(`${name} loaded. Returning to the source before ignition.`);
      } catch (error) {
        console.error(error);
        announce("That image could not be loaded. Try another PNG, JPG, SVG, or WebP.");
      }
    };

    textSourceLoader = (text, instant = false) => {
      if (captureBusy || exportRecording) {
        announce("Finish the current export before replacing the subject.");
        return;
      }
      const value = text.trim().slice(0, 40) || "Fayaaa";
      textSubjectValue = value;
      selectedSubjectKind = "text";
      persistPlayground();
      const request = ++uploadRequest;
      const sourceCanvas = createTypeSource(value);
      const source: RasterizedSource = {
        canvas: sourceCanvas,
        hasAlpha: true,
        autoMaskMode: "alpha",
        aspect: sourceCanvas.width / sourceCanvas.height,
        name: value,
        previewUrl: sourceCanvas.toDataURL("image/png"),
        kind: "text",
        supportsBurnAround: false,
      };
      if (instant && currentSource?.kind === "text") {
        userTextSource = source;
        commitSource(source);
        currentPipeline.setEffectProgress(effectTransition.value);
        needsFrame = true;
        announce(`${value} updated in the playground`);
        return;
      }
      queueSourceSwap({
        source,
        mode: previewMode,
        request,
        selection: sourceSelectionVersion,
        userSource: true,
        revokeIfCanceled: false,
      });
      announce(`${value} loaded as text. Igniting its edge.`);
    };

    backgroundImageLoader = async (blob, name = "background image") => {
      if (captureBusy || exportRecording) {
        announce("Finish the current export before replacing the background.");
        return;
      }
      try {
        const rasterized = await rasterizeImage(blob);
        if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
        backgroundObjectUrl = URL.createObjectURL(blob);
        backgroundSource = {
          ...rasterized,
          name,
          previewUrl: backgroundObjectUrl,
          kind: "image",
          supportsBurnAround: false,
        };
        backgroundPreview.src = backgroundObjectUrl;
        backgroundFileName.textContent = name;
        backgroundMode = "image";
        void savePlaygroundAsset("background", blob, name);
        syncBackgroundUi();
        persistPlayground();
        announce(`${name} is now the background`);
      } catch (error) {
        console.error(error);
        announce("That background could not be loaded. Try another PNG, JPG, SVG, or WebP.");
      }
    };

    if (pendingBackgroundFile) {
      const file = pendingBackgroundFile;
      pendingBackgroundFile = undefined;
      void backgroundImageLoader(file, file.name);
    }

    required<HTMLButtonElement>("#clear-image").addEventListener("click", () => {
      if (captureBusy || exportRecording) {
        announce("Finish the current export before resetting the source.");
        return;
      }
      uploadRequest += 1;
      sourceSelectionVersion += 1;
      cancelPendingSourceSwap();
      if (previewMode === "shape") userLogoSource = undefined;
      else if (previewMode === "image") userImageSource = undefined;
      else userPaperSource = undefined;
      if (previewMode === "image") void clearPlaygroundAsset("subject");
      void sourceController?.(previewMode);
      persistPlayground();
      announce("Returning to the original demo source");
    });

    function restoreFire(next: Partial<ParamState> = {}): void {
      cancelAnimationFrame(lookAnimationFrame);
      Object.assign(state, DEFAULTS, next);
      state.maskMode = burnAroundActive() ? "alpha" : "auto";
      state.baseColor = subjectColor;
      modeAngles[previewMode] = readHeatDirection(state.heatAngle);
      currentPipeline.applyEmberParams(state);
      currentPipeline.rebuild(state);
      syncStageBackground();
      updateDirectionUi(readHeatDirection(state.heatAngle));
      updateSourceBounds();
      needsFrame = true;
    }

    required<HTMLButtonElement>("#reset").addEventListener("click", () => {
      restoreFire();
      requestedLook = "fire";
      syncLookUi("fire");
      persistPlayground();
      announce("Exact Fire reference restored");
    });

    presetSelect.value = "fire";
    presetSelect.addEventListener("change", () => {
      const look = presetSelect.value as LookId;
      lookController?.(look);
    });

    lookController = (look) => {
      if (exportRecording) {
        announce("Finish the current recording before changing the look.");
        return;
      }
      cancelAnimationFrame(lookAnimationFrame);
      requestedLook = look;
      syncLookUi(look);
      const starts = Object.fromEntries(
        LOOK_COLOR_KEYS.map((key) => [key, String(state[key])]),
      ) as Record<(typeof LOOK_COLOR_KEYS)[number], string>;
      const targets = LOOKS[look] as Record<(typeof LOOK_COLOR_KEYS)[number], string>;
      const startedAt = performance.now();
      const duration = reducedMotion.matches ? 0 : 240;
      const updateLook = (now: number) => {
        const linear = duration ? Math.min(1, (now - startedAt) / duration) : 1;
        const eased = 1 - (1 - linear) ** 3;
        for (const key of LOOK_COLOR_KEYS) state[key] = mixHex(starts[key], targets[key], eased);
        currentPipeline.applyEmberParams(state);
        syncStageBackground();
        needsFrame = true;
        if (linear < 1) {
          lookAnimationFrame = requestAnimationFrame(updateLook);
        } else {
          lookAnimationFrame = 0;
          persistPlayground();
        }
      };
      updateLook(startedAt);
      announce(`${LOOK_LABELS[look]} colors applied to the live material`);
    };
    syncLookUi(requestedLook);

    function getPresentationRect(
      sourceAspect: number,
      params: ParamState,
      width: number,
      height: number,
    ): PresentationSnapshot["sourceRect"] {
      const aspect = width / height;
      const side = Math.max(aspect, 1);
      const [x0, y0, x1, y1] = computeRect(sourceAspect, params);
      const left = 0.5 + ((x0 - 0.5) * side) / aspect;
      const top = 0.5 + (y0 - 0.5) * side;
      return {
        x: left * width,
        y: top * height,
        width: (((x1 - x0) * side) / aspect) * width,
        height: ((y1 - y0) * side) * height,
      };
    }

    function cloneSource(source: HTMLCanvasElement): HTMLCanvasElement {
      const clone = document.createElement("canvas");
      clone.width = source.width;
      clone.height = source.height;
      clone.getContext("2d")?.drawImage(source, 0, 0);
      return clone;
    }

    function capturePresentation(width: number, height: number): PresentationSnapshot {
      const blend = (activeBlend === "normal" ? "source-over" : activeBlend) as
        GlobalCompositeOperation;
      const params = { ...state };
      const sourceAspect = currentSource?.aspect ?? currentSourceAspect;
      return {
        params,
        mode: previewMode,
        source: currentSource ? cloneSource(currentSource.canvas) : undefined,
        sourceRect: getPresentationRect(sourceAspect, params, width, height),
        sourceAspect,
        sourceHasAlpha: currentSource?.hasAlpha ?? true,
        sourceMaskMode: currentSource?.autoMaskMode ?? "alpha",
        blend,
        shaderBlendMode: shaderBlend,
        shaderBlend: SHADER_BLEND_CANVAS[shaderBlend],
        sourceAlpha: previewMode === "paper"
          ? PAPER_SOURCE_OPACITY
          : previewMode === "shape"
            ? SHAPE_SOURCE_OPACITY
            : 1,
        alpha: activeBlend === "multiply" ? PAPER_MULTIPLY_SHADER_OPACITY : 1,
        animationTime,
        effectProgress: effectTransition.value,
        motionPaused,
        backgroundMode,
        imageTreatment: burnAroundActive() ? "edge" : "material",
        background: backgroundSource ? cloneSource(backgroundSource.canvas) : undefined,
      };
    }

    function drawPresentation(
      context: CanvasRenderingContext2D,
      fireSource: CanvasImageSource,
      width: number,
      height: number,
      presentation: PresentationSnapshot,
    ): void {
      context.save();
      context.clearRect(0, 0, width, height);
      if (presentation.backgroundMode === "color") {
        context.fillStyle = String(presentation.params.bgColor);
        context.fillRect(0, 0, width, height);
      } else if (presentation.backgroundMode === "image" && presentation.background) {
        const backgroundWidth = presentation.background.width;
        const backgroundHeight = presentation.background.height;
        const scale = Math.max(width / backgroundWidth, height / backgroundHeight);
        const drawnWidth = backgroundWidth * scale;
        const drawnHeight = backgroundHeight * scale;
        context.drawImage(
          presentation.background,
          (width - drawnWidth) / 2,
          (height - drawnHeight) / 2,
          drawnWidth,
          drawnHeight,
        );
      }
      if (
        presentation.imageTreatment !== "edge" &&
        presentation.source &&
        presentation.sourceRect
      ) {
        const rect = presentation.sourceRect;
        const sourceVisibility = presentation.backgroundMode === "color"
          ? 1
          : Math.max(0, 1 - presentation.effectProgress);
        context.globalAlpha = presentation.sourceAlpha * sourceVisibility;
        context.drawImage(presentation.source, rect.x, rect.y, rect.width, rect.height);
        context.globalAlpha = 1;
      }
      if (presentation.mode === "paper") {
        context.globalCompositeOperation = presentation.blend;
        context.globalAlpha = presentation.alpha;
      }
      context.globalCompositeOperation = presentation.imageTreatment === "edge"
        ? "source-over"
        : presentation.shaderBlend;
      context.drawImage(fireSource, 0, 0, width, height);
      context.restore();
    }

    const captureCanvas = document.createElement("canvas");
    let captureView = surface(ctx, captureCanvas, {
      size: [EXPORT_WIDTH, EXPORT_HEIGHT],
      autoResize: false,
      dpr: 1,
      label: "fayaaa-capture-surface",
    });
    const captureOutput = document.createElement("canvas");
    captureOutput.width = EXPORT_WIDTH;
    captureOutput.height = EXPORT_HEIGHT;
    const resolvedCaptureContext = captureOutput.getContext("2d");
    if (!resolvedCaptureContext) throw new Error("Canvas composition is unavailable in this browser.");
    const captureContext: CanvasRenderingContext2D = resolvedCaptureContext;
    captureContext.imageSmoothingEnabled = true;
    captureContext.imageSmoothingQuality = "high";

    let captureWidth = EXPORT_WIDTH;
    let captureHeight = EXPORT_HEIGHT;

    function configureCaptureSize(width: number, height: number): void {
      if (width === captureWidth && height === captureHeight) return;
      captureWidth = width;
      captureHeight = height;
      captureView.dispose();
      captureView = surface(ctx, captureCanvas, {
        size: [width, height],
        autoResize: false,
        dpr: 1,
        label: `fayaaa-capture-${width}x${height}`,
      });
      captureOutput.width = width;
      captureOutput.height = height;
      captureContext.imageSmoothingEnabled = true;
      captureContext.imageSmoothingQuality = "high";
    }

    function prepareCapture(presentation: PresentationSnapshot, width: number, height: number): void {
      configureCaptureSize(width, height);
      if (presentation.source) {
        capturePipeline.setImage(
          presentation.source,
          presentation.sourceHasAlpha,
          presentation.sourceMaskMode,
        );
      } else {
        capturePipeline.clearImage();
      }
      const captureParams = {
        ...presentation.params,
        maskMode: presentation.imageTreatment === "edge" ? "alpha" : "auto",
      };
      capturePipeline.applyEmberParams(captureParams);
      capturePipeline.setBlendMode(SHADER_BLEND_UNIFORM[presentation.shaderBlendMode]);
      capturePipeline.setCompositedBackground(
        presentation.backgroundMode !== "color" ||
          (presentation.imageTreatment !== "edge" &&
            presentation.shaderBlend !== "source-over"),
      );
      capturePipeline.setEdgeTreatment(presentation.imageTreatment === "edge");
      capturePipeline.setTransitionEnabled(true);
      capturePipeline.rebuild(captureParams);
      capturePipeline.composite.set({
        g: { size: [width, height], aspect: width / height },
      });
    }

    async function renderCaptureFrame(
      presentation: PresentationSnapshot,
      time: number,
      progress: number,
      width: number,
      height: number,
    ): Promise<HTMLCanvasElement> {
      capturePipeline.setEffectProgress(progress);
      capturePipeline.composite.set({ g: { time } });
      frame(ctx, (gpuFrame) => gpuFrame.pass(captureView, capturePipeline.composite));
      await ctx.gpu.queue.onSubmittedWorkDone();
      drawPresentation(
        captureContext,
        captureCanvas,
        width,
        height,
        { ...presentation, effectProgress: progress },
      );
      return captureOutput;
    }

    function canvasBlob(output: HTMLCanvasElement): Promise<Blob> {
      return new Promise((resolve, reject) => {
        output.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("The browser could not encode this PNG."));
        }, "image/png");
      });
    }

    function applyExportFraming(presentation: PresentationSnapshot, settings: VideoExportSettings, width: number, height: number): void {
      presentation.params = {
        ...presentation.params,
        scale: Number(presentation.params.scale) * settings.scale,
        offsetX: Number(presentation.params.offsetX) - settings.frameX * 0.18,
        offsetY: Number(presentation.params.offsetY) - settings.frameY * 0.18,
      };
      presentation.sourceRect = presentation.source
        ? getPresentationRect(presentation.sourceAspect, presentation.params, width, height)
        : undefined;
    }

    function setExportProgress(title: string, progress: number): void {
      const percent = Math.round(progress * 100);
      exportProgressTitle.textContent = title;
      exportProgressDetail.textContent = `${percent}%`;
      exportProgressMeter.value = percent;
    }

    async function exportFrame(settings: VideoExportSettings = videoExportSettings, signal = new AbortController().signal): Promise<void> {
      if (pendingSourceSwap || pendingBlend) {
        announce("Wait for the new source to finish igniting before exporting.");
        return;
      }
      if (comparingSource) {
        announce("Show Fayaaa before exporting the result.");
        return;
      }
      if (captureBusy) {
        announce("Finish the current export first.");
        return;
      }
      const [width, height] = videoDimensions(settings);
      const presentation = capturePresentation(width, height);
      applyExportFraming(presentation, settings, width, height);
      captureBusy = true;
      exportStatus.textContent = "Rendering the current composition…";
      try {
        setExportProgress("Rendering image", 0.2);
        prepareCapture(presentation, width, height);
        const output = await renderCaptureFrame(
          presentation,
          presentation.animationTime,
          1,
          width,
          height,
        );
        if (signal.aborted) throw new DOMException("Export canceled", "AbortError");
        setExportProgress("Encoding PNG", 0.8);
        const png = await canvasBlob(output);
        const verified = await createImageBitmap(png);
        const verifiedWidth = verified.width;
        const verifiedHeight = verified.height;
        verified.close();
        if (verifiedWidth !== width || verifiedHeight !== height || png.type !== "image/png") {
          throw new Error("The encoded image did not match the requested export settings.");
        }
        downloadBlob(png, `fayaaa-${settings.ratio.replace(":", "x")}-${width}x${height}.png`);
        setExportProgress("Image ready", 1);
        exportStatus.textContent = `Verified ${verifiedWidth} × ${verifiedHeight} lossless PNG exported.`;
        announce("Fayaaa frame exported as PNG");
      } catch (error) {
        const message = signal.aborted ? "Image export canceled." : error instanceof Error ? error.message : "PNG export failed.";
        exportStatus.textContent = message;
        announce(message);
      } finally {
        captureBusy = false;
      }
    }
    imageExporter = exportFrame;

    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-export-frame]")) {
      button.addEventListener("click", () => {
        setToolbarMenuOpen(downloadPicker, false);
        openVideoExport();
      });
    }
    required<HTMLButtonElement>("#export").addEventListener("click", () => void exportFrame());

    const recordButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-record-clip]")];
    const recordButtonLabels = new Map(recordButtons.map((button) => [button, button.textContent ?? "Record"]));
    const recordingMutators = [...document.querySelectorAll<
      HTMLButtonElement | HTMLSelectElement | HTMLInputElement
    >(
      "[data-angle], [data-upload], [data-upload-background], [data-subject-tab], [data-edit-text], " +
      "[data-finish-text], [data-use-sample], " +
      "[data-background-mode], [data-export-frame], [data-record-clip], " +
      "#export, #clear-image, #motion-toggle, #replay-logo, #compare-source, #blend-mode, #preset, #reset, " +
      "#file, #background-file, #stage-text-input, #background-color",
    )];

    async function encodeClip(
      presentation: PresentationSnapshot,
      codec: VideoCodec,
      format: "mp4" | "webm",
      settings: VideoExportSettings,
      width: number,
      height: number,
      signal: AbortSignal,
    ): Promise<Blob> {
      const quality = VIDEO_QUALITIES[settings.quality];
      const targetBuffer = new BufferTarget();
      const output = new Output({
        format: format === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
        target: targetBuffer,
      });
      const videoSource = new CanvasSource(captureOutput, {
        codec,
        quality: new Quality({ bitrate: quality.bitrate, bitrateMode: "variable" }),
        keyFrameInterval: 2,
      });
      output.addVideoTrack(videoSource, { frameRate: settings.fps });
      const frameCount = settings.fps * settings.duration;

      try {
        await output.start();
        for (let index = 0; index < frameCount; index += 1) {
          if (signal.aborted) throw new DOMException("Export canceled", "AbortError");
          const timestamp = index / settings.fps;
          const shaderTime = presentation.animationTime + (
            presentation.motionPaused ? 0 : timestamp * Number(presentation.params.speed)
          );
          // Export the fully engaged hover treatment on every frame. The user
          // cannot keep a pointer over a downloaded file, so an export-only
          // reveal loop would silently replace the composition they approved.
          await renderCaptureFrame(presentation, shaderTime, 1, width, height);
          await videoSource.add(timestamp, 1 / settings.fps, {
            keyFrame: index === 0 || index % (settings.fps * 2) === 0,
          });

          const encodeProgress = (index + 1) / frameCount;
          const percent = Math.round(encodeProgress * 100);
          exportStatus.textContent = `Encoding ${width} × ${height} ${format.toUpperCase()}… ${percent}%`;
          setExportProgress(`Encoding ${format.toUpperCase()}`, encodeProgress);
          for (const button of recordButtons) button.textContent = `${percent}%`;
        }
        await output.finalize();
      } catch (error) {
        if (output.state !== "canceled" && output.state !== "finalized") {
          await output.cancel().catch(() => undefined);
        }
        throw error;
      }

      if (!targetBuffer.buffer) throw new Error(`The ${format.toUpperCase()} encoder produced no output.`);
      return new Blob([targetBuffer.buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" });
    }

    async function inspectEncodedClip(blob: Blob): Promise<{ codec: string; width: number; height: number; duration: number; color: VideoColorSpaceInit }> {
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      if (!(await input.canRead())) throw new Error("The encoded file could not be read back for verification.");
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("The encoded file contains no video track.");
      return {
        codec: (await track.getCodec()) ?? "unknown",
        width: await track.getCodedWidth(),
        height: await track.getCodedHeight(),
        duration: await input.computeDuration(),
        color: await track.getColorSpace(),
      };
    }

    async function recordClip(settings: VideoExportSettings, signal: AbortSignal): Promise<void> {
      if (pendingSourceSwap || pendingBlend) {
        announce("Wait for the new source to finish igniting before recording.");
        return;
      }
      if (comparingSource) {
        announce("Show Fayaaa before recording the result.");
        return;
      }
      if (exportRecording) return;
      if (captureBusy) {
        announce("Finish the current export first.");
        return;
      }
      const selectedFormat = chooseVideoFormat(encodableVideoCodecs);
      if (!selectedFormat) {
        const message = "Video encoding is not available in this browser. Image export still works.";
        exportStatus.textContent = message;
        announce(message);
        return;
      }
      const [width, height] = videoDimensions(settings);
      const presentation = capturePresentation(width, height);
      applyExportFraming(presentation, settings, width, height);
      captureBusy = true;
      exportRecording = true;
      const previousDisabled = new Map(recordingMutators.map((control) => [control, control.disabled]));
      for (const control of recordingMutators) control.disabled = true;
      for (const button of recordButtons) button.disabled = true;
      demoShell.dataset.recording = "true";
      needsFrame = true;

      try {
        exportStatus.textContent = "Preparing a real 1280 × 720 capture…";
        prepareCapture(presentation, width, height);

        if (selectedFormat.format === "webm") {
          announce("MP4 is unavailable in this browser. Exporting a high-quality WebM instead.");
        }
        const video = await encodeClip(presentation, selectedFormat.codec, selectedFormat.format, settings, width, height, signal);
        if (signal.aborted) throw new DOMException("Export canceled", "AbortError");
        setExportProgress("Verifying file", 0.98);
        const verified = await inspectEncodedClip(video);
        if (verified.codec !== selectedFormat.codec || verified.width !== width || verified.height !== height || Math.abs(verified.duration - settings.duration) > 1 / settings.fps) {
          throw new Error("The encoded file did not match the requested export settings.");
        }
        downloadBlob(video, `fayaaa-${settings.ratio.replace(":", "x")}-${settings.fps}fps.${selectedFormat.format}`);
        const color = verified.color.primaries ?? "sRGB";
        exportStatus.textContent = `Verified ${verified.width} × ${verified.height} · ${settings.fps} FPS · ${verified.duration.toFixed(2)}s · ${verified.codec.toUpperCase()} ${selectedFormat.format.toUpperCase()} · ${color}.`;
        announce(`${settings.duration} second Fayaaa clip exported as ${selectedFormat.format.toUpperCase()}`);
      } catch (error) {
        const message = signal.aborted ? "Video export canceled." : error instanceof Error ? error.message : "Video export failed.";
        exportStatus.textContent = message;
        announce(message);
      } finally {
        exportRecording = false;
        captureBusy = false;
        delete demoShell.dataset.recording;
        for (const [control, disabled] of previousDisabled) control.disabled = disabled;
        for (const button of recordButtons) {
          button.textContent = recordButtonLabels.get(button) ?? "Record";
        }
      }
    }

    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-open-export]")) {
      button.addEventListener("click", () => {
        openVideoExport();
      });
    }
    videoRecorder = recordClip;

    function setHeatAngle(angle: HeatDirection): void {
      if (exportRecording) return;
      state.heatAngle = angle === "full" ? "full" : ((angle % 360) + 360) % 360;
      if (state.heatAngle !== "full") heatCurrent = Number(state.heatAngle);
      modeAngles[previewMode] = readHeatDirection(state.heatAngle);
      currentPipeline.applyEmberParams(state);
      updateDirectionUi(readHeatDirection(state.heatAngle));
      needsFrame = true;
    }

    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-angle]")) {
      button.addEventListener("click", () => {
        attractOrbitActive = false; // explicit choice ends the attract loop
        setHeatAngle(Number(button.dataset.angle));
        announce(`Hot edge set to ${angleValue.value}`);
      });
    }

    let pointerFrame = 0;
    let steering = false;
    let activePointer = -1;
    let stageHovered = false;
    let pointerPosition = { x: 0, y: 0 };
    // The pointer only sets a TARGET; the frame loop glides the actual heat
    // angle toward it, so hover steering feels damped, not teleporting.
    let pointerTargetAngle: number | undefined;
    const steerFromPointer = () => {
      pointerFrame = 0;
      // Full remains locked until the user explicitly chooses a direction.
      // Canvas hover steering must never silently turn it back into an angle.
      if (readHeatDirection(state.heatAngle) === "full") return;
      const bounds = shaderStage.getBoundingClientRect();
      const [x0, y0, x1, y1] = computeRect(currentSourceAspect, state);
      const aspect = bounds.width / bounds.height;
      const side = Math.max(aspect, 1);
      const centerXNorm = 0.5 + ((((x0 + x1) * 0.5) - 0.5) * side) / aspect;
      const centerYNorm = 0.5 + (((y0 + y1) * 0.5) - 0.5) * side;
      const dx = pointerPosition.x - (bounds.left + bounds.width * centerXNorm);
      const dy = pointerPosition.y - (bounds.top + bounds.height * centerYNorm);
      if (Math.hypot(dx, dy) < 24) return;
      pointerTargetAngle = (((Math.atan2(dx, dy) * 180) / Math.PI) % 360 + 360) % 360;
      needsFrame = true;
    };
    const isStageUiTarget = (target: EventTarget | null): boolean =>
      target instanceof Element && Boolean(target.closest(".preview-toolbar, .stage-text-editor, .stage-text-hitarea, .stage-sound-toggle, .stage-replay-intro"));

    shaderStage.addEventListener("pointerdown", (event) => {
      if (exportRecording) return;
      if (isStageUiTarget(event.target)) return;
      if (readHeatDirection(state.heatAngle) === "full") return;
      steering = true;
      activePointer = event.pointerId;
      pointerPosition = { x: event.clientX, y: event.clientY };
      shaderStage.setPointerCapture(event.pointerId);
      steerFromPointer();
      needsFrame = true;
    });
    shaderStage.addEventListener("pointermove", (event) => {
      if (readHeatDirection(state.heatAngle) === "full") return;
      if (!steering && isStageUiTarget(event.target)) return;
      const mouseHover = event.pointerType === "mouse" && stageHovered;
      if (!mouseHover && (!steering || event.pointerId !== activePointer)) return;
      pointerPosition = { x: event.clientX, y: event.clientY };
      if (!pointerFrame) pointerFrame = requestAnimationFrame(steerFromPointer);
    });
    const stopSteering = (event: PointerEvent) => {
      if (event.pointerId !== activePointer) return;
      steering = false;
      activePointer = -1;
      if (shaderStage.hasPointerCapture(event.pointerId)) shaderStage.releasePointerCapture(event.pointerId);
      needsFrame = true;
    };
    shaderStage.addEventListener("pointerup", stopSteering);
    shaderStage.addEventListener("pointercancel", stopSteering);
    shaderStage.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      stageHovered = true;
      pointerPosition = { x: event.clientX, y: event.clientY };
      if (!pointerFrame) pointerFrame = requestAnimationFrame(steerFromPointer);
      demoShell.classList.add("is-hovered");
      needsFrame = true;
    });
    shaderStage.addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "mouse") return;
      stageHovered = false;
      demoShell.classList.remove("is-hovered");
      needsFrame = true;
    });
    const time = clock(ctx);
    let lastClock = 0;
    const ATTRACT_ORBIT_DPS = 16; // attract lap ≈ 22s, until first interaction
    const HEAT_STEER_RATE = 7; // per-second damping toward the pointer
    motionToggle.addEventListener("click", () => {
      if (reducedMotion.matches) return;
      userPaused = !userPaused;
      syncMotionButton();
      needsFrame = true;
      persistPlayground();
      announce(motionPaused ? "Fire motion paused" : "Fire motion playing");
    });
    document.querySelector<HTMLButtonElement>("#replay-logo")?.addEventListener("click", () => {
      if (exportRecording || reducedMotion.matches) return;
      userPaused = false;
      motionPaused = false;
      effectIntent = "auto";
      comparingSource = false;
      logoReplayPhase = "cooling";
      effectTransition.setTarget(0);
      syncSourceComparison();
      syncMotionButton();
      needsFrame = true;
      announce("Logo reveal replayed");
    });

    let renderedPhase: EffectPhase | "swapping" | "blending" | "" = "";
    function syncEffectPhase(): void {
      const phase = effectTransition.phase;
      const displayPhase = pendingSourceSwap ? "swapping" : pendingBlend ? "blending" : phase;
      if (displayPhase === renderedPhase) return;
      renderedPhase = displayPhase;
      demoShell.dataset.effectPhase = displayPhase;
      if (pendingSourceSwap) stageNote.textContent = "preparing new edge";
      else if (pendingBlend) stageNote.textContent = "changing blend at the source";
      else if (phase === "igniting") stageNote.textContent = "edge ignition";
      else if (phase === "cooling") stageNote.textContent = "returning to source";
      else if (phase === "source") stageNote.textContent = "source image";
      else stageNote.textContent = STAGE_COPY[previewMode];
    }

    loop = frameLoop(ctx, (gpuFrame) => {
      const now = time.time;
      const delta = lastClock ? Math.min(now - lastClock, 0.1) : 0;
      lastClock = now;
      if (!motionPaused) {
        animationTime += delta * Number(state.speed);
        if (logoReplayPhase === "idle") logoLoopTime += delta;
      }

      // One continuous heat-direction system. Attract: the fire slowly
      // circles the silhouette until the FIRST interaction, then never
      // auto-moves again. Hovering: the flame GLIDES toward the pointer
      // (critically damped — never snaps). Every handoff (attract ↔ hover ↔
      // intro sweep) continues from heatCurrent.
      if (
        !motionPaused &&
        !exportRecording &&
        !introRunning &&
        state.heatAngle !== "full"
      ) {
        if ((stageHovered || steering) && pointerTargetAngle !== undefined) {
          attractOrbitActive = false; // the user took the wheel — for good
          const diff = ((((pointerTargetAngle - heatCurrent) % 360) + 540) % 360) - 180;
          heatCurrent += diff * (1 - Math.exp(-delta * HEAT_STEER_RATE));
          heatCurrent = ((heatCurrent % 360) + 360) % 360;
          state.heatAngle = heatCurrent;
          modeAngles[previewMode] = heatCurrent;
          currentPipeline.applyEmberParams(state);
        } else if (attractOrbitActive) {
          heatCurrent = (heatCurrent + delta * ATTRACT_ORBIT_DPS) % 360;
          state.heatAngle = heatCurrent;
          modeAngles[previewMode] = heatCurrent;
          currentPipeline.applyEmberParams(state);
        }
      }

      let effectTarget = 1;
      if (videoExportOpen) effectTarget = 1;
      else if (pendingSourceSwap) effectTarget = 0;
      else if (pendingBlend) effectTarget = 0;
      else if (logoReplayPhase !== "idle") {
        effectTarget = motionPaused ? effectTransition.value : 0;
      }
      else if (effectIntent === "source") effectTarget = 0;
      else if (effectIntent === "result") effectTarget = 1;
      else if (previewMode === "shape") {
        effectTarget = reducedMotion.matches
          ? 1
          : motionPaused
            ? effectTransition.value
            : stageHovered || steering
              ? 1
              : effectLoopTarget(logoLoopTime);
      }

      if (reducedMotion.matches) effectTransition.snap(effectTarget);
      else {
        effectTransition.setTarget(effectTarget);
        effectTransition.tick(delta);
      }
      if (
        logoReplayPhase === "cooling" &&
        effectTransition.target === 0 &&
        effectTransition.value === 0 &&
        effectTransition.settled
      ) {
        logoReplayPhase = "holding";
        effectTransition.hold(0.14);
      } else if (
        logoReplayPhase === "holding" &&
        effectTransition.target === 0 &&
        effectTransition.value === 0 &&
        effectTransition.settled
      ) {
        logoReplayPhase = "idle";
        logoLoopTime = 0.18;
      }
      commitPendingBlend();
      schedulePendingSourceCommit();
      syncEffectPhase();
      syncSourceVisibility();

      if ((!stageVisible && !exportRecording) || document.hidden) {
        needsFrame = true;
        return;
      }
      if (motionPaused && !needsFrame && effectTransition.settled) return;
      currentPipeline.setEffectProgress(effectTransition.value);
      currentPipeline.composite.set({ g: { time: animationTime } });
      gpuFrame.pass(view, currentPipeline.composite);
      needsFrame =
        !effectTransition.settled ||
        Boolean(pendingSourceSwap) ||
        Boolean(pendingBlend) ||
        (logoReplayPhase !== "idle" && !motionPaused);
    });

    // The shader is ready as soon as its render loop exists. Recording support
    // is optional and resolves independently below.
    document.body.classList.add("gpu-ready");
    syncSourceVisibility();
    for (const button of gpuActionButtons) {
      button.disabled = button.matches("[data-record-clip]");
    }
    syncMotionButton();
    gpuStatus.textContent = "live / WebGPU";
    announce("Live Fayaaa preview ready with the exact Fire reference");

    void (async () => {
      try {
        encodableVideoCodecs = await getEncodableVideoCodecs(["avc", "vp9", "vp8"], {
          width: EXPORT_WIDTH,
          height: EXPORT_HEIGHT,
          quality: new Quality({ bitrate: VIDEO_QUALITIES.high.bitrate, bitrateMode: "variable" }),
        });
        webmCodecs = encodableVideoCodecs.filter((codec) => codec === "vp9" || codec === "vp8");
      } catch {
        encodableVideoCodecs = [];
        webmCodecs = [];
      }
      if (disposed) return;
      updateExportDetails();
      if (encodableVideoCodecs.length > 0) {
        for (const button of recordButtons) button.disabled = false;
        return;
      }
      for (const button of recordButtons) {
        button.disabled = true;
        button.textContent = "Unavailable";
        button.title = "Finalized WebM encoding is unavailable in this browser";
        button.setAttribute("aria-label", "Finalized WebM encoding unavailable in this browser");
      }
      for (const note of recordNotes) note.textContent = "not supported by this browser";
    })();

    /* ─────────────────────────────────────────────────────────
     * INTRO STORYBOARD — per the confirmed motion brief
     *
     * Once per browser session; click, tap, or any key skips.
     * Mood first: dark, tactile, slow. Light does the acting —
     * the reveal progress never moves during the word phase.
     *
     *      0ms   full-black takeover, chrome hidden
     *    700ms   the pen touches down and DRAWS the word's actual
     *            stroke path — one continuous cursive line traveling
     *            by arc length (smoothstepped, 2600ms) — while the
     *            ink HEATS UP from dark coals to full burn and a
     *            constant linear push-in drifts scale 0.40 → 0.50
     *   3300ms   word complete, at full burn
     *   4400ms   hold ends — embers cool and DIE TO BLACK (ease-in)
     *   5300ms   black beat
     *   5800ms   the mark is REVEALED from black, SMALL and intimate:
     *            a heat sweep wraps fire ~300° around its silhouette
     *            while the material blooms up to the dials (small
     *            mid-sweep breath)
     *   8400ms   entering the playground: the curtain lifts and the
     *            mark GROWS into its dial size together with the
     *            layout easing in — one coordinated arrival
     *    then    layout eases back (1200ms expo), chrome +180ms later
     * ───────────────────────────────────────────────────────── */
    const INTRO_TIMING = {
      blackBeat:   700,  // pure black before the pen touches down
      writeMs:    2600,  // one continuous hand-writing pass over the word
      wordHold:   1100,  // full-burn hold after the word completes
      burnOut:     900,  // embers dying into the dark
      blackGap:    280,  // a breath of darkness before the mark's reveal
    };
    const INTRO_WORD = {
      text: "fayaaa",
      zoomFrom: 0.25,  // restrained opening size on portrait and desktop
      zoomTo:   0.32,  // constant push-in, still intimate at the hold
      spacing:  1.7,   // signature spacing, opened up for the fire's glow
      penMin:   0.7,   // hairline on upstrokes (brush pressure), grid units
      penMax:   2.5,   // full weight on downstrokes
      // Brush-signature styling (matched to the CasaPablo-style reference):
      slant: 0.52,     // ~30° italic shear
      asc:   1.18,     // ascender loops grow past the plotter default
      desc:  1.08,     // descenders too
      xs:    0.92,     // slightly condensed
    };

    // The "camera" is the shader's subject transform. One intention per
    // shot, never reversing, ends imperceptible: a single slow push-in for
    // the whole word phase, locked off for the burn-out, and a small
    // 60fps landing settle for the mark.
    const INTRO_CAMERA = {
      markScale: 0.15, // the mark stays small and intimate during the reveal
      settle:    1.04, // tiny oversize it settles from while the fire wraps
      growMs:    1150, // then it grows into the dial size as the layout enters
    };

    // The mark's reveal: committed while the screen is still black, then
    // the fire LICKS AROUND the silhouette — the hover-steer heat sweep,
    // played by the intro — while the material blooms up to the dials.
    const INTRO_MARK = {
      sweepMs: 2600,    // how long the flame takes to wrap and settle
      sweepArc: 300,    // degrees of travel before landing on the dial angle
      breath:  0.12,    // mid-sweep glow overshoot that settles back to 1
      innerSurge: 0.6,  // mid-sweep inside-glow surge (icon body lit richly)
    };

    // Molten-ink material for the writing: the stroke interior is LIT from
    // the first pixel (solid ink, never a hollow rim), then blazes up.
    const INTRO_INK = {
      body: "#7e2508",            // ember ink body while writing
      spread: 0.008,               // tighter bloom for the smaller lettering
      glow: [0.3, 0.72],          // glowIntensity: coal → controlled blaze
      inner: [0.72, 0.95],        // luminous fill without swelling the stroke
      exposure: [0.08, 0.13],     // capped so the smaller mark stays crisp
      sheen: 0.68,                 // retain texture without a broad highlight
      grain: 0.65,                 // scale texture energy with the smaller art
      waver: 0.45,                 // fewer flame tongues around thin strokes
      flicker: 0.55,               // calmer edge motion at the reduced scale
    } as const;                   // orange — never the pale hot-metal look

    // Single-stroke cursive glyphs from the public-domain Hershey "Script
    // 1-stroke" plotter font — real lettering designed as PEN PATHS, so
    // drawing them stroke-by-stroke IS how they were meant to be written.
    // Grid: y grows downward, baseline at y=22, x-height 9 (y 13…22),
    // ascender to y≈1, descender to y≈34. `o` is the advance width; entry
    // and exit tails intentionally overshoot it so letters flow together.
    // `tailTrim` = how many trailing points form the decorative exit sweep;
    // it is dropped when another letter follows (the stroke bridges from the
    // baseline into the next entry instead), and kept on the final letter.
    // `entry` is where an incoming connector lands: the glyph's bottom-left
    // baseline point — a spot with nothing above it, so the link touches the
    // stroke exactly once and can never cross a bowl.
    const HERSHEY_GLYPHS: Record<
      string,
      { o: number; tailTrim: number; entry: [number, number]; d: string }
    > = {
      f: {
        o: 5,
        tailTrim: 3,
        entry: [0, 17],
        d: "M0,17 L4,12 6,9 7,7 8,4 8,2 7,1 5,2 4,4 2,12 -1,21 -4,28 -5,31 -5,33 -4,34 -2,33 -1,30 0,21 1,22 3,22 5,21 6,20 8,17",
      },
      a: {
        o: 10,
        tailTrim: 3,
        entry: [1, 21],
        d: "M9,16 L8,14 6,13 4,13 2,14 1,15 0,17 0,19 1,21 3,22 5,22 7,21 8,19 10,13 9,18 9,21 10,22 11,22 13,21 14,20 16,17",
      },
      y: {
        o: 9,
        tailTrim: 2,
        entry: [1, 22],
        d: "M0,17 L2,13 0,19 0,21 1,22 3,22 5,21 7,19 9,16 M10,13 L4,31 3,33 1,34 0,33 0,31 1,28 4,25 7,23 9,22 12,20 15,17",
      },
    };

    // "M x,y L x,y …" → subpaths of points (a new M means the pen lifts).
    function parseHersheyPath(d: string, dx: number): [number, number][][] {
      const subpaths: [number, number][][] = [];
      let current: [number, number][] | undefined;
      for (const token of d.split(/[\sL]+/)) {
        if (!token) continue;
        const isMove = token.startsWith("M");
        const [x, y] = token.replace("M", "").split(",").map(Number);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (isMove || !current) {
          current = [];
          subpaths.push(current);
        }
        current.push([x + dx, y]);
      }
      return subpaths;
    }

    // Catmull-Rom through the plotter points — smooth hand curves instead of
    // visible polyline facets.
    function smoothSubpath(pts: [number, number][], perSeg = 8): [number, number][] {
      if (pts.length < 3) return pts;
      const out: [number, number][] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i += 1) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (let s = 1; s <= perSeg; s += 1) {
          const t = s / perSeg;
          const t2 = t * t;
          const t3 = t2 * t;
          out.push([
            0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
            0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
          ]);
        }
      }
      return out;
    }

    // Every partial word is drawn into a canvas sized for the FULL word, so
    // letters land in their final positions instead of re-centering the whole
    // wordmark on each commit (that re-layout read as a jump every letter).
    // True handwriting: the ink IS the pen stroke. Assemble the word from
    // Hershey subpaths, smooth them, then each frame stroke exactly as far
    // as the pen has traveled (arc length). A new subpath = the pen lifting,
    // like a real hand between letters.
    function buildIntroWordArt(): { paint: (progress: number) => void; source: RasterizedSource } {
      // Lay out the word in Hershey grid units — the lab's "touch-connect"
      // variant: each letter's overshooting tail is replaced by a short link
      // that runs out along the baseline and LANDS ON the next letter's
      // bottom-left baseline point. Connected at exactly one touch per join,
      // no crossings, and the final letter keeps its full flourish.
      const rawSubpaths: [number, number][][] = [];
      const letters = [...INTRO_WORD.text];
      let cursor = 0;
      for (let l = 0; l < letters.length; l += 1) {
        const glyph = HERSHEY_GLYPHS[letters[l]];
        if (!glyph) continue;
        const glyphSubs = parseHersheyPath(glyph.d, cursor);
        const next = l < letters.length - 1 ? HERSHEY_GLYPHS[letters[l + 1]] : undefined;
        if (next && glyphSubs.length > 0) {
          const nextCursor = cursor + glyph.o + INTRO_WORD.spacing;
          const last = glyphSubs[glyphSubs.length - 1];
          const kept = last.slice(0, Math.max(2, last.length - glyph.tailTrim));
          const exit = kept[kept.length - 1];
          const landing: [number, number] = [next.entry[0] + nextCursor, next.entry[1]];
          kept.push(
            [(exit[0] + landing[0]) / 2, Math.max(exit[1], landing[1]) + 0.4],
            landing,
          );
          glyphSubs[glyphSubs.length - 1] = kept;
        }
        rawSubpaths.push(...glyphSubs);
        cursor += glyph.o + INTRO_WORD.spacing;
      }

      // The return slash: the pen dives off the final flourish and pulls
      // back left under the whole word — the signature's closing gesture.
      const lastSub = rawSubpaths[rawSubpaths.length - 1];
      const exitPoint = lastSub[lastSub.length - 1];
      lastSub.push(
        [exitPoint[0] + 3.5, exitPoint[1] + 2],
        [exitPoint[0] + 1, exitPoint[1] + 7],
        [exitPoint[0] - 10, exitPoint[1] + 12],
        [exitPoint[0] - 28, exitPoint[1] + 15.5],
        [exitPoint[0] - 44, exitPoint[1] + 16.8],
        [exitPoint[0] - 56, exitPoint[1] + 17.2],
      );

      // Brush-signature styling: compress/stretch verticals around the
      // grid's x-height band (13…22), then shear right for the slant.
      const styled = rawSubpaths.map((sub) =>
        sub.map(([x, y]): [number, number] => {
          let ny = y;
          if (y < 13) ny = 13 - (13 - y) * INTRO_WORD.asc;
          else if (y > 22) ny = 22 + (y - 22) * INTRO_WORD.desc;
          return [x * INTRO_WORD.xs + INTRO_WORD.slant * (22 - ny), ny];
        }),
      );

      const subpathsGrid: [number, number][][] = [];
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const sub of styled) {
        const smooth = smoothSubpath(sub);
        subpathsGrid.push(smooth);
        for (const [x, y] of smooth) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }

      // Fit the styled art into the canvas from its real bounds.
      const pad = 48;
      const canvasHeight = 560;
      const unit = Math.min(
        (canvasHeight - pad * 2) / Math.max(1, maxY - minY),
        (1024 - pad * 2) / Math.max(1, maxX - minX),
      );
      const canvasWidth = Math.ceil((maxX - minX) * unit + pad * 2);
      const subpaths = subpathsGrid.map((sub) =>
        sub.map(([x, y]): [number, number] => [
          pad + (x - minX) * unit,
          pad + (y - minY) * unit,
        ]),
      );

      // Brush pressure: full weight on downstrokes, hairline on upstrokes,
      // smoothed along the path so the weight breathes.
      const widths = subpaths.map((sub) => {
        const raw = sub.map((_, i) => {
          const a = sub[Math.max(0, i - 1)];
          const b = sub[Math.min(sub.length - 1, i + 1)];
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const down = Math.max(0, dy / (Math.hypot(dx, dy) || 1));
          return (INTRO_WORD.penMin + (INTRO_WORD.penMax - INTRO_WORD.penMin) * down ** 0.7) * unit;
        });
        return raw.map((_, i) => {
          let sum = 0;
          let count = 0;
          for (let k = -6; k <= 6; k += 1) {
            const j = i + k;
            if (raw[j] !== undefined) {
              sum += raw[j];
              count += 1;
            }
          }
          return sum / count;
        });
      });

      // Cumulative arc length across subpaths (pen lifts add no length).
      const lengths = subpaths.map((sub) => {
        const cumulative = [0];
        for (let i = 1; i < sub.length; i += 1) {
          cumulative.push(cumulative[i - 1] + Math.hypot(
            sub[i][0] - sub[i - 1][0],
            sub[i][1] - sub[i - 1][1],
          ));
        }
        return cumulative;
      });
      const subpathStart: number[] = [];
      let totalLength = 0;
      for (const cumulative of lengths) {
        subpathStart.push(totalLength);
        totalLength += cumulative[cumulative.length - 1];
      }

      const reveal = document.createElement("canvas");
      reveal.width = canvasWidth;
      reveal.height = canvasHeight;
      const context = reveal.getContext("2d");
      if (!context) throw new Error("Canvas 2D is unavailable");
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "#fff";

      const paint = (progress: number): void => {
        context.clearRect(0, 0, reveal.width, reveal.height);
        const target = totalLength * Math.min(1, Math.max(0, progress));
        if (target <= 0) return;
        // Variable-width ink: each tiny segment is stroked at its own
        // pressure; round caps blend them into one calligraphic line.
        for (let s = 0; s < subpaths.length; s += 1) {
          const local = target - subpathStart[s];
          if (local <= 0) break;
          const sub = subpaths[s];
          const cumulative = lengths[s];
          const w = widths[s];
          for (let i = 1; i < sub.length; i += 1) {
            let endX = sub[i][0];
            let endY = sub[i][1];
            let partial = false;
            if (cumulative[i] > local) {
              const span = cumulative[i] - cumulative[i - 1];
              const k = span > 0 ? (local - cumulative[i - 1]) / span : 0;
              endX = sub[i - 1][0] + (sub[i][0] - sub[i - 1][0]) * k;
              endY = sub[i - 1][1] + (sub[i][1] - sub[i - 1][1]) * k;
              partial = true;
            }
            context.beginPath();
            context.lineWidth = (w[i - 1] + w[i]) / 2;
            context.moveTo(sub[i - 1][0], sub[i - 1][1]);
            context.lineTo(endX, endY);
            context.stroke();
            if (partial) break;
          }
        }
      };

      paint(1);
      const previewUrl = reveal.toDataURL("image/png");
      paint(0);
      return {
        paint,
        source: {
          canvas: reveal,
          hasAlpha: true,
          autoMaskMode: "alpha",
          aspect: canvasWidth / canvasHeight,
          name: INTRO_WORD.text,
          previewUrl,
          kind: "text",
          supportsBurnAround: false,
        },
      };
    }

    const introSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    async function playIntro(): Promise<void> {
      if (introRunning) return;
      // Replays are a presentation layer over the current playground state.
      // Keep the active subject so the intro cannot permanently replace an
      // upload (or text) with its temporary Artifact reveal mark.
      const sourceBeforeIntro = currentSource;
      const modeBeforeIntro = previewMode;
      const wordSpan = INTRO_TIMING.blackBeat + INTRO_TIMING.writeMs + INTRO_TIMING.wordHold;
      // What the dials expect back after the intro's material overrides.
      const dialScale = Number(state.scale);
      const dialOffsetX = state.offsetX;
      const dialOffsetY = state.offsetY;
      const dialHeat = state.heatAngle;
      const dialGlowIntensity = state.glowIntensity;
      const dialGlowSpread = state.glowSpread;
      const dialInnerGlow = Number(state.innerGlow);
      const dialSheen = Number(state.sheenStrength);
      const dialBaseColor = String(state.baseColor);
      const dialBackgroundColor = String(state.bgColor);
      const dialExposure = Number(state.exposure);
      const dialTopLight = Number(state.topLight);
      const dialGrain = Number(state.grainAmount);
      const dialWaver = Number(state.waverAmount);
      const dialFlicker = Number(state.flickerAmount);
      const easeInOutCubic = (t: number): number =>
        t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      // Keep the intro intimate on wide desktop windows. The playground's
      // final dial scale is unchanged; only the temporary intro camera pulls
      // back as the viewport moves from landscape to full-width/ultrawide.
      const viewportAspect = window.innerWidth / Math.max(1, window.innerHeight);
      const wideProgress = Math.min(1, Math.max(0, (viewportAspect - 1.35) / 0.5));
      const introScale = 1 - 0.18 * wideProgress * wideProgress * (3 - 2 * wideProgress);
      const introMarkScale = INTRO_CAMERA.markScale * introScale;
      let skipped = false;
      const skip = () => {
        skipped = true;
      };
      // Arm the skip a beat late so the click/keypress that triggered a
      // replay doesn't immediately skip the run it started.
      const skipArmTimer = window.setTimeout(() => {
        window.addEventListener("pointerdown", skip, true);
        window.addEventListener("keydown", skip, true);
      }, 400);

      const restoreDialMaterial = (restoreBackground = true) => {
        state.scale = dialScale;
        state.offsetX = dialOffsetX;
        state.offsetY = dialOffsetY;
        state.heatAngle = dialHeat;
        state.glowIntensity = dialGlowIntensity;
        state.glowSpread = dialGlowSpread;
        state.innerGlow = dialInnerGlow;
        state.sheenStrength = dialSheen;
        state.baseColor = dialBaseColor;
        if (restoreBackground) state.bgColor = dialBackgroundColor;
        state.exposure = dialExposure;
        state.topLight = dialTopLight;
        state.grainAmount = dialGrain;
        state.waverAmount = dialWaver;
        state.flickerAmount = dialFlicker;
        currentPipeline.applyEmberParams(state);
        if (restoreBackground) syncStageBackground();
      };

      try {
        introRunning = true;
        syncActiveTreatment();
        document.body.classList.add("intro-playing"); // idempotent; replays need it
        markIntroSeen();
        const markPromise = sourceFromUrl(assetUrl("artifact-mark.svg"), "Artifact").catch(() => undefined);

        userPaused = false;
        syncMotionButton();
        effectIntent = "result"; // reveal stays parked at 1; light does the acting
        effectTransition.snap(1);

        // Write with molten ink: "Full" heat so the whole stroke burns
        // evenly, and a lit body so the drawn line is SOLID ink from the
        // first pixel — never a hollow rim around empty dark.
        state.heatAngle = "full";
        // The intro is a temporary presentation with a true-black canvas,
        // independent of the playground's selected background. Restore the
        // selected color with the rest of the dial material on every exit.
        state.bgColor = "#000000";
        syncStageBackground();
        state.glowSpread = INTRO_INK.spread;
        state.baseColor = INTRO_INK.body;
        state.glowIntensity = INTRO_INK.glow[0];
        state.innerGlow = INTRO_INK.inner[0];
        state.exposure = INTRO_INK.exposure[0];
        state.sheenStrength = dialSheen * INTRO_INK.sheen;
        state.grainAmount = dialGrain * INTRO_INK.grain;
        state.waverAmount = dialWaver * INTRO_INK.waver;
        state.flickerAmount = dialFlicker * INTRO_INK.flicker;
        state.offsetX = 0; // the intro frames its own subjects dead center
        state.offsetY = 0;
        currentPipeline.applyEmberParams(state);

        // Word phase: one rAF loop owns every uniform — the pen reveal
        // travels while the whole word heats up and the push-in drifts.
        const art = buildIntroWordArt();
        commitSource(art.source); // once; per-frame updates go straight to the GPU
        effectTransition.snap(1);
        currentPipeline.setEffectProgress(1);
        const smoothstep = (t: number): number => t * t * (3 - 2 * t);
        await new Promise<void>((resolve) => {
          const startedAt = performance.now();
          const step = (now: number) => {
            if (disposed || skipped) {
              resolve();
              return;
            }
            const elapsed = now - startedAt;

            // The hand: smoothstepped travel — settles into the page, lifts
            // off gently at the end.
            const writeLinear = Math.min(
              1,
              Math.max(0, (elapsed - INTRO_TIMING.blackBeat) / INTRO_TIMING.writeMs),
            );
            const writeEased = smoothstep(writeLinear);

            // CAMERA — one intention: a single slow push-in across the whole
            // word phase, sine-eased so it starts and stops imperceptibly.
            // No pan, no reversal — the camera never draws attention.
            const pushT = Math.min(1, elapsed / wordSpan);
            const pushEased = 0.5 - 0.5 * Math.cos(Math.PI * pushT);
            state.scale = (INTRO_WORD.zoomFrom +
              (INTRO_WORD.zoomTo - INTRO_WORD.zoomFrom) * pushEased) * introScale;

            // The heat-up: coals → full burn, blooming just after the pen
            // finishes its pass.
            const heatLinear = Math.min(
              1,
              Math.max(0, (elapsed - INTRO_TIMING.blackBeat) / (INTRO_TIMING.writeMs + 300)),
            );
            const heatEased = easeInOutCubic(heatLinear);
            state.glowIntensity =
              INTRO_INK.glow[0] + (INTRO_INK.glow[1] - INTRO_INK.glow[0]) * heatEased;
            state.innerGlow =
              INTRO_INK.inner[0] + (INTRO_INK.inner[1] - INTRO_INK.inner[0]) * heatEased;
            state.exposure =
              INTRO_INK.exposure[0] + (INTRO_INK.exposure[1] - INTRO_INK.exposure[0]) * heatEased;

            if (elapsed >= INTRO_TIMING.blackBeat) {
              art.paint(writeEased);
              currentPipeline.setImage(art.source.canvas, true, "alpha");
            }
            currentPipeline.applyEmberParams(state);
            currentPipeline.rebuild(state);
            updateSourceBounds();
            needsFrame = true;
            if (elapsed >= wordSpan) resolve();
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });

        // Burn-out: the embers cool and die into the dark. Material only —
        // dropping the reveal progress would flash the raw white text.
        if (!skipped && !disposed) {
          const glowPeak = Number(state.glowIntensity);
          const innerPeak = Number(state.innerGlow);
          const exposurePeak = Number(state.exposure);
          await new Promise<void>((resolve) => {
            const startedAt = performance.now();
            const fade = (now: number) => {
              if (disposed || skipped) {
                resolve();
                return;
              }
              const t = Math.min(1, (now - startedAt) / INTRO_TIMING.burnOut);
              const died = t * t * (3 - 2 * t); // smoothstep: eases into AND out of the dark
              state.glowIntensity = glowPeak * (1 - died);
              state.innerGlow = innerPeak * (1 - died);
              state.exposure = exposurePeak * (1 - died);
              state.sheenStrength = dialSheen * (1 - died);
              state.baseColor = mixHex(INTRO_INK.body, String(state.bgColor), died);
              // topLight multiplies the body — left at the dial value it
              // re-brightens the "dead" ink into an embossed ghost.
              state.topLight = 1 + (dialTopLight - 1) * (1 - died);
              currentPipeline.applyEmberParams(state);
              needsFrame = true;
              if (t >= 1) resolve();
              else requestAnimationFrame(fade);
            };
            requestAnimationFrame(fade);
          });
          // The embers are out — remove the word's mask entirely so not even
          // an engraved silhouette survives into the black gap.
          if (!disposed) {
            const blank = document.createElement("canvas");
            blank.width = 8;
            blank.height = 8;
            // copyExternalImageToTexture rejects a canvas that never had a
            // rendering context — touch its 2D context first.
            blank.getContext("2d")?.clearRect(0, 0, 8, 8);
            currentPipeline.setImage(blank, true, "alpha");
            currentPipeline.rebuild(state);
            needsFrame = true;
          }
          if (!skipped) await introSleep(INTRO_TIMING.blackGap);
        }

        // Do not restore the playground material between subjects. Even with
        // the blank mask installed above, that intermediate full-energy GPU
        // state can reach a compositor frame before the mark is zeroed,
        // reading as a flash between the word and icon on some browsers.
        // The captured dial values below are the icon's targets, so we can
        // transition straight from the dead word into a zero-energy mark.
        const revealMark = await markPromise;
        if (disposed) return;

        if (!revealMark) {
          // Mark unavailable — boot into the normal default instead.
          await sourceController?.(previewMode);
          return;
        }
        if (skipped) {
          commitSource(revealMark);
          effectIntent = "auto";
          effectTransition.snap(1);
          currentPipeline.setEffectProgress(1);
          needsFrame = true;
          return;
        }
        // Hand straight to the mark and replay the edge-ignition reveal —
        // no cool-to-source pass, so the raw white wordmark never flashes.
        // THE REVEAL — no spawn. The mark is committed while the screen is
        // still black (material zeroed, reveal parked at 1), then the fire
        // wraps around its silhouette via a heat-direction sweep while the
        // material blooms up to the dials and the camera settles the
        // landing. Ends exactly on the user's dial state.
        const targetGlow = Number(dialGlowIntensity);
        const targetInner = dialInnerGlow;
        const targetExposure = dialExposure;
        const targetSheen = Number(dialSheen);
        const targetSpread = Number(dialGlowSpread);
        const targetGrain = dialGrain;
        const targetWaver = dialWaver;
        const targetFlicker = dialFlicker;
        const introMarkGlow = targetGlow * 0.5;
        const introMarkInner = targetInner * 0.62;
        const introMarkExposure = targetExposure * 0.72;
        const introMarkSheen = targetSheen * 0.58;
        const introMarkSpread = targetSpread * Math.max(0.5, introMarkScale / 0.26);
        const introMarkGrain = targetGrain * INTRO_INK.grain;
        const introMarkWaver = targetWaver * INTRO_INK.waver;
        const introMarkFlicker = targetFlicker * INTRO_INK.flicker;
        const dialAngle = readHeatDirection(dialHeat);
        const landAngle = dialAngle === "full" ? Number(DEFAULTS.heatAngle) : dialAngle;
        state.glowIntensity = 0;
        state.innerGlow = 0;
        state.exposure = 0;
        state.sheenStrength = 0;
        state.glowSpread = introMarkSpread;
        state.grainAmount = introMarkGrain;
        state.waverAmount = introMarkWaver;
        state.flickerAmount = introMarkFlicker;
        // The body itself starts INVISIBLE: exactly the background color
        // with neutral topLight — no black silhouette before the flames.
        state.baseColor = String(state.bgColor);
        state.topLight = 1;
        state.scale = introMarkScale * INTRO_CAMERA.settle;
        effectIntent = "result";
        effectTransition.snap(1);
        currentPipeline.setEffectProgress(1);
        commitSource(revealMark); // still pitch black — nothing spawns
        await new Promise<void>((resolve) => {
          const startedAt = performance.now();
          const step = (now: number) => {
            if (disposed || skipped) {
              resolve();
              return;
            }
            const t = Math.min(1, (now - startedAt) / INTRO_MARK.sweepMs);
            // Ease-in-out wrap with a linear tail matched to the ambient
            // orbit's speed, so the reveal flows straight into the idle
            // orbit with no stop-start hitch at the handoff.
            const orbitTailDegrees = ATTRACT_ORBIT_DPS * (INTRO_MARK.sweepMs / 1000);
            const wrapDegrees = INTRO_MARK.sweepArc - orbitTailDegrees;
            state.heatAngle =
              ((((landAngle - wrapDegrees * (1 - easeInOutCubic(t)) - orbitTailDegrees * (1 - t)) % 360) + 360) % 360);
            const bloom = easeInOutCubic(t);
            const breath = 1 + INTRO_MARK.breath * Math.sin(Math.PI * t);
            state.glowIntensity = introMarkGlow * bloom * breath;
            // The icon's body glows from within during the sweep — a strong
            // inner surge that settles exactly onto the dial value at t=1.
            state.innerGlow = introMarkInner * bloom * (1 + INTRO_MARK.innerSurge * Math.sin(Math.PI * t));
            state.exposure = introMarkExposure * bloom;
            state.sheenStrength = introMarkSheen * bloom;
            state.baseColor = mixHex(String(state.bgColor), dialBaseColor, bloom);
            state.topLight = 1 + (dialTopLight - 1) * bloom;
            // Small and intimate: the mark holds its reveal size, easing off
            // a hair of oversize while the fire wraps it.
            const settleEased = 1 - (1 - t) ** 3;
            state.scale = introMarkScale *
              (INTRO_CAMERA.settle + (1 - INTRO_CAMERA.settle) * settleEased);
            currentPipeline.applyEmberParams(state);
            currentPipeline.rebuild(state);
            updateSourceBounds();
            needsFrame = true;
            if (t >= 1) resolve();
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        if (!disposed) {
          // Land on the exact dial material (direction may be "full") and
          // hand the shared angle to the ambient orbit mid-motion — but the
          // mark is still SMALL here.
          state.heatAngle = dialHeat;
          heatCurrent = landAngle;
          state.glowIntensity = introMarkGlow;
          state.innerGlow = introMarkInner;
          state.exposure = introMarkExposure;
          state.sheenStrength = introMarkSheen;
          state.baseColor = dialBaseColor;
          state.topLight = dialTopLight;
          effectIntent = "auto";
          effectTransition.snap(1);
          currentPipeline.setEffectProgress(1);
          currentPipeline.applyEmberParams(state);
          currentPipeline.rebuild(state);
          updateDirectionUi(readHeatDirection(state.heatAngle));
          updateSourceBounds();
          needsFrame = true;

          // ENTERING THE PLAYGROUND — the curtain lifts and the mark grows
          // from its intimate reveal size into the dial size, together with
          // the layout easing in: one coordinated arrival.
          document.body.classList.remove("intro-playing");
          if (!skipped) {
            await new Promise<void>((resolve) => {
              const grownFrom = introMarkScale;
              const startedAt = performance.now();
              const grow = (now: number) => {
                if (disposed || skipped) {
                  resolve();
                  return;
                }
                const t = Math.min(1, (now - startedAt) / INTRO_CAMERA.growMs);
              const eased = 1 - (1 - t) ** 3;
              state.scale = grownFrom + (dialScale - grownFrom) * eased;
              state.glowSpread = introMarkSpread + (targetSpread - introMarkSpread) * eased;
              state.grainAmount = introMarkGrain + (targetGrain - introMarkGrain) * eased;
              state.glowIntensity = introMarkGlow + (targetGlow - introMarkGlow) * eased;
              state.innerGlow = introMarkInner + (targetInner - introMarkInner) * eased;
              state.exposure = introMarkExposure + (targetExposure - introMarkExposure) * eased;
              state.sheenStrength = introMarkSheen + (targetSheen - introMarkSheen) * eased;
              state.waverAmount = introMarkWaver + (targetWaver - introMarkWaver) * eased;
              state.flickerAmount = introMarkFlicker + (targetFlicker - introMarkFlicker) * eased;
              currentPipeline.applyEmberParams(state);
              currentPipeline.rebuild(state);
                updateSourceBounds();
                needsFrame = true;
                if (t >= 1) resolve();
                else requestAnimationFrame(grow);
              };
              requestAnimationFrame(grow);
            });
          }
          if (!disposed) {
            state.scale = dialScale;
            state.glowSpread = targetSpread;
            state.grainAmount = targetGrain;
            state.glowIntensity = targetGlow;
            state.innerGlow = targetInner;
            state.exposure = targetExposure;
            state.sheenStrength = targetSheen;
            state.waverAmount = targetWaver;
            state.flickerAmount = targetFlicker;
            currentPipeline.applyEmberParams(state);
            currentPipeline.rebuild(state);
            updateSourceBounds();
            needsFrame = true;
          }
        }
      } finally {
        window.clearTimeout(skipArmTimer);
        window.removeEventListener("pointerdown", skip, true);
        window.removeEventListener("keydown", skip, true);
        if (!disposed && sourceBeforeIntro && currentSource !== sourceBeforeIntro) {
          restoreDialMaterial();
          syncModeUi(modeBeforeIntro);
          commitSource(sourceBeforeIntro);
          effectIntent = "auto";
          effectTransition.snap(1);
          currentPipeline.setEffectProgress(1);
        }
        document.body.classList.remove("intro-playing");
        introRunning = false;
        syncActiveTreatment();
        needsFrame = true;
      }
    }

    // Console helper for iterating on the intro: replays it mid-session.
    (window as unknown as { replayIntro?: () => void }).replayIntro = () => {
      if (!disposed) void playIntro();
    };
    introReplayController = () => {
      if (!disposed) void playIntro();
    };

    if (introPlanned && !disposed) void playIntro();

    if (pendingFile) {
      const file = pendingFile;
      pendingFile = undefined;
      const supportsBurnAround = pendingFileSupportsBurnAround;
      pendingFileSupportsBurnAround = true;
      await imageLoader(file, file.name, supportsBurnAround);
    }
  } catch (error) {
    console.error(error);
    gpuFailed = true;
    loop?.stop();
    loop = undefined;
    document.body.classList.remove("gpu-ready");
    document.body.classList.remove("intro-playing");
    document.body.classList.add("gpu-failed");
    for (const button of gpuActionButtons) button.disabled = true;
    imageLoader = undefined;
    sourceController = undefined;
    lookController = undefined;
    gpu?.dispose();
    gpu = undefined;
    pipeline = undefined;
    gpuStatus.textContent = "static preview / WebGPU unavailable";
    announce("The static Fayaaa preview is visible. WebGPU is unavailable in this browser.");
  }
})();

function syncWindowSize(): void {
  updateSourceBounds();
}
window.addEventListener("resize", syncWindowSize, { passive: true });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    cancelAnimationFrame(lookAnimationFrame);
    window.clearTimeout(textUpdateTimer);
    reducedMotion.removeEventListener("change", syncReducedMotion);
    for (const url of Object.values(userPreviewObjectUrls)) URL.revokeObjectURL(url);
    loop?.stop();
    stageObserver.disconnect();
    window.removeEventListener("resize", syncWindowSize);
    dialkitCleanup();
    exportDialkitCleanup?.();
    mobileControlsCleanup();
    cancelAnimationFrame(audioPointerFrame);
    fireAudio.dispose();
    gpu?.dispose();
  });
}

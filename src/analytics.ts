export type ShaderPalette = "fire" | "plasma" | "ghost";
export type SubjectKindMetric = "image" | "text";
export type BackgroundModeMetric = "color" | "image" | "transparent";
export type ExportKindMetric = "image" | "video";
export type ExportRatioMetric = "16:9" | "1:1" | "4:5" | "9:16";
export type ExportQualityMetric = "standard" | "high" | "max";
export type CustomizationMethod = "manual" | "preset" | "provided";
export type CustomizationArea =
  | "background"
  | "color"
  | "fire"
  | "mixed"
  | "motion"
  | "preset"
  | "subject";

export type CustomizationControl =
  | "background_color"
  | "background_mode"
  | "blend"
  | "direction"
  | "flicker"
  | "grain"
  | "inside_glow"
  | "intensity"
  | "left_right"
  | "palette"
  | "preset"
  | "sharpness"
  | "shimmer"
  | "size"
  | "speed"
  | "spread"
  | "subject_color"
  | "treatment"
  | "up_down";

type ExportProperties = {
  kind: ExportKindMetric;
  ratio: ExportRatioMetric;
  quality: ExportQualityMetric;
  fps: number | null;
  duration_seconds: number | null;
  width: number;
  height: number;
  palette: ShaderPalette;
  subject_kind: SubjectKindMetric;
  treatment: "edge" | "material";
  background_mode: BackgroundModeMetric;
};

export type FayaaaEventMap = {
  fayaaa_app_loaded: {
    webgpu_supported: boolean;
    reduced_motion: boolean;
  };
  fayaaa_gpu_ready: {
    subject_kind: SubjectKindMetric;
  };
  fayaaa_gpu_failed: {
    reason: "initialization_failed" | "webgpu_missing";
  };
  fayaaa_unsupported_browser: {
    feature: "video_export" | "webgpu";
  };
  fayaaa_subject_changed: {
    kind: SubjectKindMetric;
    source: "built_in" | "preset" | "text" | "upload";
  };
  fayaaa_preset_changed: {
    preset: "brand-mark" | "burning-painting" | "current" | "paper-flame" | "violet-type";
  };
  fayaaa_palette_changed: {
    palette: ShaderPalette;
  };
  fayaaa_background_changed: {
    mode: BackgroundModeMetric;
    source: "mode" | "upload";
  };
  fayaaa_treatment_changed: {
    treatment: "edge" | "material";
  };
  fayaaa_customization_committed: {
    method: CustomizationMethod;
    area: CustomizationArea;
    controls: CustomizationControl[];
    control_count: number;
  };
  fayaaa_export_modal_opened: {
    kind: ExportKindMetric;
    ratio: ExportRatioMetric;
  };
  fayaaa_export_setting_changed: {
    setting: "kind" | "ratio";
    value: ExportKindMetric | ExportRatioMetric;
  };
  fayaaa_export_started: ExportProperties;
  fayaaa_export_succeeded: ExportProperties & {
    format: "mp4" | "png" | "webm";
  };
  fayaaa_export_failed: ExportProperties & {
    reason: "encode_failed" | "render_failed" | "verification_failed" | "unknown";
  };
  fayaaa_export_cancelled: ExportProperties;
  fayaaa_reset: {
    scope: "parameters";
  };
};

type AnalyticsEventName = keyof FayaaaEventMap;
type AnalyticsProperty = boolean | number | string | null | string[];
type AnalyticsProperties = Record<string, AnalyticsProperty>;

export type AnalyticsTransport = {
  capture(event: string, properties: AnalyticsProperties): void;
};

type QueuedEvent = {
  event: AnalyticsEventName;
  properties: AnalyticsProperties;
};

export class FayaaaAnalytics {
  private transport: AnalyticsTransport | undefined;
  private queue: QueuedEvent[] = [];
  private disabled = false;

  track<Event extends AnalyticsEventName>(
    event: Event,
    properties: FayaaaEventMap[Event],
  ): void {
    if (this.disabled) return;
    const queued = { event, properties: properties as AnalyticsProperties };
    if (!this.transport) {
      this.queue.push(queued);
      return;
    }
    this.transport.capture(event, queued.properties);
  }

  enable(transport: AnalyticsTransport): void {
    if (this.disabled) return;
    this.transport = transport;
    for (const item of this.queue) transport.capture(item.event, item.properties);
    this.queue = [];
  }

  disable(): void {
    this.disabled = true;
    this.queue = [];
    this.transport = undefined;
  }

  get status(): "disabled" | "enabled" | "pending" {
    if (this.disabled) return "disabled";
    return this.transport ? "enabled" : "pending";
  }
}

const PRIVATE_POSTHOG_PROPERTIES = new Set([
  "$current_url",
  "$initial_current_url",
  "$initial_referrer",
  "$referrer",
  "$referring_domain",
]);

export function stripPrivatePostHogProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => !PRIVATE_POSTHOG_PROPERTIES.has(key)),
  );
}

export const analytics = new FayaaaAnalytics();

export async function initializeAnalytics(): Promise<boolean> {
  const projectKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
  const host = import.meta.env.VITE_POSTHOG_HOST?.trim().replace(/\/+$/, "");
  if (!projectKey || !host) {
    analytics.disable();
    return false;
  }

  try {
    // The slim entrypoint omits replay, surveys, heatmaps, and other extensions
    // this explicit-event integration disables anyway.
    const { default: posthog } = await import("posthog-js/dist/module.slim");
    posthog.init(projectKey, {
      api_host: host,
      autocapture: false,
      rageclick: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      person_profiles: "never",
      persistence: "localStorage",
      respect_dnt: true,
      save_referrer: false,
      save_campaign_params: false,
      disable_capture_url_hashes: true,
      disable_scroll_properties: true,
      disableDeviceModel: true,
      before_send: (event) => {
        if (!event) return null;
        event.properties = stripPrivatePostHogProperties(
          event.properties ?? {},
        ) as typeof event.properties;
        return event;
      },
    });
    analytics.enable({
      capture(event, properties) {
        posthog.capture(event, properties);
      },
    });
    return true;
  } catch (error) {
    console.warn("Fayaaa analytics could not start; continuing without tracking.", error);
    analytics.disable();
    return false;
  }
}

export function exportFailureReason(
  error: unknown,
): FayaaaEventMap["fayaaa_export_failed"]["reason"] {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("did not match") || message.includes("read back")) {
    return "verification_failed";
  }
  if (message.includes("encode") || message.includes("encoder")) return "encode_failed";
  if (message.includes("render") || message.includes("canvas")) return "render_failed";
  return "unknown";
}

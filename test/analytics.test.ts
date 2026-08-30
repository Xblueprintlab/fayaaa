import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  exportFailureReason,
  FayaaaAnalytics,
  stripPrivatePostHogProperties,
} from "../src/analytics";

describe("Fayaaa analytics contract", () => {
  it("queues typed events until the transport is ready", () => {
    const capture = vi.fn();
    const client = new FayaaaAnalytics();

    client.track("fayaaa_app_loaded", {
      webgpu_supported: true,
      reduced_motion: false,
    });
    expect(client.status).toBe("pending");

    client.enable({ capture });
    expect(client.status).toBe("enabled");
    expect(capture).toHaveBeenCalledWith("fayaaa_app_loaded", {
      webgpu_supported: true,
      reduced_motion: false,
    });
  });

  it("turns missing configuration into a safe no-op", () => {
    const capture = vi.fn();
    const client = new FayaaaAnalytics();
    client.disable();
    client.enable({ capture });
    client.track("fayaaa_reset", { scope: "parameters" });

    expect(client.status).toBe("disabled");
    expect(capture).not.toHaveBeenCalled();
  });

  it("keeps successful export properties useful without creative content", () => {
    const capture = vi.fn();
    const client = new FayaaaAnalytics();
    client.enable({ capture });
    client.track("fayaaa_export_succeeded", {
      kind: "image",
      ratio: "1:1",
      quality: "high",
      fps: null,
      duration_seconds: null,
      width: 1080,
      height: 1080,
      palette: "fire",
      subject_kind: "image",
      treatment: "material",
      background_mode: "color",
      format: "png",
    });

    const properties = capture.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(properties.palette).toBe("fire");
    expect(properties).not.toHaveProperty("text");
    expect(properties).not.toHaveProperty("filename");
    expect(properties).not.toHaveProperty("file");
    expect(properties).not.toHaveProperty("color");
  });

  it("removes raw URLs and referrers added by the browser SDK", () => {
    expect(stripPrivatePostHogProperties({
      $current_url: "https://example.com/private?draft=1",
      $initial_referrer: "https://example.org/sensitive",
      palette: "ghost",
      $browser: "Chrome",
    })).toEqual({ palette: "ghost", $browser: "Chrome" });
  });

  it("uses stable error categories instead of raw exception messages", () => {
    expect(exportFailureReason(new Error("encoded file did not match requested settings")))
      .toBe("verification_failed");
    expect(exportFailureReason(new Error("encoder produced no output"))).toBe("encode_failed");
    expect(exportFailureReason(new Error("canvas could not render"))).toBe("render_failed");
    expect(exportFailureReason(new Error("secret local path"))).toBe("unknown");
  });

  it("pins the privacy configuration and environment-only credentials", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/analytics.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("VITE_POSTHOG_KEY");
    expect(source).toContain("VITE_POSTHOG_HOST");
    expect(source).toContain('autocapture: false');
    expect(source).toContain('capture_pageview: false');
    expect(source).toContain('disable_session_recording: true');
    expect(source).toContain('person_profiles: "never"');
    expect(source).toContain('persistence: "localStorage"');
    expect(source).not.toMatch(/phc_[a-zA-Z0-9]{10,}/);
  });

  it("wires successful exports after download validation and batches manual controls", () => {
    const main = readFileSync(
      fileURLToPath(new URL("../src/main.ts", import.meta.url)),
      "utf8",
    );
    const imageDownload = main.indexOf("downloadBlob(png");
    const imageSuccess = main.indexOf(
      'analytics.track("fayaaa_export_succeeded", { ...exportProperties, format: "png" })',
    );
    expect(imageDownload).toBeGreaterThan(-1);
    expect(imageSuccess).toBeGreaterThan(imageDownload);
    expect(main).toContain("window.setTimeout(flushManualCustomization, 650)");
    expect(main).toContain("if (!previous)");
    expect(main).toContain("if (suppressNextDialCustomization)");
  });
});

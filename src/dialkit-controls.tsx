import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { DialRoot, useDialKitController } from "dialkit";
import "dialkit/styles.css";
import { CONTROL_ICONS, mountControlIcons } from "./control-icons";

export type PlaygroundDialValues = {
  presets: {
    preset: ShowcasePresetId;
  };
  subject: {
    size: number;
    leftRight: number;
    upDown: number;
  };
  fire: {
    treatment: string;
    direction: string;
    blend: string;
    intensity: number;
    spread: number;
    insideGlow: number;
    sharpness: number;
  };
  motion: {
    speed: number;
    flicker: number;
    shimmer: number;
    grain: number;
  };
};

export type ShowcasePresetId =
  | "current"
  | "brand-mark"
  | "burning-painting"
  | "violet-type"
  | "paper-flame";

type ShowcasePresetValues = Pick<PlaygroundDialValues, "subject" | "fire" | "motion">;

const CURRENT_SETUP_STORAGE_KEY = "fayaaa.playground.current-controls.v1";

const copyShowcaseValues = (values: ShowcasePresetValues): ShowcasePresetValues => ({
  subject: { ...values.subject },
  fire: { ...values.fire },
  motion: { ...values.motion },
});

function readCurrentSetupValues(): ShowcasePresetValues | null {
  try {
    const stored = localStorage.getItem(CURRENT_SETUP_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<ShowcasePresetValues>;
    if (!parsed.subject || !parsed.fire || !parsed.motion) return null;
    return copyShowcaseValues(parsed as ShowcasePresetValues);
  } catch {
    return null;
  }
}

function saveCurrentSetupValues(values: ShowcasePresetValues): void {
  try {
    localStorage.setItem(CURRENT_SETUP_STORAGE_KEY, JSON.stringify(values));
  } catch {
    // DialKit still retains the active values when storage is unavailable.
  }
}

type DialKitCallbacks = {
  onValues(values: PlaygroundDialValues): void;
  onAction(action: string): void;
  onPreset(preset: ShowcasePresetId): void;
  onPalette(palette: "fire" | "plasma" | "ghost"): void;
  onSubjectColor(color: string): void;
  initialSubjectColor: string;
};

const SHOWCASE_PRESETS: Record<Exclude<ShowcasePresetId, "current">, ShowcasePresetValues> = {
  "brand-mark": {
    subject: { size: 46, leftRight: 0, upDown: 1 },
    fire: {
      treatment: "material",
      direction: "64",
      blend: "normal",
      intensity: 53,
      spread: 8,
      insideGlow: 55.5,
      sharpness: 85,
    },
    motion: { speed: 40, flicker: 24, shimmer: 19, grain: 44 },
  },
  "burning-painting": {
    subject: { size: 60, leftRight: 0, upDown: 0 },
    fire: {
      treatment: "edge",
      direction: "0",
      blend: "normal",
      intensity: 24,
      spread: 20,
      insideGlow: 36,
      sharpness: 88,
    },
    motion: { speed: 28, flicker: 18, shimmer: 22, grain: 52 },
  },
  "violet-type": {
    subject: { size: 64, leftRight: 0, upDown: 0 },
    fire: {
      treatment: "material",
      direction: "0",
      blend: "normal",
      intensity: 56,
      spread: 10,
      insideGlow: 58,
      sharpness: 85,
    },
    motion: { speed: 38, flicker: 24, shimmer: 20, grain: 44 },
  },
  "paper-flame": {
    subject: { size: 55, leftRight: 0, upDown: 0 },
    fire: {
      treatment: "edge",
      direction: "full",
      blend: "normal",
      intensity: 17,
      spread: 23,
      insideGlow: 40,
      sharpness: 88,
    },
    motion: { speed: 30, flicker: 20, shimmer: 26, grain: 46 },
  },
};

const PRESET_LABELS: Record<ShowcasePresetId, string> = {
  current: "Current setup",
  "brand-mark": "Brand mark",
  "burning-painting": "Burning painting",
  "violet-type": "Violet type",
  "paper-flame": "Paper flame",
};

const DEFAULT_CONTROL_VALUES: PlaygroundDialValues = {
  presets: { preset: "current" },
  ...SHOWCASE_PRESETS["brand-mark"],
};

const controls = {
  presets: {
    preset: {
      type: "select" as const,
      default: DEFAULT_CONTROL_VALUES.presets.preset,
      options: [
        { value: "current", label: PRESET_LABELS.current },
        { value: "brand-mark", label: PRESET_LABELS["brand-mark"] },
        { value: "burning-painting", label: PRESET_LABELS["burning-painting"] },
        { value: "violet-type", label: PRESET_LABELS["violet-type"] },
        { value: "paper-flame", label: PRESET_LABELS["paper-flame"] },
      ],
    },
    resetToDefault: {
      type: "action" as const,
      label: "Reset to default",
    },
  },
  subject: {
    size: [DEFAULT_CONTROL_VALUES.subject.size, 15, 95, 1] as [number, number, number, number],
    leftRight: [DEFAULT_CONTROL_VALUES.subject.leftRight, -30, 30, 1] as [number, number, number, number],
    upDown: [DEFAULT_CONTROL_VALUES.subject.upDown, -30, 30, 1] as [number, number, number, number],
  },
  fire: {
    treatment: {
      type: "select" as const,
      default: DEFAULT_CONTROL_VALUES.fire.treatment,
      options: [
        { value: "edge", label: "Burn around" },
        { value: "material", label: "Burn through" },
      ],
    },
    direction: {
      type: "select" as const,
      default: DEFAULT_CONTROL_VALUES.fire.direction,
      options: [
        { value: "full", label: "Full" },
        { value: "0", label: "Bottom" },
        { value: "64", label: "Lower right" },
        { value: "90", label: "Right" },
        { value: "180", label: "Top" },
        { value: "270", label: "Left" },
      ],
    },
    blend: {
      type: "select" as const,
      default: DEFAULT_CONTROL_VALUES.fire.blend,
      options: [
        { value: "normal", label: "Normal" },
        { value: "screen", label: "Screen" },
        { value: "add", label: "Add" },
        { value: "multiply", label: "Multiply" },
        { value: "overlay", label: "Overlay" },
      ],
    },
    intensity: [DEFAULT_CONTROL_VALUES.fire.intensity, 0, 100, 1] as [number, number, number, number],
    spread: [DEFAULT_CONTROL_VALUES.fire.spread, 0, 100, 1] as [number, number, number, number],
    insideGlow: [DEFAULT_CONTROL_VALUES.fire.insideGlow, 0, 100, 0.5] as [number, number, number, number],
    sharpness: [DEFAULT_CONTROL_VALUES.fire.sharpness, 0, 100, 1] as [number, number, number, number],
  },
  motion: {
    speed: [DEFAULT_CONTROL_VALUES.motion.speed, 0, 100, 1] as [number, number, number, number],
    flicker: [DEFAULT_CONTROL_VALUES.motion.flicker, 0, 100, 1] as [number, number, number, number],
    shimmer: [DEFAULT_CONTROL_VALUES.motion.shimmer, 0, 100, 1] as [number, number, number, number],
    grain: [DEFAULT_CONTROL_VALUES.motion.grain, 0, 100, 1] as [number, number, number, number],
  },
};

function ControlRegistration({ onValues, onAction, onPreset }: DialKitCallbacks) {
  const appliedPreset = useRef<ShowcasePresetId | null>(null);
  const currentSetupValues = useRef<ShowcasePresetValues | null>(readCurrentSetupValues());
  const controller = useDialKitController("Controls", controls, {
    id: "fayaaa-controls",
    persist: { key: "fayaaa.playground.controls.v1", storage: "localStorage" },
    onAction: (action) => {
      if (action !== "presets.resetToDefault") return;
      const selectedPreset = controller.values.presets.preset as ShowcasePresetId;
      appliedPreset.current = selectedPreset;
      controller.setValues({
        ...DEFAULT_CONTROL_VALUES,
        presets: { preset: selectedPreset },
      });
      onAction("resetToDefault");
    },
  });
  const previousDirection = useRef(String(controller.values.fire.direction));

  useEffect(() => {
    const values = controller.values as unknown as PlaygroundDialValues;
    const storedPreset = values.presets.preset as string;
    if (storedPreset !== "current" && !(storedPreset in SHOWCASE_PRESETS)) {
      appliedPreset.current = "current";
      controller.setValues({ presets: { preset: "current" } });
      return;
    }
    const selectedPreset = values.presets.preset;

    if (appliedPreset.current === null) {
      appliedPreset.current = selectedPreset;
      if (selectedPreset !== "current") {
        controller.setValues(SHOWCASE_PRESETS[selectedPreset]);
        onPreset(selectedPreset);
        return;
      }
    } else if (selectedPreset !== appliedPreset.current) {
      if (appliedPreset.current === "current" && selectedPreset !== "current") {
        const currentValues = {
          subject: { ...values.subject },
          fire: { ...values.fire },
          motion: { ...values.motion },
        };
        currentSetupValues.current = currentValues;
        saveCurrentSetupValues(currentValues);
      }
      appliedPreset.current = selectedPreset;
      if (selectedPreset === "current") {
        if (currentSetupValues.current) controller.setValues(currentSetupValues.current);
      } else {
        controller.setValues(SHOWCASE_PRESETS[selectedPreset]);
      }
      onPreset(selectedPreset);
      return;
    }

    if (selectedPreset === "current") {
      const currentValues = copyShowcaseValues(values);
      currentSetupValues.current = currentValues;
      saveCurrentSetupValues(currentValues);
    }

    const enteredFull = values.fire.direction === "full" && previousDirection.current !== "full";
    previousDirection.current = values.fire.direction;

    if (enteredFull && (values.fire.intensity !== 17 || values.fire.spread !== 23)) {
      controller.setValues({ fire: { intensity: 17, spread: 23 } });
      return;
    }

    onValues(values);
  }, [controller.values, controller.setValues, onPreset, onValues]);

  return null;
}

const palettes = [
  { id: "fire", label: "Fire", colors: ["#ff3415", "#ff9b36", "#ffe2a1"] },
  { id: "plasma", label: "Violet", colors: ["#7d20ff", "#ef30d8", "#ff9bf2"] },
  { id: "ghost", label: "Mint", colors: ["#4ee6bd", "#b7ffe8", "#effff9"] },
] as const;

function hsvToHex(hue: number, saturation: number, value: number): string {
  const s = saturation / 100;
  const v = value / 100;
  const chroma = v * s;
  const section = ((hue % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs(section % 2 - 1));
  const [r1, g1, b1] = section < 1 ? [chroma, x, 0]
    : section < 2 ? [x, chroma, 0]
      : section < 3 ? [0, chroma, x]
        : section < 4 ? [0, x, chroma]
          : section < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const match = v - chroma;
  return `#${[r1, g1, b1]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToHsv(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === channels[0]) hue = 60 * (((channels[1] - channels[2]) / delta) % 6);
    else if (max === channels[1]) hue = 60 * ((channels[2] - channels[0]) / delta + 2);
    else hue = 60 * ((channels[0] - channels[1]) / delta + 4);
  }
  return [Math.round((hue + 360) % 360), Math.round(max ? (delta / max) * 100 : 0), Math.round(max * 100)];
}

function SubjectColorPicker({ onSubjectColor, initialSubjectColor }: Pick<DialKitCallbacks, "onSubjectColor" | "initialSubjectColor">) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [initialHue, initialSaturation, initialValue] = hexToHsv(initialSubjectColor);
  const [hue, setHue] = useState(initialHue);
  const [saturation, setSaturation] = useState(initialSaturation);
  const [value, setValue] = useState(initialValue);
  const color = hsvToHex(hue, saturation, value);

  useEffect(() => {
    let frame = 0;
    let host: HTMLDivElement | undefined;
    const attach = () => {
      const folder = [...document.querySelectorAll<HTMLElement>(".dialkit-folder:not(.dialkit-folder-root)")]
        .find((candidate) => candidate.querySelector<HTMLElement>(".dialkit-folder-title")?.textContent?.trim() === "Subject");
      const inner = folder?.querySelector<HTMLElement>(":scope > .dialkit-folder-content > .dialkit-folder-inner");
      if (!inner) {
        frame = requestAnimationFrame(attach);
        return;
      }
      host = document.createElement("div");
      host.className = "subject-color-row-host";
      inner.append(host);
      setPortalTarget(host);
    };
    attach();
    return () => {
      cancelAnimationFrame(frame);
      host?.remove();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const close = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const updateColor = (nextHue: number, nextSaturation: number, nextValue: number) => {
    setHue(nextHue);
    setSaturation(nextSaturation);
    setValue(nextValue);
    onSubjectColor(hsvToHex(nextHue, nextSaturation, nextValue));
  };

  const pickSaturationValue = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextSaturation = Math.round(Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * 100);
    const nextValue = Math.round((1 - Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))) * 100);
    updateColor(hue, nextSaturation, nextValue);
  };

  if (!portalTarget) return null;
  return createPortal(
    <div className={`subject-color-picker${isOpen ? " is-open" : ""}`} role="group" aria-label="Subject color" ref={pickerRef}>
      <span className="subject-color-label">
        <span className="control-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: CONTROL_ICONS.Color }} />
        Color
      </span>
      <button
        className="subject-color-trigger"
        type="button"
        aria-label="Choose subject color"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="subject-color-current" style={{ background: color }} />
        <svg aria-hidden="true" viewBox="0 0 12 12"><path d="m3 4.5 3 3 3-3" /></svg>
      </button>
      {isOpen && (
        <div className="subject-color-popover">
          <div
            className="subject-color-field"
            role="slider"
            tabIndex={0}
            aria-label="Saturation and brightness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={saturation}
            aria-valuetext={`${color}, ${saturation}% saturation, ${value}% brightness`}
            style={{ "--picker-hue": hue } as React.CSSProperties}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              pickSaturationValue(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) pickSaturationValue(event);
            }}
            onKeyDown={(event) => {
              const steps: Record<string, [number, number]> = {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, 1],
                ArrowDown: [0, -1],
              };
              const step = steps[event.key];
              if (!step) return;
              event.preventDefault();
              updateColor(
                hue,
                Math.min(100, Math.max(0, saturation + step[0])),
                Math.min(100, Math.max(0, value + step[1])),
              );
            }}
          >
            <span
              className="subject-color-field-handle"
              style={{ left: `${saturation}%`, top: `${100 - value}%`, background: color }}
            />
          </div>
          <div className="subject-hue-control">
            <span className="subject-color-current" style={{ background: color }} />
            <input
              className="subject-hue-slider"
              type="range"
              min="0"
              max="359"
              step="1"
              value={hue}
              aria-label="Hue"
              style={{ "--picker-hue": hue } as React.CSSProperties}
              onChange={(event) => updateColor(Number(event.target.value), saturation, value)}
            />
          </div>
        </div>
      )}
    </div>,
    portalTarget,
  );
}

function PalettePicker({ onPalette }: Pick<DialKitCallbacks, "onPalette">) {
  const portalTarget = document.querySelector<HTMLElement>("#toolbar-palette-root");
  if (!portalTarget) return null;
  const selectPalette = (palette: "fire" | "plasma" | "ghost") => {
    onPalette(palette);
    const menu = portalTarget.closest<HTMLElement>("[data-toolbar-menu]");
    menu?.classList.remove("is-open");
    menu?.querySelector<HTMLElement>(".toolbar-trigger")?.setAttribute("aria-expanded", "false");
    const popover = menu?.querySelector<HTMLElement>(".toolbar-popover");
    if (popover) popover.hidden = true;
  };
  return createPortal(
    <div className="palette-picker" role="group" aria-label="Fire colors">
      <div className="palette-swatches">
        {palettes.map((palette) => (
          <button
            className="palette-swatch"
            type="button"
            key={palette.id}
            data-palette={palette.id}
            aria-label={`${palette.label} colors`}
            aria-pressed={palette.id === "fire"}
            title={palette.label}
            style={{ "--palette-colors": palette.colors.join(", ") } as React.CSSProperties}
            onClick={() => selectPalette(palette.id)}
          />
        ))}
      </div>
    </div>,
    portalTarget,
  );
}

function DialKitPanel(props: DialKitCallbacks) {
  return (
    <>
      <ControlRegistration {...props} />
      <DialRoot mode="inline" theme="light" defaultOpen productionEnabled />
      <SubjectColorPicker onSubjectColor={props.onSubjectColor} initialSubjectColor={props.initialSubjectColor} />
      <PalettePicker onPalette={props.onPalette} />
    </>
  );
}

export function mountDialKit(rootElement: HTMLElement, callbacks: DialKitCallbacks): () => void {
  const root: Root = createRoot(rootElement);
  root.render(<DialKitPanel {...callbacks} />);
  const cleanupIcons = mountControlIcons(rootElement);
  return () => {
    cleanupIcons();
    root.unmount();
  };
}

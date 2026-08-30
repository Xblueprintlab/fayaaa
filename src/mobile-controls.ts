// CapCut-style mobile controls: a horizontally scrolling icon toolbar pinned
// to the bottom of the screen, where each tool opens a small bottom sheet with
// just that control. Values read and write the same DialKit store the desktop
// rail uses (panel "fayaaa-controls"), so the two UIs stay in sync and the
// existing onValues flow keeps driving the shader and the audio.

import { DialStore } from "dialkit";
import { CONTROL_ICONS } from "./control-icons";

const PANEL_ID = "fayaaa-controls";

const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.75L10 19L19 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

type SliderTool = {
  kind: "slider";
  label: string;
  path: string;
  min: number;
  max: number;
  step: number;
};
type SelectTool = {
  kind: "select";
  label: string;
  path: string;
  options: { value: string; label: string }[];
};
type ColorTool = { kind: "color"; label: string };
type Tool = SliderTool | SelectTool | ColorTool;

// Mirrors the ranges declared in dialkit-controls.tsx.
const TOOLS: Tool[] = [
  { kind: "slider", label: "Size", path: "subject.size", min: 15, max: 95, step: 1 },
  { kind: "slider", label: "Left Right", path: "subject.leftRight", min: -30, max: 30, step: 1 },
  { kind: "slider", label: "Up Down", path: "subject.upDown", min: -30, max: 30, step: 1 },
  { kind: "color", label: "Color" },
  {
    kind: "select",
    label: "Treatment",
    path: "fire.treatment",
    options: [
      { value: "edge", label: "Burn around" },
      { value: "material", label: "Burn through" },
    ],
  },
  {
    kind: "select",
    label: "Direction",
    path: "fire.direction",
    options: [
      { value: "full", label: "Full" },
      { value: "0", label: "Bottom" },
      { value: "64", label: "Lower right" },
      { value: "90", label: "Right" },
      { value: "180", label: "Top" },
      { value: "270", label: "Left" },
    ],
  },
  {
    kind: "select",
    label: "Blend",
    path: "fire.blend",
    options: [
      { value: "normal", label: "Normal" },
      { value: "screen", label: "Screen" },
      { value: "add", label: "Add" },
      { value: "multiply", label: "Multiply" },
      { value: "overlay", label: "Overlay" },
    ],
  },
  { kind: "slider", label: "Intensity", path: "fire.intensity", min: 0, max: 100, step: 1 },
  { kind: "slider", label: "Spread", path: "fire.spread", min: 0, max: 100, step: 1 },
  { kind: "slider", label: "Inside Glow", path: "fire.insideGlow", min: 0, max: 100, step: 0.5 },
  { kind: "slider", label: "Sharpness", path: "fire.sharpness", min: 0, max: 100, step: 1 },
  { kind: "slider", label: "Speed", path: "motion.speed", min: 0, max: 100, step: 1 },
  { kind: "slider", label: "Flicker", path: "motion.flicker", min: 0, max: 100, step: 1 },
  { kind: "slider", label: "Shimmer", path: "motion.shimmer", min: 0, max: 100, step: 1 },
  { kind: "slider", label: "Grain", path: "motion.grain", min: 0, max: 100, step: 1 },
];

type MobileControlsOptions = {
  getSubjectColor(): string;
  onSubjectColor(color: string): void;
};

function formatValue(tool: SliderTool, value: number): string {
  return tool.step < 1 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
}

export function mountMobileControls(options: MobileControlsOptions): () => void {
  const root = document.createElement("div");
  root.className = "mobile-controls";

  const toolbar = document.createElement("div");
  toolbar.className = "mobile-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Fayaaa controls");

  const sheet = document.createElement("div");
  sheet.className = "mobile-sheet";
  sheet.hidden = true;

  root.append(toolbar, sheet);
  document.body.append(root);

  let activeTool: Tool | undefined;
  let syncActive: (() => void) | undefined;

  const closeSheet = () => {
    activeTool = undefined;
    syncActive = undefined;
    sheet.hidden = true;
    sheet.replaceChildren();
    root.classList.remove("sheet-open");
  };

  const openSheet = (tool: Tool) => {
    activeTool = tool;
    sheet.replaceChildren();

    const header = document.createElement("header");
    header.className = "mobile-sheet-header";
    const title = document.createElement("span");
    title.className = "mobile-sheet-title";
    title.textContent = tool.label;
    const done = document.createElement("button");
    done.type = "button";
    done.className = "mobile-sheet-done";
    done.setAttribute("aria-label", `Done adjusting ${tool.label}`);
    done.innerHTML = ICON_CHECK;
    done.addEventListener("click", closeSheet);
    header.append(title, done);

    const body = document.createElement("div");
    body.className = "mobile-sheet-body";

    if (tool.kind === "slider") {
      // Same pill as the desktop rail rows: label inside, fill behind, drag
      // anywhere on the pill to set the value.
      const pill = document.createElement("div");
      pill.className = "mobile-pill-slider";
      pill.tabIndex = 0;
      pill.setAttribute("role", "slider");
      pill.setAttribute("aria-label", tool.label);
      pill.setAttribute("aria-valuemin", String(tool.min));
      pill.setAttribute("aria-valuemax", String(tool.max));
      const fill = document.createElement("div");
      fill.className = "mobile-pill-fill";
      const pillLabel = document.createElement("span");
      pillLabel.className = "mobile-pill-label";
      const pillIcon = document.createElement("span");
      pillIcon.className = "control-icon";
      pillIcon.setAttribute("aria-hidden", "true");
      pillIcon.innerHTML = CONTROL_ICONS[tool.label] ?? "";
      pillLabel.append(pillIcon, tool.label);
      const output = document.createElement("output");
      output.className = "mobile-pill-value";
      pill.append(fill, pillLabel, output);

      const clampToStep = (value: number) => {
        const snapped = Math.round((value - tool.min) / tool.step) * tool.step + tool.min;
        return Math.min(tool.max, Math.max(tool.min, Number(snapped.toFixed(2))));
      };
      const paint = (value: number) => {
        fill.style.width = `${((value - tool.min) / (tool.max - tool.min)) * 100}%`;
        output.textContent = formatValue(tool, value);
        pill.setAttribute("aria-valuenow", String(value));
      };
      const currentValue = () => {
        const stored = Number(DialStore.getValue(PANEL_ID, tool.path));
        return Number.isFinite(stored) ? stored : tool.min;
      };
      const commit = (value: number) => {
        DialStore.updateValue(PANEL_ID, tool.path, value);
        paint(value);
      };
      const valueFromPointer = (event: PointerEvent) => {
        const bounds = pill.getBoundingClientRect();
        const ratio = (event.clientX - bounds.left) / Math.max(1, bounds.width);
        return clampToStep(tool.min + ratio * (tool.max - tool.min));
      };
      pill.addEventListener("pointerdown", (event) => {
        pill.setPointerCapture(event.pointerId);
        commit(valueFromPointer(event));
      });
      pill.addEventListener("pointermove", (event) => {
        if (pill.hasPointerCapture(event.pointerId)) commit(valueFromPointer(event));
      });
      pill.addEventListener("keydown", (event) => {
        const direction =
          event.key === "ArrowRight" || event.key === "ArrowUp"
            ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? -1
              : 0;
        if (!direction) return;
        event.preventDefault();
        commit(clampToStep(currentValue() + direction * tool.step * (event.shiftKey ? 10 : 1)));
      });

      const readStore = () => paint(currentValue());
      readStore();
      syncActive = readStore;
      body.append(pill);
    } else if (tool.kind === "select") {
      const group = document.createElement("div");
      group.className = "mobile-option-group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", tool.label);
      const paint = () => {
        const current = String(DialStore.getValue(PANEL_ID, tool.path) ?? "");
        for (const button of group.querySelectorAll<HTMLButtonElement>("button")) {
          button.setAttribute("aria-pressed", String(button.dataset.value === current));
        }
      };
      for (const option of tool.options) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.value = option.value;
        button.textContent = option.label;
        button.addEventListener("click", () => {
          DialStore.updateValue(PANEL_ID, tool.path, option.value);
          paint();
        });
        group.append(button);
      }
      paint();
      syncActive = paint;
      body.append(group);
    } else {
      const row = document.createElement("label");
      row.className = "mobile-color-row";
      const swatch = document.createElement("span");
      swatch.className = "mobile-color-swatch";
      swatch.style.setProperty("--swatch", options.getSubjectColor());
      const caption = document.createElement("span");
      caption.textContent = "Tap to pick the subject color";
      const input = document.createElement("input");
      input.type = "color";
      input.value = options.getSubjectColor();
      input.setAttribute("aria-label", "Subject color");
      input.addEventListener("input", () => {
        swatch.style.setProperty("--swatch", input.value);
        options.onSubjectColor(input.value);
      });
      row.append(swatch, caption, input);
      body.append(row);
    }

    sheet.append(header, body);
    sheet.hidden = false;
    root.classList.add("sheet-open");
  };

  for (const tool of TOOLS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-tool";
    const icon = document.createElement("span");
    icon.className = "mobile-tool-icon";
    icon.innerHTML = CONTROL_ICONS[tool.label] ?? "";
    const label = document.createElement("span");
    label.className = "mobile-tool-label";
    label.textContent = tool.label;
    button.append(icon, label);
    button.addEventListener("click", () => openSheet(tool));
    toolbar.append(button);
  }

  // Keep an open sheet in sync when the value changes elsewhere (presets,
  // desktop rail on a resized window, pointer steering changing direction).
  const unsubscribe = DialStore.subscribe(PANEL_ID, () => {
    if (activeTool) syncActive?.();
  });

  return () => {
    unsubscribe();
    root.remove();
  };
}

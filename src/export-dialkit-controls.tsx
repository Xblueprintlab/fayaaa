import { useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DialRoot, useDialKitController } from "dialkit";
import type { ExportSettings } from "./export-config";
import { mountControlIcons } from "./control-icons";

const EXPORT_PANEL_ID = "fayaaa-export-output";
const VIDEO_PANEL_ID = "fayaaa-export-video";

export type ExportDialValues = {
  kind: ExportSettings["kind"];
  ratio: ExportSettings["ratio"];
  quality: ExportSettings["quality"];
  scale: number;
  fps: ExportSettings["fps"];
  duration: ExportSettings["duration"];
};

type ExportDialKitProps = {
  rootElement: HTMLElement;
  initial: ExportDialValues;
  onValues(values: ExportDialValues): void;
};

function panelSlug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function observeDialPanels(): () => void {
  const hosts = [
    document.querySelector<HTMLElement>("#dialkit-root"),
    document.querySelector<HTMLElement>("#export-dialkit-root"),
  ].filter((host): host is HTMLElement => Boolean(host));
  const decorate = () => {
    for (const host of hosts) {
      for (const panel of host.querySelectorAll<HTMLElement>(".dialkit-panel")) {
        const title = panel.querySelector<HTMLElement>(".dialkit-folder-title-root")?.textContent;
        if (!title) continue;
        const slug = panelSlug(title);
        if (panel.dataset.dialkitPanel !== slug) panel.dataset.dialkitPanel = slug;
      }
      for (const folder of host.querySelectorAll<HTMLElement>(".dialkit-folder:not(.dialkit-folder-root)")) {
        const title = folder.querySelector<HTMLElement>(":scope > .dialkit-folder-header .dialkit-folder-title")?.textContent;
        if (!title) continue;
        const slug = panelSlug(title);
        if (folder.dataset.dialkitSection !== slug) folder.dataset.dialkitSection = slug;
      }
    }
  };
  const observer = new MutationObserver(decorate);
  for (const host of hosts) observer.observe(host, { childList: true, subtree: true });
  decorate();
  return () => observer.disconnect();
}

function ExportDialKitPanel({ rootElement, initial, onValues }: ExportDialKitProps) {
  const output = useDialKitController("Output", {
    type: {
      type: "select" as const,
      default: initial.kind,
      options: [
        { value: "image", label: "Image" },
        { value: "video", label: "Video" },
      ],
    },
    ratio: {
      type: "select" as const,
      default: initial.ratio,
      options: ["16:9", "1:1", "4:5", "9:16"],
    },
    resolution: {
      type: "select" as const,
      default: initial.quality,
      options: [
        { value: "standard", label: "720p" },
        { value: "high", label: "1080p" },
        { value: "max", label: "1440p" },
      ],
    },
    scale: [initial.scale, 100, 180, 5] as [number, number, number, number],
  }, { id: EXPORT_PANEL_ID });

  const video = useDialKitController("Video", {
    frameRate: {
      type: "select" as const,
      default: String(initial.fps),
      options: [
        { value: "24", label: "24 FPS" },
        { value: "30", label: "30 FPS" },
        { value: "60", label: "60 FPS" },
      ],
    },
    duration: {
      type: "select" as const,
      default: String(initial.duration),
      options: [
        { value: "3", label: "3 sec" },
        { value: "5", label: "5 sec" },
        { value: "10", label: "10 sec" },
      ],
    },
  }, { id: VIDEO_PANEL_ID });

  useEffect(() => observeDialPanels(), []);

  useEffect(() => {
    const kind = output.values.type as ExportSettings["kind"];
    rootElement.dataset.exportKind = kind;
    onValues({
      kind,
      ratio: output.values.ratio as ExportSettings["ratio"],
      quality: output.values.resolution as ExportSettings["quality"],
      scale: Number(output.values.scale),
      fps: Number(video.values.frameRate) as ExportSettings["fps"],
      duration: Number(video.values.duration) as ExportSettings["duration"],
    });
  }, [output.values, video.values, onValues, rootElement]);

  return <DialRoot mode="inline" theme="light" defaultOpen productionEnabled />;
}

export function mountExportDialKit(
  rootElement: HTMLElement,
  initial: ExportDialValues,
  onValues: (values: ExportDialValues) => void,
): () => void {
  const root: Root = createRoot(rootElement);
  root.render(<ExportDialKitPanel rootElement={rootElement} initial={initial} onValues={onValues} />);
  const cleanupIcons = mountControlIcons(rootElement);
  return () => {
    cleanupIcons();
    root.unmount();
  };
}

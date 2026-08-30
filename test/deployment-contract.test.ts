import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

describe("BlueprintLab route deployment", () => {
  it("builds Fayaaa entirely beneath /fayaaa", () => {
    const vite = readProjectFile("vite.config.ts");
    const basePath = readProjectFile("src/base-path.ts");
    const page = readProjectFile("src/playground-page.ts");

    expect(vite).toContain('base: "/fayaaa/"');
    expect(vite).toContain('outDir: "dist/fayaaa"');
    expect(basePath).toContain("import.meta.env.BASE_URL");
    expect(page).toContain('href="${appPath}"');
    expect(page).toContain('assetUrl("fayaaa-mark.png")');
  });

  it("routes only /fayaaa and its descendants to this Worker", () => {
    const wrangler = readProjectFile("wrangler.jsonc");

    expect(wrangler).toContain('"directory": "./dist"');
    expect(wrangler).toContain('"html_handling": "drop-trailing-slash"');
    expect(wrangler).toContain('"pattern": "blueprintlab.work/fayaaa"');
    expect(wrangler).toContain('"pattern": "blueprintlab.work/fayaaa/*"');
    expect(wrangler).not.toContain('"custom_domain": true');
  });
});

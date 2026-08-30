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

  it("routes /fayaaa, its query strings, and descendants to this Worker", () => {
    const wrangler = readProjectFile("wrangler.jsonc");
    const worker = readProjectFile("src/worker.mjs");

    expect(wrangler).toContain('"main": "./src/worker.mjs"');
    expect(wrangler).toContain('"directory": "./dist"');
    expect(wrangler).toContain('"binding": "ASSETS"');
    expect(wrangler).toContain('"html_handling": "auto-trailing-slash"');
    expect(wrangler).toContain('"run_worker_first": ["/fayaaa"]');
    expect(wrangler).toContain('"pattern": "blueprintlab.work/fayaaa*"');
    expect(wrangler).not.toContain('"custom_domain": true');
    expect(worker).toContain('url.pathname === "/fayaaa"');
    expect(worker).toContain('url.pathname = "/fayaaa/"');
    expect(worker).toContain("Response.redirect(url, 307)");
    expect(worker).toContain("env.ASSETS.fetch(request)");
  });
});

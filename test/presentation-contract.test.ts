import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const compositePath = fileURLToPath(
  new URL("../src/shaders/composite.wgsl", import.meta.url),
);
const pipelinePath = fileURLToPath(
  new URL("../src/pipeline.ts", import.meta.url),
);
const mainPath = fileURLToPath(
  new URL("../src/main.ts", import.meta.url),
);
const controlsPath = fileURLToPath(
  new URL("../src/dialkit-controls.tsx", import.meta.url),
);
const persistencePath = fileURLToPath(
  new URL("../src/playground-persistence.ts", import.meta.url),
);
const cssPath = fileURLToPath(new URL("../src/app.css", import.meta.url));

it("returns canonical Fire exactly on a solid background and preserves alpha for compositions", () => {
  const source = readFileSync(compositePath, "utf8");
  expect(source).toMatch(
    /if \(g\.compositeBackground < 0\.5\) \{\s*return vec4f\(base, 1\.0\);\s*\}/,
  );
  expect(source).toMatch(
    /if \(progress >= 0\.999\) \{\s*return select\(/,
  );
  expect(source).toContain("presentResult(base, input, params)");
  expect(source).toContain("presentEdgeBurn(base, input, params)");
  expect(source).toContain("return vec4f(base * alpha, alpha);");
  expect(source).toContain(
    "let insideAmount = select(clamp(p.innerGlow * 0.5, 0.0, 1.0), 1.0, g.blendMode < 0.5);",
  );
  expect(source).toContain("outerGlow * (1.0 - inside)");
});

it("keeps Full on the canonical Fire material and locked during canvas steering", () => {
  const composite = readFileSync(compositePath, "utf8");
  const main = readFileSync(mainPath, "utf8");
  const controls = readFileSync(controlsPath, "utf8");
  expect(composite).toContain("let allEdgesHeat = mix(0.58, 0.86, edgeHeat);");
  expect(composite).toContain("input.hnorm = select(directionalHeat, allEdgesHeat, g.fullHeat >= 0.5);");
  expect(composite).not.toContain("activeParams");
  expect(
    main.match(/if \(readHeatDirection\(state\.heatAngle\) === "full"\) return;/g),
  ).toHaveLength(3);
  expect(controls).toContain('controller.setValues({ fire: { intensity: 17, spread: 23 } });');
});

it("does not reset effect progress when Fire parameters change", () => {
  const source = readFileSync(pipelinePath, "utf8");
  const applyParams = source.match(
    /applyEmberParams\([^)]*: ParamState\): void \{([\s\S]*?)\n  \}/,
  )?.[1];
  expect(applyParams).toBeTruthy();
  expect(applyParams).not.toMatch(/energy|effectProgress/);
});

it("persists controls, composition settings, and uploaded assets across refreshes", () => {
  const controls = readFileSync(controlsPath, "utf8");
  const main = readFileSync(mainPath, "utf8");
  const persistence = readFileSync(persistencePath, "utf8");
  expect(controls).toContain('key: "fayaaa.playground.controls.v1"');
  expect(controls).toContain('storage: "localStorage"');
  expect(persistence).toContain('const SETTINGS_KEY = "fayaaa.playground.settings.v1";');
  expect(persistence).toContain('const ASSET_DB = "fayaaa-playground";');
  expect(main).toContain('loadPlaygroundAsset("subject")');
  expect(main).toContain('loadPlaygroundAsset("background")');
  expect(main).toContain('savePlaygroundAsset("subject", blob, name)');
  expect(main).toContain('savePlaygroundAsset("background", blob, name)');
});

it("resets only control parameters while preserving the subject and composition", () => {
  const controls = readFileSync(controlsPath, "utf8");
  const main = readFileSync(mainPath, "utf8");
  expect(controls.indexOf("presets: {")).toBeLessThan(controls.indexOf("subject: {"));
  expect(controls).toContain('action !== "presets.resetToDefault"');
  expect(controls).toContain('label: "Reset to default"');
  expect(controls).toContain('presets: { preset: selectedPreset }');
  expect(main).toContain('action === "resetToDefault"');
  expect(main).toContain('announce("Parameters reset to default")');
});

it("offers complete showcase scenes without replacing the saved current setup", () => {
  const controls = readFileSync(controlsPath, "utf8");
  const main = readFileSync(mainPath, "utf8");
  expect(controls).toContain('{ value: "current", label: PRESET_LABELS.current }');
  expect(controls).toContain('{ value: "burning-painting", label: PRESET_LABELS["burning-painting"] }');
  expect(controls).toContain('{ value: "violet-type", label: PRESET_LABELS["violet-type"] }');
  expect(controls).toContain('{ value: "paper-flame", label: PRESET_LABELS["paper-flame"] }');
  expect(main).toContain("captureCurrentSetup();");
  expect(main).toContain('announce("Current setup restored")');
  expect(main).not.toContain('deletePlaygroundAsset("subject")');
  expect(main).not.toContain('deletePlaygroundAsset("background")');
});

it("burns the artwork as a subject instead of hanging it behind the fire", () => {
  const main = readFileSync(mainPath, "utf8");
  const sceneStart = main.indexOf('"burning-painting": {');
  const sceneEnd = main.indexOf('"violet-type": {');
  expect(sceneStart).toBeGreaterThan(-1);
  const scene = main.slice(sceneStart, sceneEnd);
  expect(scene).toContain('url: "/art-painting.jpg"');
  expect(scene).toContain("supportsBurnAround: true");
  expect(scene).toContain('background: { mode: "color"');
  expect(scene).not.toContain('mode: "image"');
});

it("rasterizes vector subjects at full pipeline resolution instead of intrinsic size", () => {
  const main = readFileSync(mainPath, "utf8");
  expect(main).toContain('const isVector = blob.type === "image/svg+xml";');
  expect(main).toContain("isVector ? max / largest : Math.min(1, max / largest)");
});

it("keeps the Normal fire body opaque over image and transparent backgrounds", () => {
  const composite = readFileSync(compositePath, "utf8");
  expect(composite).toContain(
    "select(clamp(p.innerGlow * 0.5, 0.0, 1.0), 1.0, g.blendMode < 0.5)",
  );
});

it("uses true black only for the intro and restores the playground background", () => {
  const main = readFileSync(mainPath, "utf8");
  const css = readFileSync(cssPath, "utf8");
  expect(main).toContain("const dialBackgroundColor = String(state.bgColor);");
  expect(main).toContain('state.bgColor = "#000000";');
  expect(main).toMatch(/state\.bgColor = "#000000";\s*syncStageBackground\(\);/);
  expect(main).toMatch(
    /const restoreDialMaterial = \(restoreBackground = true\) => \{[\s\S]*?if \(restoreBackground\) state\.bgColor = dialBackgroundColor;[\s\S]*?currentPipeline\.applyEmberParams\(state\);\s*if \(restoreBackground\) syncStageBackground\(\);/,
  );
  expect(css).toMatch(/body\.intro-playing \{[\s\S]*?background: #000000;/);
});

it("pulls the intro camera back on wide viewports without changing the playground scale", () => {
  const main = readFileSync(mainPath, "utf8");
  expect(main).toContain("zoomFrom: 0.25");
  expect(main).toContain("zoomTo:   0.32");
  expect(main).toContain("markScale: 0.15");
  expect(main).toContain("const viewportAspect = window.innerWidth / Math.max(1, window.innerHeight);");
  expect(main).toContain("const introScale = 1 - 0.18 * wideProgress * wideProgress * (3 - 2 * wideProgress);");
  expect(main).toContain("const introMarkScale = INTRO_CAMERA.markScale * introScale;");
  expect(main).toMatch(/state\.scale = \(INTRO_WORD\.zoomFrom \+[\s\S]*?\* introScale;/);
  expect(main).toContain("const grownFrom = introMarkScale;");
  expect(main).toContain("state.scale = grownFrom + (dialScale - grownFrom) * eased;");
});

it("tightens the intro material for smaller art and eases back to the dial material", () => {
  const main = readFileSync(mainPath, "utf8");
  expect(main).toContain("spread: 0.008");
  expect(main).toContain("const introMarkSpread = targetSpread * Math.max(0.5, introMarkScale / 0.26);");
  expect(main).toContain("const introMarkGrain = targetGrain * INTRO_INK.grain;");
  expect(main).toContain("const introMarkGlow = targetGlow * 0.5;");
  expect(main).toContain("const introMarkWaver = targetWaver * INTRO_INK.waver;");
  expect(main).toContain("state.glowSpread = introMarkSpread + (targetSpread - introMarkSpread) * eased;");
  expect(main).toContain("state.grainAmount = introMarkGrain + (targetGrain - introMarkGrain) * eased;");
  expect(main).toContain("state.glowIntensity = introMarkGlow + (targetGlow - introMarkGlow) * eased;");
  expect(main).toContain("state.waverAmount = introMarkWaver + (targetWaver - introMarkWaver) * eased;");
});

it("keeps the word-to-icon handoff black without restoring an intermediate GPU state", () => {
  const main = readFileSync(mainPath, "utf8");
  expect(main).toContain("const restoreDialMaterial = (restoreBackground = true) => {");
  expect(main).toContain("if (restoreBackground) state.bgColor = dialBackgroundColor;");
  expect(main).toMatch(
    /if \(!skipped\) await introSleep\(INTRO_TIMING\.blackGap\);[\s\S]*?const revealMark = await markPromise;/,
  );
  expect(main).not.toContain("restoreDialMaterial(false)");
  expect(main).toMatch(
    /const targetGlow = Number\(dialGlowIntensity\);[\s\S]*?const targetFlicker = dialFlicker;/,
  );
  expect(main).toMatch(
    /finally \{[\s\S]*?restoreDialMaterial\(\);[\s\S]*?document\.body\.classList\.remove\("intro-playing"\);/,
  );
});

it("keeps the intro stage full-width on mobile", () => {
  const css = readFileSync(cssPath, "utf8");
  expect(css).toMatch(
    /@media \(max-width: 900px\) \{[\s\S]*?body\.intro-playing \.playground-layout \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
  expect(css).toMatch(
    /@media \(max-width: 900px\) \{[\s\S]*?body\.intro-playing \.control-rail \{ display: none; \}/,
  );
});

it("offers both image compositing treatments with a real raster sample", () => {
  const controls = readFileSync(controlsPath, "utf8");
  const main = readFileSync(mainPath, "utf8");
  const composite = readFileSync(compositePath, "utf8");
  expect(controls).toContain('{ value: "edge", label: "Burn around" }');
  expect(controls).toContain('{ value: "material", label: "Burn through" }');
  expect(main).toContain('state.maskMode = edgeActive ? "alpha" : "auto"');
  expect(main).toContain('currentSource?.supportsBurnAround === true');
  expect(main).toContain('!introRunning');
  expect(main).toContain("if (nextImage !== previousImage || treatmentChanged) currentPipeline.rebuild(state);");
  expect(main).toContain('maskMode: presentation.imageTreatment === "edge" ? "alpha" : "auto"');
  expect(composite).toContain("fn presentEdgeBurn");
  expect(composite).toContain("let innerBand = exp(-dIn / innerWidth) * inside;");
  expect(composite).toContain("let seamBand = exp(-abs(input.sd)");
  expect(composite).toContain("let outerBand = exp(-dOut");
  expect(composite).toContain("textureSampleLevel(sourceTex");
  expect(composite).toContain("let sourceWithBurn = mix(source.rgb, burnedSource, burnAmount);");
  expect(composite).toContain("fn blendFireIntoSource");
  expect(composite).toContain("g.edgeTreatment >= 0.5");
  expect(readFileSync(fileURLToPath(new URL("../src/playground-page.ts", import.meta.url)), "utf8"))
    .toContain('data-sample-source="/sample-leaf-photo.png" data-sample-name="Leaf photo" data-burn-around="true"');
});

it("does not duplicate the DOM subject under the solid WebGPU composite", () => {
  const main = readFileSync(mainPath, "utf8");
  expect(main).toContain('document.body.classList.contains("gpu-ready")');
  expect(main).toMatch(
    /const sourceVisibility = burnAroundActive\(\)\s*\? 0\s*: shaderBlend !== "normal"/,
  );
  expect(main).toContain('canvas.style.mixBlendMode = edgeActive ? "normal"');
  expect(main).toContain("currentPipeline.setBlendMode(SHADER_BLEND_UNIFORM[blend]);");
  expect(main).toContain('sourcePreview.style.opacity = gpuReady ? String(sourceVisibility) : "0";');
  expect(main).toMatch(/document\.body\.classList\.add\("gpu-ready"\);\s*syncSourceVisibility\(\);/);
});

it("keeps the selected heat direction stable between user interactions", () => {
  const main = readFileSync(mainPath, "utf8");
  expect(main).not.toContain("HEAT_ORBIT_DEGREES_PER_SECOND");
  expect(main).not.toContain("const orbited =");
});

it("plays the attract orbit only until the first direction interaction", () => {
  const main = readFileSync(mainPath, "utf8");
  // The attract loop exists so idle visitors see the hover effect…
  expect(main).toContain("ATTRACT_ORBIT_DPS");
  // …and every interaction path retires it permanently, so the chosen
  // direction stays stable afterwards (hover/steer, dial, angle buttons).
  expect(main).toContain("attractOrbitActive = false; // the user took the wheel");
  expect(main).toContain("attractOrbitActive = false; // explicit choice ends the attract loop");
  expect(main).toMatch(/values\.fire\.direction !== lastDialDirection\)\s*\{\s*attractOrbitActive = false;/);
});

it("applies the shader blend mode consistently to the live canvas and exports", () => {
  const controls = readFileSync(controlsPath, "utf8");
  const main = readFileSync(mainPath, "utf8");
  expect(controls).toContain('blend: {');
  expect(controls).toContain('{ value: "normal", label: "Normal" }');
  expect(controls).toContain('{ value: "screen", label: "Screen" }');
  expect(controls).toContain('{ value: "add", label: "Add" }');
  expect(controls).toContain('{ value: "multiply", label: "Multiply" }');
  expect(controls).toContain('{ value: "overlay", label: "Overlay" }');
  expect(main).toContain('canvas.style.mixBlendMode = edgeActive ? "normal"');
  expect(main).toContain('context.globalCompositeOperation = presentation.imageTreatment === "edge"');
  expect(main).toMatch(
    /presentation\.backgroundMode !== "color" \|\|\s*\(presentation\.imageTreatment !== "edge" &&\s*presentation\.shaderBlend !== "source-over"\)/,
  );
});

import { effect, frame, sampler, target, type Effect, type Gpu, type Target } from "vgpu";
import {
  computeJumps,
  computeRect,
  DEFAULT_SHAPE_ASPECT,
  emberUniform,
  heatDirection,
  maskModeValue,
  maskTexel,
  SDF_RES,
} from "../shared/params.mjs";
import compositeWgsl from "./shaders/composite.wgsl";
import jfaInitWgsl from "./shaders/jfa-init.wgsl";
import jfaStepWgsl from "./shaders/jfa-step.wgsl";
import maskDefaultWgsl from "./shaders/mask-default.wgsl";
import maskImageWgsl from "./shaders/mask-image.wgsl";
import sdfFinalizeWgsl from "./shaders/sdf-finalize.wgsl";

// Seeds hold absolute pixel coordinates — they need f32 (f16 drifts past 2048
// and an off-by-a-texel seed is an off-by-a-texel SDF). The finalized SDF is
// r16float so the composite can sample it bilinearly.
const SEED_FORMAT: GPUTextureFormat = "rgba32float";
const SDF_FORMAT: GPUTextureFormat = "r16float";

type ParamState = Record<string, number | string | boolean>;
type LogoTexture = ReturnType<Gpu["device"]["createTexture"]>;

export class EmberPipeline {
  readonly composite: Effect;

  private readonly maskTarget: Target;
  private readonly seeds: [Target, Target];
  private readonly sdfTarget: Target;
  private readonly maskImageFx: Effect;
  private readonly maskDefaultFx: Effect;
  private readonly jfaInitFx: Effect;
  private readonly jfaStepFx: Effect[];
  private readonly finalizeFx: Effect;
  private readonly fallbackSourceTexture: LogoTexture;
  private readonly jumps: number[];

  private logoTexture: LogoTexture | undefined;
  private logoAspect = DEFAULT_SHAPE_ASPECT;
  private logoHasAlpha = true;
  private logoAutoMaskMode: "alpha" | "dark" | "bright" = "alpha";
  private transitionEnabled = false;

  constructor(private readonly gpu: Gpu) {
    const size = [SDF_RES, SDF_RES] as const;
    this.maskTarget = target(gpu, { size, format: "rgba8unorm", label: "ember-mask" });
    this.seeds = [
      target(gpu, { size, format: SEED_FORMAT, label: "ember-jfa-a" }),
      target(gpu, { size, format: SEED_FORMAT, label: "ember-jfa-b" }),
    ];
    this.sdfTarget = target(gpu, { size, format: SDF_FORMAT, label: "ember-sdf" });

    const linearClamp = sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.fallbackSourceTexture = this.gpu.device.createTexture({
      label: "ember-source-fallback",
      size: [1, 1],
      format: "rgba8unorm",
      usage: ["texture_binding", "copy_dst"],
    });
    this.gpu.gpu.queue.writeTexture(
      { texture: this.fallbackSourceTexture.gpu as GPUTexture },
      new Uint8Array([0, 0, 0, 0]),
      { bytesPerRow: 4 },
      [1, 1],
    );

    this.maskImageFx = effect(gpu, maskImageWgsl, {
      label: "ember-mask-image",
      set: { samp: linearClamp },
    });
    this.maskDefaultFx = effect(gpu, maskDefaultWgsl, { label: "ember-mask-default" });
    this.jfaInitFx = effect(gpu, jfaInitWgsl, {
      label: "ember-jfa-init",
      set: { mask: this.maskTarget },
    });
    // Uniforms upload immediately, so every encoded pass needs its own effect —
    // one per jump, each with its jump set exactly once.
    this.jumps = computeJumps(SDF_RES);
    this.jfaStepFx = this.jumps.map((jump, i) =>
      effect(gpu, jfaStepWgsl, { label: `ember-jfa-step-${i}`, set: { sp: { jump } } }),
    );
    this.finalizeFx = effect(gpu, sdfFinalizeWgsl, {
      label: "ember-sdf-finalize",
      set: { mask: this.maskTarget },
    });

    this.composite = effect(gpu, compositeWgsl, {
      label: "ember-composite",
      set: {
        sdf: this.sdfTarget,
        samp: linearClamp,
        maskTex: this.maskTarget,
        sourceTex: this.fallbackSourceTexture,
        g: {
          energy: 1,
          revealMode: 0,
          compositeBackground: 0,
          fullHeat: 0,
          edgeTreatment: 0,
          blendMode: 0,
        },
      },
    });
  }

  get hasImage(): boolean {
    return this.logoTexture !== undefined;
  }

  // Upload a rasterized logo (any canvas-drawable source) and remember whether
  // its alpha channel is meaningful, for the "auto" mask mode.
  setImage(
    source: HTMLCanvasElement,
    hasAlpha: boolean,
    autoMaskMode: "alpha" | "dark" | "bright" = hasAlpha ? "alpha" : "dark",
  ): void {
    const tex = this.gpu.device.createTexture({
      label: "ember-logo",
      size: [source.width, source.height],
      format: "rgba8unorm",
      usage: ["texture_binding", "copy_dst", "render_attachment"],
    });
    this.gpu.gpu.queue.copyExternalImageToTexture(
      { source },
      { texture: tex.gpu as GPUTexture },
      [source.width, source.height],
    );
    this.maskImageFx.set({ src: tex });
    this.composite.set({ sourceTex: tex });
    this.logoTexture?.destroy();
    this.logoTexture = tex;
    this.logoAspect = source.width / source.height;
    this.logoHasAlpha = hasAlpha;
    this.logoAutoMaskMode = autoMaskMode;
  }

  clearImage(): void {
    this.logoTexture?.destroy();
    this.logoTexture = undefined;
    this.composite.set({ sourceTex: this.fallbackSourceTexture });
    this.logoAspect = DEFAULT_SHAPE_ASPECT;
    this.logoHasAlpha = true;
    this.logoAutoMaskMode = "alpha";
  }

  // Regenerate mask -> jump flood -> SDF (runs only when the shape changes),
  // and push the shape-dependent globals into the composite.
  rebuild(state: ParamState): void {
    const rect = computeRect(this.logoAspect, state);
    const maskFx = this.logoTexture ? this.maskImageFx : this.maskDefaultFx;
    maskFx.set({
      mp: {
        rect,
        texel: maskTexel(rect),
        threshold: state.threshold,
        softness: state.softness,
        invert: state.invert ? 1 : 0,
        mode: maskModeValue(
          state.maskMode === "auto" ? this.logoAutoMaskMode : state.maskMode,
          this.logoHasAlpha,
        ),
      },
    });

    const passes: { target: Target; fx: Effect }[] = [
      { target: this.maskTarget, fx: maskFx },
      { target: this.seeds[0], fx: this.jfaInitFx },
    ];
    let read = this.seeds[0];
    let write = this.seeds[1];
    for (const [i] of this.jumps.entries()) {
      const fx = this.jfaStepFx[i];
      fx.set({ seeds: read });
      passes.push({ target: write, fx });
      [read, write] = [write, read];
    }
    this.finalizeFx.set({ seeds: read });
    passes.push({ target: this.sdfTarget, fx: this.finalizeFx });

    frame(this.gpu, (f) => {
      for (const pass of passes) {
        f.pass({ target: pass.target, clear: [0, 0, 0, 0] }, (p) => p.draw(pass.fx));
      }
    });

    this.composite.set({ g: { rect } });
  }

  applyEmberParams(state: ParamState): void {
    const fullHeat = state.heatAngle === "full";
    this.composite.set({
      params: emberUniform(state),
      g: {
        heatDir: heatDirection(fullHeat ? 0 : state.heatAngle ?? 0),
        fullHeat: fullHeat ? 1 : 0,
        revealMode: this.transitionEnabled ? 1 : 0,
      },
    });
  }

  setTransitionEnabled(enabled: boolean): void {
    this.transitionEnabled = enabled;
    this.composite.set({ g: { revealMode: enabled ? 1 : 0 } });
  }

  setCompositedBackground(enabled: boolean): void {
    this.composite.set({ g: { compositeBackground: enabled ? 1 : 0 } });
  }

  setEdgeTreatment(enabled: boolean): void {
    this.composite.set({ g: { edgeTreatment: enabled ? 1 : 0 } });
  }

  setBlendMode(mode: number): void {
    this.composite.set({ g: { blendMode: mode } });
  }

  setEffectProgress(progress: number): void {
    this.composite.set({ g: { energy: Math.max(0, Math.min(1, progress)) } });
  }
}

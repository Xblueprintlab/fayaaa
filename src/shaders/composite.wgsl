// Fullscreen composite: sample the SDF, hand everything to the ember library.
import { EmberInput, EmberParams, emberComposite } from "./fayaaa.wgsl";

struct Globals {
  rect: vec4f,     // logo box in sdf uv
  size: vec2f,     // canvas size in physical pixels
  time: f32,
  aspect: f32,     // canvas width / height
  heatDir: vec2f,  // unit vector toward the hot side, uv space (y down)
  energy: f32,     // continuous source -> Fayaaa progress, 0 = source, 1 = result
  revealMode: f32, // 1 enables the source -> Fire presentation; 0 returns canonical Fire
  compositeBackground: f32, // 1 keeps the shader transparent outside the fire
  fullHeat: f32,   // 1 distributes heat around the complete silhouette
  edgeTreatment: f32, // 1 samples the source core and burns only its boundary
  blendMode: f32, // 0 normal, 1 screen, 2 add, 3 multiply, 4 overlay
}
@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var<uniform> params: EmberParams;
@group(0) @binding(2) var sdf: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var maskTex: texture_2d<f32>;
@group(0) @binding(5) var sourceTex: texture_2d<f32>;

fn presentResult(base: vec3f, input: EmberInput, p: EmberParams) -> vec4f {
  if (g.compositeBackground < 0.5) {
    return vec4f(base, 1.0);
  }
  let aa = max(fwidth(input.sd), 1e-5)
    * mix(1.6, 0.3, clamp(p.edgeSharpness, 0.0, 1.0));
  let inside = smoothstep(aa, -aa, input.sd);
  let outerGlow = exp(-max(input.sd, 0.0) / max(p.glowSpread * 1.8, 1e-4));
  let insideAmount = clamp(p.innerGlow * 0.5, 0.0, 1.0);
  let alpha = clamp(max(
    inside * insideAmount,
    outerGlow * (1.0 - inside) * min(p.glowIntensity * 0.22, 0.82),
  ), 0.0, 1.0);
  return vec4f(base * alpha, alpha);
}

fn blendFireIntoSource(source: vec3f, fire: vec3f, mode: f32) -> vec3f {
  if (mode < 0.5) { return fire; }
  if (mode < 1.5) { return 1.0 - (1.0 - source) * (1.0 - fire); }
  if (mode < 2.5) { return min(source + fire, vec3f(1.0)); }
  if (mode < 3.5) { return source * fire; }
  let dark = 2.0 * source * fire;
  let light = 1.0 - 2.0 * (1.0 - source) * (1.0 - fire);
  return select(dark, light, source >= vec3f(0.5));
}

fn presentEdgeBurn(base: vec3f, input: EmberInput, p: EmberParams) -> vec4f {
  // Burn around is one WebGPU composition, not a transparent shader over a
  // duplicate DOM image. Sample the actual source, preserve it in the core,
  // and transition those pixels into the approved Fire material at the edge.
  let aa = max(fwidth(input.sd), 1e-5)
    * mix(1.6, 0.3, clamp(p.edgeSharpness, 0.0, 1.0));
  let inside = smoothstep(aa, -aa, input.sd);
  let dIn = max(-input.sd, 0.0);
  let dOut = max(input.sd, 0.0);
  let spread = max(p.glowSpread, 1e-4);

  let innerWidth = max(spread * (3.5 + p.innerGlow * 1.5), 0.012);
  let innerBand = exp(-dIn / innerWidth) * inside;
  let seamBand = exp(-abs(input.sd) / max(spread * 0.24, 0.0012));
  let outerBand = exp(-dOut / max(spread * 1.9, 0.004)) * (1.0 - inside);

  // hnorm already carries the selected direction and Full behavior. Reusing
  // it keeps the burn attached to the genuinely hot side of the approved Fire
  // material instead of drawing a uniform outline around the image.
  let hotSide = smoothstep(0.5, 0.9, input.hnorm);
  let luminance = dot(base, vec3f(0.2126, 0.7152, 0.0722));
  let emission = smoothstep(0.035, 0.42, luminance);

  let charAlpha = innerBand * hotSide * mix(0.34, 0.76, emission);
  let seamAlpha = seamBand * hotSide * smoothstep(0.025, 0.24, luminance);
  let glowAlpha = outerBand * hotSide * emission
    * min(1.0, 0.24 + p.glowIntensity * 0.28);

  let side = max(input.aspect, 1.0);
  let uvSdf = vec2f(0.5) + ((input.uv - vec2f(0.5)) * vec2f(input.aspect, 1.0)) / side;
  let sourceUv = (uvSdf - g.rect.xy) / max(g.rect.zw - g.rect.xy, vec2f(1e-5));
  let source = textureSampleLevel(sourceTex, samp, clamp(sourceUv, vec2f(0.0), vec2f(1.0)), 0.0);

  let burnAmount = clamp(max(charAlpha, seamAlpha), 0.0, 1.0);
  let burnedSource = blendFireIntoSource(source.rgb, base, g.blendMode);
  let sourceWithBurn = mix(source.rgb, burnedSource, burnAmount);
  let result = mix(base, sourceWithBurn, inside);
  if (g.compositeBackground < 0.5) {
    return vec4f(result, 1.0);
  }
  let alpha = clamp(max(inside * source.a, glowAlpha), 0.0, 1.0);
  return vec4f(result * alpha, alpha);
}

fn addPlaygroundDots(base: vec3f, input: EmberInput) -> vec3f {
  // The dot field belongs to the solid canvas only. It fades away around the
  // subject so the material stays dominant, and automatically flips contrast
  // for light versus dark user-selected backgrounds.
  // A denser field reads as a working grid instead of isolated specks.
  let grid = input.uv * vec2f(input.aspect, 1.0) * 44.0;
  let dotDistance = length(fract(grid) - vec2f(0.5));
  let dotAa = max(fwidth(dotDistance), 0.006);
  let dotMask = 1.0 - smoothstep(0.064 - dotAa, 0.064 + dotAa, dotDistance);

  let centered = (input.uv - vec2f(0.5)) * vec2f(input.aspect, 1.0);
  let edgeFade = smoothstep(0.14, 0.68, length(centered));
  let clearOfSubject = smoothstep(0.025, 0.09, input.sd);
  let luminance = dot(base, vec3f(0.2126, 0.7152, 0.0722));
  let dotColor = select(vec3f(1.0), vec3f(0.0), luminance > 0.46);
  let strength = mix(0.105, 0.072, smoothstep(0.35, 0.7, luminance));
  return mix(base, dotColor, dotMask * edgeFade * clearOfSubject * strength);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // Map the square SDF texture so it covers the viewport (side = screen heights).
  let side = max(g.aspect, 1.0);
  let uvSdf = vec2f(0.5) + ((uv - vec2f(0.5)) * vec2f(g.aspect, 1.0)) / side;

  let res = vec2f(textureDimensions(sdf)).x;
  // The field is an anti-aliased distance transform (sub-texel edge seeds), so
  // one bilinear sample reconstructs a smooth edge at any magnification.
  let sdPx = textureSampleLevel(sdf, samp, uvSdf, 0.0).r;
  let m = textureSampleLevel(maskTex, samp, uvSdf, 0.0);

  // Edge orientation from smooth bilinear SDF taps (dpdx/dpdy would bead thin
  // rims: derivatives are constant per 2x2 quad).
  let e = 1.5 / res;
  let gx = textureSampleLevel(sdf, samp, uvSdf + vec2f(e, 0.0), 0.0).r
         - textureSampleLevel(sdf, samp, uvSdf - vec2f(e, 0.0), 0.0).r;
  let gy = textureSampleLevel(sdf, samp, uvSdf + vec2f(0.0, e), 0.0).r
         - textureSampleLevel(sdf, samp, uvSdf - vec2f(0.0, e), 0.0).r;

  var input: EmberInput;
  input.sd = sdPx / res * side;
  input.edgeUp = clamp(-gy / max(length(vec2f(gx, gy)), 1e-5), 0.0, 1.0);
  input.uv = uv;
  input.ynorm = (uvSdf.y - g.rect.y) / max(g.rect.w - g.rect.y, 1e-4);

  // Heat coordinate: project onto the heat direction, normalized so the shape
  // box's extreme point in that direction is 1 (the box's support function).
  let center = 0.5 * (g.rect.xy + g.rect.zw);
  let half = 0.5 * (g.rect.zw - g.rect.xy);
  let extent = max(abs(g.heatDir.x) * half.x + abs(g.heatDir.y) * half.y, 1e-4);
  let directionalHeat = 0.5 + dot(uvSdf - center, g.heatDir) / (2.0 * extent);
  // Full keeps the exact Fire material and wraps its heat coordinate around
  // the complete silhouette. Every edge is hot while the centre retains a
  // lower ember floor, so this is still Fayaaa rather than a separate look.
  let edgeHeat = exp(-abs(input.sd) / max(params.glowSpread * 4.0, 0.012));
  let allEdgesHeat = mix(0.58, 0.86, edgeHeat);
  input.hnorm = select(directionalHeat, allEdgesHeat, g.fullHeat >= 0.5);
  input.aspect = g.aspect;
  input.time = g.time;
  input.sizePx = g.size;
  input.field = m.g;

  // Keep the canonical Fire render intact, then let one thermal front travel
  // through that same material. The canvas is premultiplied: progress can
  // reveal the shader over the continuing source layer without a DOM crossfade.
  var base = emberComposite(input, params);
  if (g.compositeBackground < 0.5) {
    base = addPlaygroundDots(base, input);
  }
  if (g.revealMode < 0.5) {
    return select(
      presentResult(base, input, params),
      presentEdgeBurn(base, input, params),
      g.edgeTreatment >= 0.5,
    );
  }
  let progress = clamp(g.energy, 0.0, 1.0);
  if (progress >= 0.999) {
    return select(
      presentResult(base, input, params),
      presentEdgeBurn(base, input, params),
      g.edgeTreatment >= 0.5,
    );
  }
  if (progress <= 0.001) {
    return vec4f(0.0);
  }

  let eased = progress * progress * (3.0 - 2.0 * progress);
  let front = mix(-0.18, 1.18, eased);
  let bandDelta = (input.hnorm - front) / 0.09;
  let band = exp(-0.5 * bandDelta * bandDelta);
  let trail = 1.0 - smoothstep(front - 0.13, front + 0.025, input.hnorm);

  // A low uniform ember makes the complete mark readable before interaction.
  // The band briefly reaches white heat and leaves a warm, coherent result
  // behind it. Every layer uses the same SDF, so the approved sharp edge is
  // preserved and reversal simply retargets the current progress.
  let aa = max(fwidth(input.sd), 1e-5)
    * mix(1.6, 0.3, clamp(params.edgeSharpness, 0.0, 1.0));
  let inside = smoothstep(aa, -aa, input.sd);
  let nearEdge = exp(-max(input.sd, 0.0) / max(params.glowSpread * 1.5, 1e-4));
  let material = max(inside, nearEdge * 0.16);

  // Heat belongs to the travelling seam, not to a second final look. Its
  // envelope is exactly zero at both endpoints, so settled output is base.
  var frontInput = input;
  frontInput.hnorm = max(input.hnorm, 0.78 + 0.16 * trail + 0.34 * band);
  let frontFire = emberComposite(frontInput, params);
  let settleEnvelope = 4.0 * progress * (1.0 - progress);
  let transientMix = material * clamp(0.18 * trail + 0.78 * band, 0.0, 0.92) * settleEnvelope;
  let result = mix(base, frontFire, transientMix);

  let axis = clamp(input.hnorm, 0.0, 1.0);
  let coverage = 1.0 - smoothstep(front - 0.055, front + 0.045, axis);
  let seam = band * material * (1.0 - progress) * 0.75;
  // The travelling reveal belongs to the supplied shape, never to a full
  // viewport half-plane. The background fades in uniformly only near the
  // settled endpoint (and is already color-matched by the stage), so the eye
  // reads an igniting edge rather than a page-transition band.
  let shapeAlpha = max(coverage * material, seam);
  let backgroundAlpha = smoothstep(0.82, 0.998, progress);
  let resultAlpha = select(
    presentResult(result, input, params).a,
    presentEdgeBurn(result, input, params).a,
    g.edgeTreatment >= 0.5,
  );
  let alpha = select(
    clamp(max(shapeAlpha, backgroundAlpha), 0.0, 1.0),
    clamp(max(shapeAlpha, resultAlpha * progress), 0.0, 1.0),
    g.compositeBackground >= 0.5,
  );
  return vec4f(result * alpha, alpha);
}

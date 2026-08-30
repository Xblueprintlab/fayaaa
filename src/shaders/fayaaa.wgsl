// Ember — render any shape's signed distance field as hot metal in a dark room:
// airbrushed interior shading, a crisp rim light, heat glow bleeding off the
// bottom, film grain, and a vignette. Everything is a function of the signed
// distance `sd` (negative inside the shape), so every knob stays parametric and
// resolution-independent.
//
// Pure WGSL module: no @group/@binding here — the consumer's entry shader owns
// all bindings, declares `var<uniform> params: EmberParams`, fills EmberInput,
// and calls emberComposite. Individual ingredients are exported for custom
// grading pipelines.
//
// Units: `sd` and every width/spread parameter are in screen-height units
// (0.01 = 1% of the viewport height), so looks survive resizes and DPR changes.

import { pcg3d, unitFloat } from "@vgpu/wgsl-std/hash";
import { simplex2d } from "@vgpu/wgsl-std/noise/simplex";
import { applyExposure, linearToSrgb3, tonemapAces } from "@vgpu/wgsl-std/color";

export struct EmberParams {
  baseColor: vec3f,      topLight: f32,
  rimColor: vec3f,       rimWidth: f32,
  hotColor: vec3f,       rimIntensity: f32,
  coolColor: vec3f,      glowSpread: f32,
  bgColor: vec3f,        glowIntensity: f32,
  shadeFalloff: f32,     sheenWidth: f32,     sheenStrength: f32,  innerGlow: f32,
  heatFalloff: f32,      flickerAmount: f32,  flickerSpeed: f32,   waverAmount: f32,
  waverScale: f32,       grainAmount: f32,    grainScale: f32,     grainSpeed: f32,
  vignetteStrength: f32, vignetteRadius: f32, exposure: f32,       rimSoftness: f32,
  edgeSharpness: f32,    // 0 = dreamy-soft silhouette, 1 = razor (sub-pixel AA)
}

export struct EmberInput {
  sd: f32,        // signed distance to the shape edge, screen-height units, negative inside
  uv: vec2f,      // screen uv, (0,0) top-left
  ynorm: f32,     // 0 at the shape's top, 1 at its bottom, >1 below it (drives the top-light shading)
  hnorm: f32,     // heat coordinate: 0 at the shape's cold end, 1 at its hot end —
                  // project positions onto any direction to put the ember on any side
  aspect: f32,    // canvas width / height
  time: f32,      // seconds
  sizePx: vec2f,  // canvas size in physical pixels (for grain)
  field: f32,     // interior brightness field (1 = flat); lets a mask pass
                  // paint 3D-ish valleys and panel shading the SDF cannot know
  edgeUp: f32,    // how upward-facing the nearest edge is, 0..1 — compute it
                  // from a SMOOTH sd gradient (bilinear SDF taps or analytic),
                  // never from dpdx/dpdy, whose per-quad values bead thin rims
}

// Product-facing type names. Ember names remain available for compatibility
// with the original material study.
export alias FayaaaParams = EmberParams;
export alias FayaaaInput = EmberInput;

// Temperature ramp: 0 = dark, ramps through cool -> hot -> white heat.
export fn heatRamp(t: f32, hot: vec3f, cool: vec3f) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  let body = mix(cool, hot, smoothstep(0.0, 0.65, x));
  return mix(body, vec3f(1.0), smoothstep(0.72, 1.0, x)) * x;
}

// Heat by height: 1 at the shape's bottom (and everywhere below), decaying upward.
export fn shapeHeat(ynorm: f32, falloff: f32) -> f32 {
  return exp(-max(1.0 - ynorm, 0.0) * falloff);
}

// Thin line peaking exactly on the edge (sd = 0); softness adds a wider dim halo.
export fn rimLight(sd: f32, width: f32, softness: f32) -> f32 {
  let w = max(width, 1e-5);
  let core = exp(-0.5 * sd * sd / (w * w));
  let halo = exp(-abs(sd) / (w * (1.0 + softness * 10.0))) * softness * 0.5;
  return core + halo;
}

// Interior brightness: top-lit vertical gradient plus a sheen that catches the
// side edges (sd is negative inside; the sheen peaks as sd approaches 0).
export fn interiorShade(
  sd: f32, ynorm: f32,
  topLight: f32, shadeFalloff: f32, sheenWidth: f32, sheenStrength: f32,
) -> f32 {
  let y = clamp(ynorm, 0.0, 1.0);
  let vertical = topLight * pow(1.0 - y, shadeFalloff);
  let sheen = sheenStrength * exp(sd / max(sheenWidth, 1e-4)) * (0.3 + 0.7 * (1.0 - y));
  return vertical + sheen;
}

// Signed film grain in [-0.5, 0.5); feed integer-ish cell coordinates.
export fn filmGrain(cell: vec2f, frame: f32) -> f32 {
  let h = pcg3d(vec3u(u32(cell.x + 4096.0), u32(cell.y + 4096.0), u32(frame)));
  return unitFloat(h.x) - 0.5;
}

// Multiplicative darkening toward the corners; radius in aspect-corrected units.
export fn vignette(uv: vec2f, aspect: f32, radius: f32, strength: f32) -> f32 {
  let c = (uv - 0.5) * vec2f(aspect, 1.0) * 2.0;
  return 1.0 - strength * smoothstep(radius, radius + 1.2, length(c));
}

// The full look. Works in linear light, tonemaps (ACES) and encodes to sRGB,
// then grains in display space — return it straight to the canvas.
export fn emberComposite(input: EmberInput, p: EmberParams) -> vec3f {
  let heat = shapeHeat(input.hnorm, p.heatFalloff);
  let flicker = 1.0 + p.flickerAmount * simplex2d(vec2f(input.time * p.flickerSpeed, 7.31));
  let waver = p.waverAmount * simplex2d(vec2f(
    input.uv.x * p.waverScale,
    input.time * p.flickerSpeed * 0.6 + input.uv.y * p.waverScale * 0.35,
  ));
  let sdGlow = input.sd + waver * heat;

  // Silhouette anti-aliasing width: at full sharpness the transition is well
  // under a pixel; lower values trade crispness for a soft, airbrushed edge.
  let aa = max(fwidth(input.sd), 1e-5)
    * mix(1.6, 0.3, clamp(p.edgeSharpness, 0.0, 1.0));
  let inside = smoothstep(aa, -aa, input.sd);

  // Interior body over background, modulated by the mask's shading field.
  let shade = interiorShade(
    input.sd, input.ynorm,
    p.topLight, p.shadeFalloff, p.sheenWidth, p.sheenStrength,
  ) * input.field;
  var color = mix(p.bgColor, p.baseColor * shade, inside);

  // Ember glow: temperature decays with distance on two scales — a tight
  // near-white core hugging the edge and a wide orange-to-red bloom — so white
  // heat can never escape the silhouette, no matter how high the intensity.
  let dOut = max(sdGlow, 0.0);
  let tOut = 0.45 * exp(-dOut / max(p.glowSpread * 0.25, 1e-4))
           + 0.55 * exp(-dOut / max(p.glowSpread, 1e-4));
  // Inside, the body itself is emissive where it's hot — a height-driven fill
  // (so solid shapes glow from within, not just at the silhouette) plus an
  // extra boost near the edge where the metal is thinnest.
  let dIn = max(-sdGlow, 0.0);
  let tIn = p.innerGlow * (0.55 + 0.45 * exp(-dIn / max(p.glowSpread * 1.6, 1e-4)));
  let t = heat * flicker * mix(tOut, tIn, inside);
  color += heatRamp(t * 1.15, p.hotColor, p.coolColor) * p.glowIntensity * max(t, 0.0);

  // Rim light, brightest on upward-facing edges, faint on the sides — like
  // light from above. The width is floored at ~a physical pixel so the line
  // can't alias away.
  let rimW = max(p.rimWidth, 0.8 / max(input.sizePx.y, 1.0));
  let rim = rimLight(input.sd, rimW, p.rimSoftness) * p.rimIntensity;
  color += p.rimColor * rim * (0.2 + 0.8 * pow(clamp(input.edgeUp, 0.0, 1.0), 1.5));

  color *= vignette(input.uv, input.aspect, p.vignetteRadius, p.vignetteStrength);
  var mapped = linearToSrgb3(tonemapAces(applyExposure(color, p.exposure)));

  // Film grain, strongest in the midtones and nearly absent in highlights —
  // keeps thin bright rims clean while the background stays textured.
  let cell = input.uv * input.sizePx / max(p.grainScale, 0.5);
  let grain = filmGrain(cell, floor(input.time * p.grainSpeed * 60.0));
  let lum = dot(mapped, vec3f(0.2126, 0.7152, 0.0722));
  let grainWeight = (0.3 + 0.7 * 4.0 * lum * (1.0 - lum))
    * (1.0 - 0.8 * smoothstep(0.75, 1.0, lum));
  mapped += grain * p.grainAmount * grainWeight;
  return mapped;
}

// Product-facing name. Keep emberComposite as a compatibility alias while the
// package moves from the original material study to Fayaaa.
export fn fayaaaComposite(input: EmberInput, p: EmberParams) -> vec3f {
  return emberComposite(input, p);
}

// Coverage mask from an uploaded logo texture, fitted into `rect` of SDF space.
struct MaskParams {
  rect: vec4f,    // x0, y0, x1, y1 of the logo box in sdf uv
  texel: vec2f,   // one mask texel in logo-uv units (for the smoothing kernel)
  threshold: f32, // coverage cutoff
  softness: f32,  // ramp half-width around the cutoff
  invert: f32,    // 0 or 1
  mode: f32,      // 0 = alpha, 1 = dark pixels, 2 = bright pixels
}
@group(0) @binding(0) var<uniform> mp: MaskParams;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

fn maskValue(iuv: vec2f) -> f32 {
  let s = textureSampleLevel(src, samp, clamp(iuv, vec2f(0.0), vec2f(1.0)), 0.0);
  let lum = dot(s.rgb, vec3f(0.2126, 0.7152, 0.0722));
  if (mp.mode > 1.5) {
    return lum * s.a;
  }
  if (mp.mode > 0.5) {
    return (1.0 - lum) * s.a;
  }
  return s.a;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ext = max(mp.rect.zw - mp.rect.xy, vec2f(1e-5));
  let iuv = (uv - mp.rect.xy) / ext;

  // 3x3 tent filter spaced one mask texel apart: it absorbs minification
  // aliasing AND widens the coverage ramp to ~2.5 texels, which the distance
  // transform needs for accurate central-difference gradients. The threshold
  // isoline (the visible edge) is unmoved by the symmetric blur.
  var v = 0.0;
  var wsum = 0.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let w = f32((2 - abs(i)) * (2 - abs(j)));
      v += w * maskValue(iuv + vec2f(f32(i), f32(j)) * mp.texel);
      wsum += w;
    }
  }
  v /= wsum;

  // LINEAR coverage ramp. Linearity matters: the distance transform estimates
  // edge points as (0.5 - cov) / |grad cov|, which is exact for a linear ramp —
  // a smoothstep's S-curve would bias the estimate and scallop the edge.
  let soft = max(mp.softness, 0.4);
  var cov = clamp((v - mp.threshold) / (2.0 * soft) + 0.5, 0.0, 1.0);
  cov = cov
    * step(0.0, iuv.x) * step(iuv.x, 1.0)
    * step(0.0, iuv.y) * step(iuv.y, 1.0);
  cov = mix(cov, 1.0 - cov, mp.invert);
  // g is the interior shading field: flat for uploaded logos.
  return vec4f(cov, 1.0, 0.0, 1.0);
}

// Default shape when nothing is uploaded: a folded sheet after the reference
// artwork — two curved vertical panels meeting at a shaded seam, a curl tab
// peeking at top center, and a tongue dipping below the bottom edge.
//
// Output: r = coverage, g = interior shading field (cylindrical panel light,
// dark valley at the seam). Coverage only needs a correct inside/outside — the
// jump flood computes true distances afterwards.
struct MaskParams {
  rect: vec4f,
  texel: vec2f, // unused here; keeps the struct identical to mask-image
  threshold: f32,
  softness: f32,
  invert: f32,
  mode: f32,
}
@group(0) @binding(0) var<uniform> mp: MaskParams;

fn sdRoundBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// Axis box with caller-curved top/bottom edges (chebyshev-ish distance).
fn panelSd(s: vec2f, x0: f32, x1: f32, yTop: f32, yBot: f32) -> f32 {
  return max(max(x0 - s.x, s.x - x1), max(yTop - s.y, s.y - yBot));
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ext = max(mp.rect.zw - mp.rect.xy, vec2f(1e-5));
  let s0 = (uv - mp.rect.xy) / ext;

  // Gentle global lean so the sheets read hand-made, not CAD.
  var s = s0;
  s.x += 0.010 * sin(s0.y * 2.6 + 0.6);

  // Left panel: shorter, top sloping down toward the seam, bottom dipping near it.
  let txL = clamp((s.x - 0.235) / 0.265, 0.0, 1.0);
  let topL = mix(0.095, 0.140, txL) + 0.014 * sin(txL * 3.14159);
  let botL = 0.915 + 0.035 * smoothstep(0.6, 1.0, txL);
  let dL = panelSd(s, 0.235, 0.5, topL, botL);

  // Right panel: taller, nearly straight top just below the curl.
  let txR = clamp((s.x - 0.5) / 0.275, 0.0, 1.0);
  let topR = mix(0.055, 0.038, txR) - 0.008 * sin(txR * 3.14159);
  let botR = mix(0.945, 0.930, txR) + 0.012 * sin(txR * 2.8);
  let dR = panelSd(s, 0.5, 0.775, topR, botR);

  // Curl tab: a fin on the right panel's corner — vertical right edge, top
  // sweeping concavely down-left to a point at the seam.
  let txT = clamp((s.x - 0.468) / 0.077, 0.0, 1.0);
  let topT = 0.03 + 0.12 * pow(1.0 - txT, 1.6);
  let dT = panelSd(s, 0.468, 0.545, topT, 0.25);

  // Tongue dipping below the bottom edge at the seam.
  let dG = sdRoundBox(s - vec2f(0.492, 0.952), vec2f(0.020, 0.055), 0.018);

  let d = min(min(dL, dR), min(dT, dG));
  let aa = 0.004;
  var cov = smoothstep(aa, -aa, d);
  cov = mix(cov, 1.0 - cov, mp.invert);

  // Interior shading field: each panel is a vertical cylinder — dark valley at
  // the seam, brightening toward the outer edge, easing off right at the rim.
  var field = 1.0;
  if (dL <= dR && dL <= dT && dL <= dG) {
    let fL = 1.0 - txL;
    field = (0.16 + 0.84 * pow(fL, 0.75)) * (1.0 - 0.18 * smoothstep(0.85, 1.0, fL));
  } else if (dR <= dT && dR <= dG) {
    field = (0.14 + 0.86 * pow(txR, 0.8)) * (1.0 - 0.22 * smoothstep(0.8, 1.0, txR));
  } else if (dT <= dG) {
    field = 0.85; // the curl catches the light
  } else {
    field = 0.45; // the tongue sits in half shadow
  }

  return vec4f(cov, field, 0.0, 1.0);
}

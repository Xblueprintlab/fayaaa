// Anti-aliased jump flooding: build a signed distance field from an
// anti-aliased coverage mask with sub-texel accuracy.
//
// Seeds are EDGE POINTS estimated from coverage and its gradient (after
// Gustavson & Strand, "Anti-aliased Euclidean distance transform"), not pixel
// centers with a binary inside test — binary seeding quantizes the edge to the
// texel grid and every downstream rim or glow inherits the staircase. With
// edge-point seeds, neighboring texels straddling the edge store sub-texel
// accurate +/- distances, and bilinear sampling reconstructs a smooth zero
// crossing at any magnification.
//
// The mask MUST be anti-aliased (at least a one-texel coverage ramp on every
// edge) — fractional pixels are where seeds come from.
//
// Pipeline (consumer's entry shaders; see the playground for a full example):
//   1. init pass:  central-difference the mask, jfaEdgeSeed(cov, grad, center)
//   2. N ping-pong passes with jump = size/2 ... 1 (one effect per jump —
//      uniforms upload immediately, so passes in one frame can't share one):
//      fold jfaPick over the 3x3 neighborhood `jump` texels away
//   3. finalize:   jfaSign(cov) * jfaEdgeDistance(seed, center, far) -> r16float

export fn jfaNoSeed() -> vec4f {
  return vec4f(0.0, 0.0, 0.0, 0.0);
}

export fn jfaHasSeed(seed: vec4f) -> bool {
  return seed.w > 0.5;
}

// cov: this texel's coverage in [0, 1]; grad: central-difference coverage
// gradient per texel; position: this texel's center in pixels. Returns the
// estimated closest point on the 0.5-coverage isoline, or no seed for texels
// outside the anti-aliasing band.
export fn jfaEdgeSeed(cov: f32, grad: vec2f, position: vec2f) -> vec4f {
  let g = length(grad);
  if (cov < 0.004 || cov > 0.996 || g < 1e-3) {
    return jfaNoSeed();
  }
  let along = clamp((0.5 - cov) / g, -1.0, 1.0);
  return vec4f(position + grad / g * along, 0.0, 1.0);
}

export fn jfaPick(current: vec4f, candidate: vec4f, position: vec2f) -> vec4f {
  if (!jfaHasSeed(candidate)) {
    return current;
  }
  if (!jfaHasSeed(current)) {
    return candidate;
  }
  let keep = distance(candidate.xy, position) < distance(current.xy, position);
  return select(current, candidate, keep);
}

// Unsigned distance to the nearest edge point; `far` caps texels no seed
// reached (use something larger than the texture diagonal).
export fn jfaEdgeDistance(seed: vec4f, position: vec2f, far: f32) -> f32 {
  if (!jfaHasSeed(seed)) {
    return far;
  }
  return distance(seed.xy, position);
}

// Sign convention for the finished field: negative inside the shape.
export fn jfaSign(cov: f32) -> f32 {
  return select(1.0, -1.0, cov >= 0.5);
}

// Test-only entry: exercises the anti-aliased JFA helpers on known values and
// encodes each check as a 0/1 channel — the test asserts every pixel is white.
import {
  jfaEdgeDistance,
  jfaEdgeSeed,
  jfaHasSeed,
  jfaPick,
  jfaSign,
} from "../../src/shaders/jfa.wgsl";

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let pos = vec2f(10.0, 10.0);

  // cov = 0.5 seeds exactly at the pixel center; cov = 0.75 with a gradient of
  // 0.5/texel in +x pushes the edge estimate half a texel toward -x.
  let onEdge = jfaEdgeSeed(0.5, vec2f(0.5, 0.0), pos);
  let inside = jfaEdgeSeed(0.75, vec2f(0.5, 0.0), pos);
  let solid = jfaEdgeSeed(1.0, vec2f(0.0, 0.0), pos);
  let seedOk = f32(
    jfaHasSeed(onEdge) && all(onEdge.xy == pos) &&
    jfaHasSeed(inside) && all(inside.xy == vec2f(9.5, 10.0)) &&
    !jfaHasSeed(solid)
  );

  // Nearer candidate wins; distance to the winner is exact.
  let far = jfaEdgeSeed(0.5, vec2f(0.5, 0.0), vec2f(3.0, 4.0));
  let near = jfaEdgeSeed(0.5, vec2f(0.5, 0.0), vec2f(11.0, 10.0));
  let best = jfaPick(far, near, pos);
  let pickOk = f32(all(best.xy == vec2f(11.0, 10.0)));
  let distOk = f32(abs(jfaEdgeDistance(best, pos, 1000.0) - 1.0) < 0.001);

  // No seed falls back to `far`; sign is negative inside.
  let farOk = f32(jfaEdgeDistance(solid, pos, 1000.0) == 1000.0);
  let signOk = f32(jfaSign(0.75) == -1.0 && jfaSign(0.2) == 1.0);

  return vec4f(seedOk * signOk, pickOk * farOk, distOk, 1.0);
}

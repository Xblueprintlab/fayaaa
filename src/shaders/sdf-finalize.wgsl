// Converged edge seeds -> signed distance in pixels (r16float, filterable).
// Sign comes from the mask's coverage: negative inside the shape.
import { jfaEdgeDistance, jfaSign } from "./jfa.wgsl";

@group(0) @binding(0) var seeds: texture_2d<f32>;
@group(0) @binding(1) var mask: texture_2d<f32>;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(seeds));
  let pixel = clamp(floor(uv * size), vec2f(0.0), size - 1.0);
  let coord = vec2i(pixel);
  let seed = textureLoad(seeds, coord, 0);
  let cov = textureLoad(mask, coord, 0).r;
  let dist = jfaEdgeDistance(seed, pixel + 0.5, length(size) * 2.0);
  return vec4f(jfaSign(cov) * dist, 0.0, 0.0, 1.0);
}

// Seeds the jump flood with sub-texel edge points estimated from the mask's
// anti-aliased coverage and its central-difference gradient (rgba32float target).
import { jfaEdgeSeed } from "./jfa.wgsl";

@group(0) @binding(0) var mask: texture_2d<f32>;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(mask));
  let limit = size - vec2i(1);
  let coord = clamp(vec2i(floor(uv * vec2f(size))), vec2i(0), limit);

  let cov = textureLoad(mask, coord, 0).r;
  let cxm = textureLoad(mask, clamp(coord + vec2i(-1, 0), vec2i(0), limit), 0).r;
  let cxp = textureLoad(mask, clamp(coord + vec2i(1, 0), vec2i(0), limit), 0).r;
  let cym = textureLoad(mask, clamp(coord + vec2i(0, -1), vec2i(0), limit), 0).r;
  let cyp = textureLoad(mask, clamp(coord + vec2i(0, 1), vec2i(0), limit), 0).r;
  let grad = 0.5 * vec2f(cxp - cxm, cyp - cym);

  return jfaEdgeSeed(cov, grad, vec2f(coord) + 0.5);
}

// One jump-flood round: fold the 3x3 neighborhood `jump` texels away into the
// current best edge seed. Out-of-bounds neighbours are skipped, not clamped — a
// clamped read would duplicate the edge seed and bias distances at the border.
import { jfaPick } from "./jfa.wgsl";

struct StepParams { jump: f32 }
@group(0) @binding(0) var<uniform> sp: StepParams;
@group(0) @binding(1) var seeds: texture_2d<f32>;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(seeds));
  let pixel = clamp(floor(uv * size), vec2f(0.0), size - 1.0);
  let position = pixel + 0.5;
  let coord = vec2i(pixel);
  let limit = vec2i(size) - vec2i(1);
  let jump = i32(sp.jump);

  var best = textureLoad(seeds, coord, 0);
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let neighbour = coord + vec2i(x, y) * jump;
      if (neighbour.x < 0 || neighbour.y < 0 || neighbour.x > limit.x || neighbour.y > limit.y) {
        continue;
      }
      best = jfaPick(best, textureLoad(seeds, neighbour, 0), position);
    }
  }
  return best;
}

// Test-only entry: ember composite over an analytic circle SDF.
import { EmberInput, EmberParams, emberComposite } from "../../src/shaders/fayaaa.wgsl";

@group(0) @binding(0) var<uniform> params: EmberParams;

struct Frame { time: f32 }
@group(0) @binding(1) var<uniform> frameData: Frame;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var input: EmberInput;
  input.sd = length(uv - vec2f(0.5)) - 0.28;
  input.uv = uv;
  input.ynorm = (uv.y - 0.22) / 0.56;
  input.hnorm = input.ynorm; // heat from the bottom
  input.aspect = 1.0;
  input.time = frameData.time;
  input.sizePx = vec2f(64.0, 64.0);
  input.field = 1.0;
  input.edgeUp = clamp(-(uv.y - 0.5) / max(length(uv - vec2f(0.5)), 1e-4), 0.0, 1.0);
  return vec4f(emberComposite(input, params), 1.0);
}

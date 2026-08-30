export type EffectPhase = "source" | "igniting" | "result" | "cooling";

const SOURCE_EPSILON = 0.02;
const RESULT_EPSILON = 0.002;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number): number {
  const progress = clamp01(value);
  return progress * progress * (3 - 2 * progress);
}

/**
 * One interruption-safe source/result controller.
 *
 * The scalar is deliberately independent from shader time: pausing flicker must
 * never prevent a user-requested comparison or uploaded source from completing.
 */
export class EffectTransition {
  value: number;
  target: number;

  private holdRemaining = 0;

  constructor(value = 1) {
    this.value = clamp01(value);
    this.target = this.value;
  }

  get atSource(): boolean {
    return this.value <= SOURCE_EPSILON;
  }

  get settled(): boolean {
    return this.holdRemaining <= 0 && Math.abs(this.target - this.value) <= RESULT_EPSILON;
  }

  get phase(): EffectPhase {
    if (this.value <= SOURCE_EPSILON && this.target <= SOURCE_EPSILON) return "source";
    if (this.value >= 1 - RESULT_EPSILON && this.target >= 1 - RESULT_EPSILON) return "result";
    return this.target >= this.value ? "igniting" : "cooling";
  }

  setTarget(target: number): void {
    this.target = clamp01(target);
  }

  hold(seconds: number): void {
    this.holdRemaining = Math.max(this.holdRemaining, Math.max(0, seconds));
  }

  snap(value: number): void {
    this.value = clamp01(value);
    this.target = this.value;
    this.holdRemaining = 0;
  }

  restart(holdSeconds = 0): void {
    this.value = 0;
    this.target = 1;
    this.holdRemaining = Math.max(0, holdSeconds);
  }

  tick(deltaSeconds: number): number {
    let delta = Math.max(0, Math.min(0.1, deltaSeconds));
    if (delta <= 0) return this.value;
    if (this.holdRemaining > 0) {
      const held = Math.min(delta, this.holdRemaining);
      this.holdRemaining -= held;
      delta -= held;
      if (delta <= 0) return this.value;
    }

    const response = this.target > this.value ? 8.5 : 11.5;
    const blend = 1 - Math.exp(-delta * response);
    this.value += (this.target - this.value) * blend;

    if (Math.abs(this.target - this.value) <= RESULT_EPSILON) this.value = this.target;
    return this.value;
  }
}

/** A deterministic three-second source → Fire → source loop for previews and exports. */
export function effectLoopTarget(seconds: number): number {
  const phase = ((seconds % 3) + 3) % 3;
  if (phase < 0.18) return 0;
  if (phase < 0.9) return smoothstep01((phase - 0.18) / 0.72);
  if (phase < 1.85) return 1;
  if (phase < 2.55) return 1 - smoothstep01((phase - 1.85) / 0.7);
  return 0;
}

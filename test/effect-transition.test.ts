import { describe, expect, it } from "vitest";
import {
  EffectTransition,
  effectLoopTarget,
} from "../src/effect-transition";

describe("EffectTransition", () => {
  it("retargets from the current value without restarting", () => {
    const transition = new EffectTransition(0);
    transition.setTarget(1);
    for (let index = 0; index < 10; index += 1) transition.tick(1 / 60);
    const turningPoint = transition.value;

    expect(turningPoint).toBeGreaterThan(0);
    expect(turningPoint).toBeLessThan(1);

    transition.setTarget(0);
    transition.tick(1 / 60);
    expect(transition.value).toBeLessThan(turningPoint);
    expect(transition.value).toBeGreaterThan(0);
  });

  it("does not move or snap on a zero-delta frame", () => {
    const transition = new EffectTransition(0.42);
    transition.setTarget(1);
    expect(transition.tick(0)).toBe(0.42);
    expect(transition.value).toBe(0.42);
  });

  it("holds a new source before ignition and settles exactly", () => {
    const transition = new EffectTransition(1);
    transition.restart(0.12);
    transition.tick(0.1);
    expect(transition.value).toBe(0);

    for (let index = 0; index < 180; index += 1) transition.tick(1 / 60);
    expect(transition.value).toBe(1);
    expect(transition.phase).toBe("result");
    expect(transition.settled).toBe(true);
  });
});

describe("effectLoopTarget", () => {
  it("is a clean, deterministic three-second loop", () => {
    expect(effectLoopTarget(0)).toBe(0);
    expect(effectLoopTarget(0.9)).toBe(1);
    expect(effectLoopTarget(1.85)).toBe(1);
    expect(effectLoopTarget(2.55)).toBe(0);
    expect(effectLoopTarget(3)).toBe(0);
  });
});

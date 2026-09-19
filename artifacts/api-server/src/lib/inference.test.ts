import { describe, expect, it } from "vitest";
import { softmax2 } from "./inference";

describe("softmax2", () => {
  it("splits equal logits evenly", () => {
    const [normal, pneumonia] = softmax2(1, 1);
    expect(normal).toBeCloseTo(0.5, 10);
    expect(pneumonia).toBeCloseTo(0.5, 10);
  });

  it("sums to 1 regardless of input scale", () => {
    const [normal, pneumonia] = softmax2(3.7, -2.1);
    expect(normal + pneumonia).toBeCloseTo(1, 10);
  });

  it("favors the larger logit", () => {
    const [normal, pneumonia] = softmax2(5, 1);
    expect(normal).toBeGreaterThan(pneumonia);
  });

  it("is numerically stable for large logits that would overflow a naive exp", () => {
    const [normal, pneumonia] = softmax2(1000, 999);
    expect(Number.isFinite(normal)).toBe(true);
    expect(Number.isFinite(pneumonia)).toBe(true);
    expect(normal + pneumonia).toBeCloseTo(1, 10);
    expect(normal).toBeGreaterThan(pneumonia);
  });

  it("is symmetric under swapping the two logits", () => {
    const [a, b] = softmax2(2, 5);
    const [b2, a2] = softmax2(5, 2);
    expect(a).toBeCloseTo(a2, 10);
    expect(b).toBeCloseTo(b2, 10);
  });
});

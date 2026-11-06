import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { CountUp, easeOutCubic } from "./CountUp";

/** requestAnimationFrame driven by hand: each call to `frame(t)` runs what is waiting at time t. */
function frames() {
  let waiting: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    waiting.push(cb);
    return waiting.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  return (t: number) =>
    act(() => {
      const now = waiting;
      waiting = [];
      for (const cb of now) cb(t);
    });
}

afterEach(() => vi.restoreAllMocks());

describe("CountUp", () => {
  it("counts from 0 after its delay and ends exactly on the value", () => {
    const frame = frames();
    const { container } = render(<CountUp value={12} delay={500} />);
    const digits = container.querySelector('[aria-hidden="true"]')!;
    expect(digits).toHaveTextContent("0");
    frame(0); // the first frame sets the start: 500 ms on
    frame(400);
    expect(digits).toHaveTextContent("0");
    frame(500 + 550); // half way: an ease-out is well past half
    expect(Number(digits.textContent)).toBeGreaterThan(6);
    expect(Number(digits.textContent)).toBeLessThan(12);
    frame(500 + 1100);
    expect(digits).toHaveTextContent("12");
  });

  it("is read as its value from the start, the counting digits hidden", () => {
    frames();
    render(<CountUp value={7} />);
    expect(screen.getByText("7")).toHaveClass("sr-only");
  });

  it("eases out: quick at first, settling at 1", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("has no accessibility violations", async () => {
    frames();
    const { container } = render(<CountUp value={3} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

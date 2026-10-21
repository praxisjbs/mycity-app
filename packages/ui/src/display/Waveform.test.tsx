import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Waveform } from "./Waveform";

describe("Waveform", () => {
  it("draws a steady shape until the note is measured", () => {
    const one = render(<Waveform seconds={42} />);
    const two = render(<Waveform seconds={42} />);
    const heights = (r: ReturnType<typeof render>) => [...r.container.querySelectorAll<HTMLElement>("i")].map((i) => i.style.getPropertyValue("--bar-height"));
    expect(heights(one)).toHaveLength(32);
    expect(heights(one)).toEqual(heights(two));
    expect(new Set(heights(one)).size).toBeGreaterThan(5);
  });

  it("draws the measured loudness: a loud bar is tall, a silent one short", () => {
    const peaks = [...Array(24).fill(100), ...Array(24).fill(0)];
    const { container } = render(<Waveform seconds={4} peaks={peaks} />);
    const bars = [...container.querySelectorAll<HTMLElement>("i")].map((i) => i.style.getPropertyValue("--bar-height"));
    expect(bars).toHaveLength(32);
    expect(bars[0]).toBe("22px");
    expect(bars[31]).toBe("4px");
  });

  it("lights the bars up to where the audio has reached, with no timed fill", () => {
    const { container } = render(<Waveform seconds={42} peaks={[50, 60, 70]} progress={0.5} />);
    const bars = [...container.querySelectorAll<HTMLElement>("i")];
    expect(bars.filter((b) => b.className.includes("opacity-100"))).toHaveLength(16);
    expect(bars[15]!.className).toContain("opacity-100");
    expect(bars[16]!.className).toContain("opacity-55");
    expect(bars[0]!.style.getPropertyValue("--bar-delay")).toBe("0s");
  });

  it("without a position, spreads the fill over the note's length while it plays", () => {
    const { container } = render(<Waveform seconds={32} playing />);
    const bars = [...container.querySelectorAll<HTMLElement>("i")];
    expect(bars[0]!.style.getPropertyValue("--bar-delay")).toBe("0s");
    expect(bars[16]!.style.getPropertyValue("--bar-delay")).toBe("16s");
    expect(bars[0]!.style.getPropertyValue("--bar-time")).toBe("1s");
    expect(bars[0]!.className).toContain("opacity-100");
  });

  it("sits dim and still when it is not playing", () => {
    const { container } = render(<Waveform seconds={42} />);
    const first = container.querySelectorAll<HTMLElement>("i")[0]!;
    expect(first.style.getPropertyValue("--bar-delay")).toBe("0s");
    expect(first.style.getPropertyValue("--bar-time")).toBe("var(--dur)");
    expect(first.className).toContain("opacity-55");
  });

  it("is decorative: the length and the state are said in words beside it", () => {
    const { container } = render(<Waveform seconds={42} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Waveform seconds={42} playing />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

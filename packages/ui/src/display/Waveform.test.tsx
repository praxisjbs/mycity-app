import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Waveform } from "./Waveform";

describe("Waveform", () => {
  it("draws a steady shape from each bar's own index", () => {
    const one = render(<Waveform seconds={42} />);
    const two = render(<Waveform seconds={42} />);
    const heights = (r: ReturnType<typeof render>) => [...r.container.querySelectorAll<HTMLElement>("i")].map((i) => i.style.getPropertyValue("--bar-height"));
    expect(heights(one)).toHaveLength(26);
    expect(heights(one)).toEqual(heights(two));
    expect(new Set(heights(one)).size).toBeGreaterThan(5);
  });

  it("spreads the fill over the note's length while it plays", () => {
    const { container } = render(<Waveform seconds={26} playing />);
    const bars = [...container.querySelectorAll<HTMLElement>("i")];
    expect(bars[0]!.style.getPropertyValue("--bar-delay")).toBe("0s");
    expect(bars[13]!.style.getPropertyValue("--bar-delay")).toBe("13s");
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

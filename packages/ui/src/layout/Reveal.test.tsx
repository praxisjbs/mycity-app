import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Reveal, Stagger } from "./Reveal";

/** An IntersectionObserver the test drives: `show(el, true)` brings a block into view. */
function observers() {
  const watched = new Map<Element, IntersectionObserverCallback>();
  const options: IntersectionObserverInit[] = [];
  class FakeObserver {
    constructor(
      private cb: IntersectionObserverCallback,
      init: IntersectionObserverInit = {},
    ) {
      options.push(init);
    }
    observe(el: Element) {
      watched.set(el, this.cb);
    }
    unobserve(el: Element) {
      watched.delete(el);
    }
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  const show = (el: Element, isIntersecting: boolean) =>
    act(() => watched.get(el)?.([{ target: el, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
  return { show, options, watched };
}

afterEach(() => vi.unstubAllGlobals());

describe("Reveal", () => {
  it("shows its block as it comes into view and hides it again as it leaves, so it rises again", () => {
    const { show, options } = observers();
    render(
      <Reveal from="left" delay={120} lift="shadow">
        <p>Know Someone Great?</p>
      </Reveal>,
    );
    const block = screen.getByText("Know Someone Great?").parentElement!;
    expect(block).toHaveAttribute("data-reveal", "left");
    expect(block).toHaveAttribute("data-lift", "shadow");
    expect(block.style.getPropertyValue("--rd")).toBe("120ms");
    expect(block).not.toHaveAttribute("data-visible");
    show(block, true);
    expect(block).toHaveAttribute("data-visible");
    show(block, false);
    expect(block).not.toHaveAttribute("data-visible");
    expect(options.some((o) => o.threshold === 0.12)).toBe(true);
  });

  it("is the element it is asked to be, with its id", () => {
    observers();
    render(
      <ul>
        <Reveal as="li" id="hire">
          Apply
        </Reveal>
      </ul>,
    );
    expect(screen.getByRole("listitem")).toHaveAttribute("id", "hire");
  });

  it("simply shows where nothing can watch it", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Reveal>Four Steps, Every Time</Reveal>);
    expect(screen.getByText("Four Steps, Every Time")).toHaveAttribute("data-visible");
  });

  it("ties a scroll reveal to the scroll, with no observer and nothing hidden by script", () => {
    const { watched } = observers();
    render(<Reveal scroll as="section">Responsibilities</Reveal>);
    const part = screen.getByText("Responsibilities");
    expect(part).toHaveAttribute("data-reveal-scroll");
    expect(part).not.toHaveAttribute("data-reveal");
    expect(watched.has(part)).toBe(false);
  });

  it("staggers a row: each item a step later than the one before, as list items in a list", () => {
    observers();
    render(
      <Stagger as="ol" step={120} start={60} lift>
        <span>Apply</span>
        <span>Screening</span>
        <span>Assessment</span>
      </Stagger>,
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.style.getPropertyValue("--rd"))).toEqual(["60ms", "180ms", "300ms"]);
    expect(items.every((li) => li.hasAttribute("data-reveal") && li.hasAttribute("data-lift"))).toBe(true);
    expect(screen.getByRole("list").tagName).toBe("OL");
  });

  it("has no accessibility violations", async () => {
    observers();
    const { container } = render(
      <Reveal as="article">
        <h3>Discover Places</h3>
      </Reveal>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { SkylineHero } from "./SkylineHero";

describe("SkylineHero", () => {
  afterEach(() => vi.useRealTimers());

  it("is the page's heading, with its eyebrow over it and its line under it", () => {
    render(<SkylineHero eyebrow="Careers at MyCityApp" title="Work With Us" text="Building the app that knows every Nigerian city." />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Work With Us" });
    expect(h1).toHaveAttribute("data-ui", "page-title");
    expect(screen.getByText("Careers at MyCityApp")).toBeInTheDocument();
    const line = screen.getByText("Building the app that knows every Nigerian city.");
    expect(line).toHaveAttribute("data-ui", "page-subtitle");
    expect(line.className).toContain("phone:hidden");
  });

  it("lists the record's facts as chips, and puts what it is given under the heading", () => {
    render(
      <SkylineHero title="Partnerships Associate" size="m" facts={[{ icon: "pin", text: "Lagos" }, { icon: "brief", text: "Full Time" }]}>
        <span>Search</span>
      </SkylineHero>,
    );
    const facts = screen.getByRole("list", { name: "About the role" });
    expect(facts.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("Full Time").closest("li")).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 }).closest("section")).toHaveAttribute("data-size", "m");
  });

  it("keeps the skyline away from assistive technology", () => {
    const { container } = render(<SkylineHero title="Work With Us" still />);
    const art = container.querySelector('[aria-hidden="true"]');
    expect(art).not.toBeNull();
    expect(art).toContainElement(container.querySelector(".from-deep"));
  });

  it("draws Lagos as it is lit at the hour: a skyline at night has its windows on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-05T21:30:00Z"));
    const { container } = render(<SkylineHero title="Work With Us" still />);
    vi.useRealTimers();
    const scene = await vi.waitFor(() => {
      const el = container.querySelector('[data-city="lagos"]');
      if (!el) throw new Error("the drawing has not loaded yet");
      return el;
    });
    expect(scene).toHaveAttribute("data-phase", "night");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <SkylineHero eyebrow="Careers at MyCityApp" title="Work With Us" text="Building the app that knows every Nigerian city." still />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

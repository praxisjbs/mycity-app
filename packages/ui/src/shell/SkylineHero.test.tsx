import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import userEvent from "@testing-library/user-event";
import { SkylineHero } from "./SkylineHero";
import { SiteNavigate } from "./site-link";

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
    expect(container.querySelector(".map-grid")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".from-deep")!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("is a dark panel whatever the page's theme, so what sits on it takes the dark inks", () => {
    const { container } = render(<SkylineHero title="Work With Us" still />);
    expect(container.querySelector("section")).toHaveAttribute("data-theme", "dark");
  });

  it("as the pane, names a record as content, keeps its line on a phone and its wide part for desktop", () => {
    const ref = { current: null as HTMLHeadingElement | null };
    render(
      <SkylineHero size="pane" record eyebrow="Your Application" title="Head, Sales & Revenue" text="This link is yours until 12/11/2026." wide={<p>Steps</p>} titleRef={ref} still />,
    );
    const h1 = screen.getByRole("heading", { level: 1, name: "Head, Sales & Revenue" });
    expect(h1).toHaveAttribute("data-copy", "content");
    expect(h1).not.toHaveAttribute("data-ui");
    expect(ref.current).toBe(h1);
    expect(h1).toHaveAttribute("tabindex", "-1");
    const line = screen.getByText("This link is yours until 12/11/2026.");
    expect(line.className).not.toContain("phone:hidden");
    expect(line).not.toHaveAttribute("data-ui");
    expect(screen.getByText("Steps").parentElement!.className).toContain("lg:block");
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

  describe("the approved design's heroes", () => {
    it("index: the pill with its dot, the title with its accent word, the lede for desktop, the search and the counting figures", () => {
      const { container } = render(
        <SkylineHero size="index" eyebrow="Hiring in Lagos and Abuja" title="Work With Us" accent="Us" text="Building the app that knows every Nigerian city." stats={[{ value: 12, label: "Open Roles" }, { value: 7, label: "Teams Hiring" }]} still>
          <span>Search Roles</span>
        </SkylineHero>,
      );
      const section = container.querySelector("section")!;
      expect(section).toHaveClass("ps-hero-index");
      expect(section).not.toHaveAttribute("data-theme");
      expect(section.querySelector(".ps-hero-in")).toHaveAttribute("data-theme", "dark");
      expect(container.querySelector(".ps-dot")).toHaveAttribute("aria-hidden", "true");
      const h1 = screen.getByRole("heading", { level: 1, name: "Work With Us" });
      expect(h1).toHaveAttribute("data-ui", "page-title");
      expect(h1.querySelector("em")).toHaveTextContent("Us");
      expect(screen.getByText("Building the app that knows every Nigerian city.")).toHaveClass("phone:hidden");
      expect(screen.getByText("Search Roles").parentElement).toHaveClass("ps-hero-slot");
      expect(screen.getByText("Open Roles").tagName).toBe("DT");
      expect(screen.getByText("12")).toHaveClass("sr-only");
      expect(container.querySelector(".ps-hero-art")).toHaveAttribute("aria-hidden", "true");
      expect(section).toHaveAttribute("data-still");
    });

    it("role: All Roles goes through the site's navigate, the team as a gold pill, the facts as chips, the actions and the note", async () => {
      const navigate = vi.fn();
      render(
        <SiteNavigate.Provider value={navigate}>
          <SkylineHero
            size="role"
            record
            back={{ label: "All Roles", href: "/jobs" }}
            eyebrow="Marketing & Sales"
            title="Head, Sales & Revenue"
            facts={[{ icon: "pin", text: "Lekki Phase 1, Lagos" }]}
            note="12 people have applied"
            still
          >
            <button type="button">Apply for This Role</button>
          </SkylineHero>
        </SiteNavigate.Provider>,
      );
      await userEvent.click(screen.getByRole("link", { name: "All Roles" }));
      expect(navigate).toHaveBeenCalledWith("/jobs");
      expect(screen.getByText("Marketing & Sales")).toHaveClass("ps-pill-gold");
      expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("data-copy", "content");
      expect(screen.getByRole("list", { name: "About the role" })).toHaveClass("ps-chips");
      expect(screen.getByRole("button", { name: "Apply for This Role" }).parentElement).toHaveClass("ps-hero-acts");
      expect(screen.getByText("12 people have applied")).toHaveClass("ps-applied");
    });
  });
});

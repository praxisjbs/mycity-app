import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { CityShowcase } from "./CityShowcase";
import { phaseOf, sunTimes } from "./CityShowcase.draw";

describe("CityShowcase", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the first city with its own clock, and every city's time on its button", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T18:42:00Z"));
    render(<CityShowcase />);
    expect(screen.getByRole("heading", { name: "Lagos" })).toBeInTheDocument();
    expect(screen.getByText("Wednesday 14 October")).toBeInTheDocument();
    const cities = screen.getByRole("group", { name: "Cities" });
    expect(cities).toHaveTextContent("Lagos19:42");
    expect(cities).toHaveTextContent("London19:42");
    expect(cities).toHaveTextContent("Accra18:42");
    expect(cities).toHaveTextContent("Nairobi21:42");
    expect(cities).toHaveTextContent("Johannesburg20:42");
    expect(cities).toHaveTextContent("Rabat19:42");
    expect(cities).toHaveTextContent("Abidjan18:42");
    expect(cities).toHaveTextContent("Douala19:42");
    expect(screen.getAllByRole("button")).toHaveLength(8);
    expect(screen.getByRole("button", { name: /Lagos/ })).toHaveAttribute("aria-current", "true");
  });

  it("moves to the next city after the interval, and to any city on a click", async () => {
    vi.useFakeTimers();
    render(<CityShowcase interval={5000} />);
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByRole("heading", { name: "London" })).toBeInTheDocument();
    vi.useRealTimers();
    await userEvent.click(screen.getByRole("button", { name: /Nairobi/ }));
    expect(screen.getByRole("heading", { name: "Nairobi" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nairobi/ })).toHaveAttribute("aria-current", "true");
  });

  it("holds still while the pointer is on the cities", () => {
    vi.useFakeTimers();
    render(<CityShowcase interval={5000} />);
    act(() => void screen.getByRole("group", { name: "Cities" }).dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    act(() => void vi.advanceTimersByTime(12000));
    expect(screen.getByRole("heading", { name: "Lagos" })).toBeInTheDocument();
  });

  it("lights each city by its own sun", () => {
    const october = new Date("2026-10-14T12:00:00Z");
    const lagos = sunTimes("lagos", october, 1);
    expect(lagos.rise).toBeGreaterThan(6.5);
    expect(lagos.set).toBeLessThan(19.2);
    const londonWinter = sunTimes("london", new Date("2026-12-21T12:00:00Z"), 0);
    expect(londonWinter.set).toBeLessThan(16.3);
    expect(phaseOf(17, londonWinter.rise, londonWinter.set)).toBe("night");
    expect(phaseOf(13, lagos.rise, lagos.set)).toBe("day");
    expect(phaseOf(lagos.set, lagos.rise, lagos.set)).toBe("dusk");
  });

  it("shows a city's photograph once it has loaded, and keeps the drawing when it cannot", () => {
    const { container } = render(<CityShowcase />);
    const lagos = container.querySelector<HTMLElement>('[data-photo="lagos"]')!;
    const img = lagos.querySelector("img")!;
    expect(img).toHaveAttribute("alt", "");
    expect(img.getAttribute("srcset")).toMatch(/lagos-640\.webp 640w, .*lagos-1280\.webp 1280w/);
    expect(lagos).toHaveClass("opacity-0");
    fireEvent.load(img);
    expect(lagos).toHaveClass("opacity-100");
    expect(img.className).toMatch(/animate-ken-1/);
    fireEvent.error(container.querySelector('[data-photo="london"] img')!);
    expect(container.querySelector('[data-photo="london"]')).toBeNull();
  });

  it("fetches a photograph only when its city is shown or next, and keeps it once it has arrived", () => {
    vi.useFakeTimers();
    const { container } = render(<CityShowcase interval={5000} />);
    const photos = () => [...container.querySelectorAll<HTMLElement>("[data-photo]")].map((p) => p.dataset.photo);
    expect(photos()).toEqual(["lagos", "london"]);
    fireEvent.load(container.querySelector('[data-photo="lagos"] img')!);
    act(() => void vi.advanceTimersByTime(5000));
    expect(photos()).toEqual(["lagos", "london", "accra"]);
  });

  it("drifts the portrait photographs on a phone, under the grain and the rising lights", () => {
    const { container } = render(<CityShowcase variant="phone" start="rabat" />);
    const img = container.querySelector('[data-photo="rabat"] img')!;
    expect(img.getAttribute("src")).toMatch(/rabat-phone\.webp/);
    expect(img).not.toHaveAttribute("srcset");
    expect(img.className).toMatch(/animate-ken-2/);
    expect(container.querySelectorAll(".city-motes > i").length).toBeGreaterThan(8);
    expect(container.querySelector(".city-grain")).not.toBeNull();
    expect(container.querySelector(".city-parallax")).toBeNull();
  });

  it("sets the form in smoked glass in the dark theme's colours, on a phone and on desktop", () => {
    const { unmount } = render(
      <CityShowcase variant="phone" start="abidjan" aside={<p>The form</p>}>
        <span>Brand</span>
      </CityShowcase>,
    );
    expect(screen.getByText("Abidjan")).toBeInTheDocument();
    expect(screen.getByText("Côte d'Ivoire")).toBeInTheDocument();
    expect(screen.getByText("The form").closest("[data-theme]")).toHaveAttribute("data-theme", "dark");
    expect(screen.getByText("The form").closest("[data-theme]")).toHaveClass("city-glass");
    expect(screen.queryByRole("group", { name: "Cities" })).toBeNull();
    unmount();
    render(<CityShowcase aside={<p>The form</p>} />);
    expect(screen.getByText("The form").closest("[data-theme]")).toHaveClass("city-glass");
  });

  it("keeps the colon of the shown city's clock ticking", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T18:42:00Z"));
    const { container } = render(<CityShowcase />);
    const time = container.querySelector("h2 + time")!;
    expect(time).toHaveTextContent("19:42");
    expect(time.querySelector(".animate-tick")).toHaveTextContent(":");
  });

  it("holds everything still under reduced motion", () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => {
      const list = real(q);
      return { ...list, matches: q.includes("reduced-motion") || list.matches };
    }) as typeof window.matchMedia;
    try {
      const { container } = render(<CityShowcase variant="phone" />);
      expect(container.querySelector('[data-photo="lagos"] img')!.className).not.toMatch(/animate-ken/);
      expect(container.querySelector(".city-motes")).toBeNull();
      expect(container.querySelector(".animate-glow")).toBeNull();
    } finally {
      window.matchMedia = real;
    }
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<CityShowcase />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

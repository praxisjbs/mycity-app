import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

  it("is a short band on a phone", () => {
    render(<CityShowcase variant="band" start="accra" />);
    expect(screen.getByText("Accra")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Cities" })).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<CityShowcase />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

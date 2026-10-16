import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Calendar, type CalendarEvent } from "./Calendar";

// October 2026 starts on a Thursday and has 31 days.
const EVENTS: CalendarEvent[] = [
  { date: "2026-10-14", label: "Ada on leave" },
  { date: "2026-10-14", label: "Payroll run", highlight: true },
  { date: "2026-10-25", label: "Payday" },
  { date: "2026-11-02", label: "Next month" },
];

describe("Calendar", () => {
  it("names the month and the time zone", () => {
    render(<Calendar year={2026} month={9} events={[]} />);
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    expect(screen.getByText("Africa/Lagos")).toBeInTheDocument();
  });

  it("is a table whose weekdays are real headers, Monday first", () => {
    render(<Calendar year={2026} month={9} events={[]} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("draws every day of the month and no more", () => {
    render(<Calendar year={2026} month={9} events={[]} />);
    expect(screen.getByText("31")).toBeInTheDocument();
    expect(screen.getAllByText("1")).toHaveLength(1);
  });

  it("puts a day's events in that day, and ignores other months", () => {
    render(<Calendar year={2026} month={9} events={EVENTS} />);
    const day = screen.getByText("14").closest("td")!;
    expect(within(day).getByText("Ada on leave")).toBeInTheDocument();
    expect(within(day).getByText("Payroll run")).toBeInTheDocument();
    expect(screen.queryByText("Next month")).toBeNull();
  });

  it("opens an event that can be opened, and leaves the rest as plain words", async () => {
    const onSelect = vi.fn();
    render(<Calendar year={2026} month={9} events={[{ date: "2026-10-25", label: "Payday", onSelect }, EVENTS[0]!]} />);
    await userEvent.click(screen.getByRole("button", { name: "Payday" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Ada on leave" })).toBeNull();
  });

  it("says Sunday is not a working day in words, not only by its shade", () => {
    render(<Calendar year={2026} month={9} events={[]} />);
    // 4 October 2026 is the first Sunday.
    const sunday = screen.getByText("4").closest("td")!;
    expect(within(sunday).getByText(", Sunday, not a working day")).toBeInTheDocument();
  });

  it("marks the day that matters most in the brand yellow", () => {
    render(<Calendar year={2026} month={9} events={EVENTS} />);
    expect(screen.getByText("Payroll run").className).toContain("bg-primary");
    expect(screen.getByText("Ada on leave").className).toContain("bg-accent");
  });

  it("fills the weeks out, so February and a 31-day month both form whole rows", () => {
    const { container, rerender } = render(<Calendar year={2026} month={9} events={[]} />);
    const cells = container.querySelectorAll("tbody td").length;
    expect(cells % 7).toBe(0);
    rerender(<Calendar year={2026} month={1} events={[]} />);
    expect(container.querySelectorAll("tbody td").length % 7).toBe(0);
  });

  it("is marked as content, since the events are what people wrote", () => {
    const { container } = render(<Calendar year={2026} month={9} events={EVENTS} />);
    expect(container.querySelector("table")).toHaveAttribute("data-copy", "content");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Calendar year={2026} month={9} events={EVENTS.map((e) => ({ ...e, onSelect: vi.fn() }))} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

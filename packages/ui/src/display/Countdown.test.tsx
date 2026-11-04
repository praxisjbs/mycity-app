import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Countdown } from "./Countdown";

const T0 = Date.parse("2026-11-10T09:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const tick = (seconds: number) =>
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
const timer = () => screen.getByRole("timer");

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows minutes and seconds, with hours only when there are some", () => {
    const { rerender } = render(<Countdown endsAt={iso(T0 + 3909000)} serverNow={iso(T0)} />);
    expect(timer()).toHaveTextContent("1:05:09");
    rerender(<Countdown endsAt={iso(T0 + 65000)} serverNow={iso(T0)} />);
    expect(timer()).toHaveTextContent("01:05");
    rerender(<Countdown endsAt={iso(T0 + 200)} serverNow={iso(T0)} />);
    expect(timer()).toHaveTextContent("00:01");
  });

  it("shows the time left and counts down each second", () => {
    render(<Countdown endsAt={iso(T0 + 45 * 60000)} serverNow={iso(T0)} />);
    expect(timer()).toHaveTextContent("45:00");
    expect(timer()).toHaveAccessibleName("Time Left: 45 minutes");
    tick(1);
    expect(timer()).toHaveTextContent("44:59");
  });

  it("counts on the server's clock, so a device clock that is wrong changes nothing", () => {
    /* The device is five minutes fast; the server says it is T0. */
    vi.setSystemTime(T0 + 5 * 60000);
    render(<Countdown endsAt={iso(T0 + 10 * 60000)} serverNow={iso(T0)} />);
    expect(timer()).toHaveTextContent("10:00");
  });

  it("turns amber at the warning time and red in the last minute, saying each once", () => {
    const { container } = render(<Countdown endsAt={iso(T0 + 302000)} serverNow={iso(T0)} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box).toHaveAttribute("data-stage", "ok");
    expect(screen.getByRole("status")).toHaveTextContent("");
    tick(3);
    expect(box).toHaveAttribute("data-stage", "warn");
    expect(timer().className).toContain("text-warning");
    expect(screen.getByRole("status")).toHaveTextContent("5 minutes left");
    tick(240);
    expect(box).toHaveAttribute("data-stage", "last");
    expect(timer().className).toContain("text-destructive");
    expect(screen.getByRole("status")).toHaveTextContent("1 minute left");
  });

  it("says nothing on arrival, even when it opens inside the warning time", () => {
    render(<Countdown endsAt={iso(T0 + 120000)} serverNow={iso(T0)} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("calls onEnd once when the time runs out, and stops at zero", () => {
    const onEnd = vi.fn();
    render(<Countdown endsAt={iso(T0 + 3000)} serverNow={iso(T0)} onEnd={onEnd} />);
    tick(2);
    expect(onEnd).not.toHaveBeenCalled();
    tick(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(timer()).toHaveTextContent("00:00");
    expect(screen.getByRole("status")).toHaveTextContent("Time is up");
    tick(5);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("calls onEnd at once when it opens already past its end", () => {
    const onEnd = vi.fn();
    render(<Countdown endsAt={iso(T0 - 1000)} serverNow={iso(T0)} onEnd={onEnd} />);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("takes its own label and warning time", () => {
    render(<Countdown endsAt={iso(T0 + 600000)} serverNow={iso(T0)} warnAt={900} label="Time Remaining" />);
    expect(timer()).toHaveAccessibleName("Time Remaining: 10 minutes");
    expect(screen.getByText("Time Remaining")).toHaveAttribute("aria-hidden", "true");
  });

  it("has no accessibility violations", async () => {
    vi.useRealTimers();
    const now = Date.now();
    const { container } = render(
      <div>
        <Countdown endsAt={iso(now + 45 * 60000)} serverNow={iso(now)} />
        <Countdown endsAt={iso(now + 30000)} serverNow={iso(now)} />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

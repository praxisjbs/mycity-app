import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Countdown } from "./Countdown";

const T0 = Date.parse("2026-11-10T09:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
let answers = 0;
/** One server answer: its own `server_now` (each answer is a new moment) and an end `ms` after it. */
const answer = (ms: number) => {
  answers += 1;
  const server = T0 + answers * 1000;
  return { serverNow: iso(server), endsAt: iso(server + ms), server };
};
/** Time passing a second at a time, as a page sees it: each redraw schedules the next. */
const tick = (seconds: number) => {
  let ms = Math.round(seconds * 1000);
  while (ms > 0) {
    const step = Math.min(1000, ms);
    act(() => {
      vi.advanceTimersByTime(step);
    });
    ms -= step;
  }
};
const timer = () => screen.getByRole("timer");
const said = () => screen.getByRole("status").textContent;
const stage = (c: HTMLElement) => (c.firstElementChild as HTMLElement).getAttribute("data-stage");

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A device whose clock reads the server's time `ahead` ms late or early at the moment the answer lands. */
  const arrive = (a: { server: number }, ahead = 0) => vi.setSystemTime(a.server + ahead);

  it("shows minutes and seconds, with hours only when there are some", () => {
    const a = answer(3909000);
    arrive(a);
    const { unmount } = render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} />);
    expect(timer()).toHaveTextContent("1:05:09");
    unmount();
    const b = answer(65000);
    arrive(b);
    render(<Countdown endsAt={b.endsAt} serverNow={b.serverNow} />);
    expect(timer()).toHaveTextContent("01:05");
  });

  it("shows the time left and counts down each second", () => {
    const a = answer(45 * 60000);
    arrive(a);
    render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} />);
    expect(timer()).toHaveTextContent("45:00");
    expect(timer()).toHaveAccessibleName("Time Left: 45 minutes");
    tick(1);
    expect(timer()).toHaveTextContent("44:59");
  });

  it("counts on the server's clock, so a device clock that is wrong changes nothing", () => {
    const a = answer(10 * 60000);
    arrive(a, 5 * 60000);
    render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} />);
    expect(timer()).toHaveTextContent("10:00");
  });

  it("keeps counting from when the answer arrived when it remounts", () => {
    const a = answer(45 * 60000);
    arrive(a);
    const { unmount } = render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} />);
    tick(600);
    expect(timer()).toHaveTextContent("35:00");
    unmount();
    render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} />);
    expect(timer()).toHaveTextContent("35:00");
  });

  it("turns amber at the warning time and red in the last minute, saying the time really left", () => {
    const a = answer(302000);
    arrive(a);
    const { container } = render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} />);
    expect(stage(container)).toBe("ok");
    expect(said()).toBe("");
    tick(3);
    expect(stage(container)).toBe("warn");
    expect(timer().className).toContain("text-warning");
    expect(said()).toBe("5 minutes left");
    tick(240);
    expect(stage(container)).toBe("last");
    expect(timer().className).toContain("text-destructive");
    expect(said()).toBe("1 minute left");
  });

  it("says the real time left after a jump, never a minute it does not have", () => {
    const a = answer(302000);
    arrive(a);
    render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} />);
    /* The tab sat in the background: the clock moved on and no tick ran until it came back. */
    act(() => {
      vi.setSystemTime(a.server + 296000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(timer()).toHaveTextContent("00:06");
    expect(said()).toBe("6 seconds left");
  });

  it("says the warning and the last minute in different words when the warning is under two minutes", () => {
    const a = answer(95000);
    arrive(a);
    render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} warnAt={90} />);
    tick(5);
    const warning = said();
    expect(warning).toMatch(/^1 minute \d+ seconds left$/);
    expect(warning).toBe("1 minute 30 seconds left");
    tick(30);
    expect(said()).toBe("1 minute left");
    expect(said()).not.toBe(warning);
  });

  it("says nothing on arrival, even when it opens inside the warning time", () => {
    const a = answer(120000);
    arrive(a);
    render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} />);
    expect(said()).toBe("");
  });

  it("shows 00:00 and calls onEnd as the time runs out, not a second later", () => {
    const onEnd = vi.fn();
    const a = answer(3000);
    arrive(a);
    render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} onEnd={onEnd} />);
    act(() => {
      vi.advanceTimersByTime(2990);
    });
    expect(onEnd).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(timer()).toHaveTextContent("00:00");
    expect(said()).toBe("Time is up");
  });

  it("calls onEnd again while the time stays run out, so the page asks the server again", () => {
    const onEnd = vi.fn();
    const a = answer(1000);
    arrive(a);
    render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} onEnd={onEnd} retryEvery={10} />);
    tick(1.1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    tick(5);
    expect(onEnd).toHaveBeenCalledTimes(1);
    tick(5);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it("calls onEnd once when it opens past its end, also under StrictMode", () => {
    const onEnd = vi.fn();
    const a = answer(-1000);
    arrive(a);
    render(
      <StrictMode>
        <Countdown endsAt={a.endsAt} serverNow={a.serverNow} onEnd={onEnd} />
      </StrictMode>,
    );
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("starts again for a new end, and ends again then", () => {
    const onEnd = vi.fn();
    const a = answer(1000);
    arrive(a);
    const { rerender } = render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} onEnd={onEnd} />);
    tick(1.1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    const b = answer(2000);
    arrive(b);
    rerender(<Countdown endsAt={b.endsAt} serverNow={b.serverNow} onEnd={onEnd} />);
    expect(timer()).toHaveTextContent("00:02");
    tick(2.1);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it("draws nothing for an untimed sitting", () => {
    const a = answer(0);
    arrive(a);
    const { container } = render(<Countdown endsAt={null} serverNow={a.serverNow} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leaves no timer or listener running once it is gone", () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const a = answer(60000);
    arrive(a);
    const { unmount } = render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    remove.mockRestore();
  });

  it("takes its own label and warning time", () => {
    const a = answer(600000);
    arrive(a);
    render(<Countdown endsAt={a.endsAt} serverNow={a.serverNow} warnAt={900} label="Time Remaining" />);
    expect(timer()).toHaveAccessibleName("Time Remaining: 10 minutes");
    expect(screen.getByText("Time Remaining")).toHaveAttribute("aria-hidden", "true");
  });

  it("has no accessibility violations", async () => {
    vi.useRealTimers();
    const now = Date.now();
    const { container } = render(
      <div>
        <Countdown endsAt={iso(now + 45 * 60000)} serverNow={iso(now)} />
        <Countdown endsAt={iso(now + 30000)} serverNow={iso(now + 1)} />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

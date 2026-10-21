import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { installOverlayTestEnv } from "../overlay/test-env";
import { setViewport } from "../testing/viewport";
import { PhoneShell } from "./PhoneShell";
import { PhoneHeader } from "./PhoneHeader";
import { BottomBar } from "./BottomBar";
import { BOTTOM_ITEMS } from "./fixtures";
import { PullIndicator } from "./PullIndicator";
import { canPullFrom, pullDistance, PULL_RELOAD, PULL_REFRESH } from "./pull";

beforeAll(installOverlayTestEnv);
afterEach(() => vi.useRealTimers());

const shell = (props: { onRefresh?: () => Promise<unknown>; onReload?: () => unknown; fit?: boolean; children?: React.ReactNode }) => (
  <PhoneShell
    header={<PhoneHeader title="People" homeHref="/home" />}
    bottomBar={<BottomBar items={BOTTOM_ITEMS(() => undefined)} current="more" />}
    onRefresh={props.onRefresh}
    onReload={props.onReload}
    fit={props.fit}
  >
    {props.children ?? <p>Ada Obi</p>}
  </PhoneShell>
);

/** A finger: down at `from`, moved by each step, lifted. */
function drag(el: Element, steps: Array<[number, number]>, from: [number, number] = [100, 100]) {
  const at = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });
  fireEvent.touchStart(el, at(...from));
  for (const [dx, dy] of steps) fireEvent.touchMove(el, at(from[0] + dx, from[1] + dy));
  fireEvent.touchEnd(el, { touches: [] });
}

describe("PullIndicator", () => {
  it("is invisible at rest, a status while it works, and turns to the reload mark past the second notch", () => {
    const { container, rerender } = render(
      <div className="relative">
        <PullIndicator state="idle" />
      </div>,
    );
    expect(container.querySelector("[data-pull]")).toHaveClass("invisible");
    rerender(
      <div className="relative">
        <PullIndicator state="refreshing" distance={64} />
      </div>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing");
    rerender(
      <div className="relative">
        <PullIndicator state="reloading" distance={64} />
      </div>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Reloading");
  });

  it("feels like a phone's own pull: resistance past the release point, a ceiling, and nothing for a move up", () => {
    expect(pullDistance(-20, false)).toBe(0);
    expect(pullDistance(100, false)).toBeLessThan(PULL_REFRESH);
    expect(pullDistance(130, false)).toBeGreaterThanOrEqual(PULL_REFRESH);
    expect(pullDistance(1000, false)).toBe(112);
    expect(pullDistance(320, true)).toBeGreaterThanOrEqual(PULL_RELOAD);
  });

  it("never starts in a field, in an opted-out part, or over a list that is not at its top", () => {
    const page = document.createElement("main");
    page.innerHTML = '<div class="list"><p>row</p></div><div data-pull="off"><p>map</p></div><input aria-label="Name" />';
    document.body.appendChild(page);
    const list = page.querySelector(".list")!;
    expect(canPullFrom(page.querySelector("p")!, page)).toBe(true);
    expect(canPullFrom(page.querySelector("[data-pull] p")!, page)).toBe(false);
    expect(canPullFrom(page.querySelector("input")!, page)).toBe(false);
    Object.defineProperty(list, "scrollTop", { value: 40, configurable: true });
    expect(canPullFrom(list.querySelector("p")!, page)).toBe(false);
    Object.defineProperty(page, "scrollTop", { value: 10, configurable: true });
    expect(canPullFrom(page.querySelector("[data-pull] p")!.parentElement!, page)).toBe(false);
    page.remove();
  });

  it("pulled past the release point refreshes in place, turning until the reads are in", async () => {
    setViewport(390);
    let finish!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { container } = render(shell({ onRefresh }));
    const page = screen.getByRole("main");
    const indicator = container.querySelector("[data-pull]")!;
    act(() => drag(page, [[0, 12], [0, 80], [0, 160]]));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(indicator).toHaveAttribute("data-pull", "refreshing");
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing");
    await act(async () => finish());
    expect(indicator).toHaveAttribute("data-pull", "done");
  });

  it("a short pull springs back and refreshes nothing; a sideways swipe never starts one", () => {
    setViewport(390);
    const onRefresh = vi.fn(() => Promise.resolve());
    render(shell({ onRefresh }));
    const page = screen.getByRole("main");
    act(() => drag(page, [[0, 12], [0, 60]]));
    act(() => drag(page, [[40, 8], [120, 30], [160, 200]]));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("pulled on past the second notch reloads instead", () => {
    setViewport(390);
    const onRefresh = vi.fn(() => Promise.resolve());
    const onReload = vi.fn();
    const { container } = render(shell({ onRefresh, onReload }));
    act(() => drag(screen.getByRole("main"), [[0, 12], [0, 200], [0, 420]]));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(container.querySelector("[data-pull]")).toHaveAttribute("data-pull", "reloading");
  });

  it("a fit page has no pull, and nothing pulls without onRefresh", () => {
    setViewport(390);
    const onRefresh = vi.fn(() => Promise.resolve());
    const { container, rerender } = render(shell({ onRefresh, fit: true }));
    expect(container.querySelector("[data-pull]")).toBeNull();
    rerender(shell({}));
    expect(container.querySelector("[data-pull]")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    setViewport(390);
    const { container } = render(shell({ onRefresh: () => Promise.resolve() }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

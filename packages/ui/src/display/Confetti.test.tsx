import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { axe } from "../testing/axe";
import { Confetti } from "./Confetti";

/* jsdom draws nothing: a stand-in 2D context records what the burst paints. */
const painted = { rects: 0, arcs: 0, strokes: 0, fills: 0 };
const ctx = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  scale: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  arc: vi.fn(() => void (painted.arcs += 1)),
  fill: vi.fn(() => void (painted.fills += 1)),
  stroke: vi.fn(() => void (painted.strokes += 1)),
  fillRect: vi.fn(() => void (painted.rects += 1)),
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  lineCap: "butt",
};
const drawn = () => painted.rects + painted.fills + painted.strokes;

let frames: FrameRequestCallback[] = [];
const step = (n = 1) => {
  for (let i = 0; i < n; i++) {
    const run = frames;
    frames = [];
    act(() => run.forEach((f) => f(performance.now() + 16 * (i + 1))));
  }
};

let watched: Array<{ cb: IntersectionObserverCallback; el: Element }> = [];
class FakeObserver {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) {
    watched.push({ cb: this.cb, el });
  }
  disconnect() {
    watched = watched.filter((w) => w.cb !== this.cb);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
const scrollInto = (ratio: number) =>
  act(() => watched.slice().forEach((w) => w.cb([{ intersectionRatio: ratio, isIntersecting: ratio > 0, target: w.el } as IntersectionObserverEntry], w as unknown as IntersectionObserver)));

beforeEach(() => {
  Object.assign(painted, { rects: 0, arcs: 0, strokes: 0, fills: 0 });
  frames = [];
  watched = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => (frames.push(f), frames.length));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Confetti", () => {
  it("is a canvas hidden from screen readers that draws nothing until a burst", () => {
    const { container } = render(<Confetti />);
    const canvas = container.querySelector("canvas")!;
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });

  it("bursts each time the press count rises, from the button it is given, and settles", () => {
    const button = createRef<HTMLButtonElement>();
    const card = (presses: number) => (
      <div className="relative">
        <Confetti burst={presses} from={button} />
        <button ref={button} type="button">
          Celebrate
        </button>
      </div>
    );
    const { rerender } = render(card(0));
    expect(frames).toHaveLength(0);
    rerender(card(1));
    step();
    expect(drawn()).toBeGreaterThan(20);
    // The same count again is not a new press.
    const before = frames.length;
    rerender(card(1));
    expect(frames.length).toBe(before);
    // Every piece falls out of the (empty, 0 px) box and the drawing stops.
    step(400);
    expect(frames).toHaveLength(0);
  });

  it("bursts once when the card is first well in view, and says so", () => {
    const seen = vi.fn();
    render(
      <div className="relative">
        <Confetti shape="stars" on="brand" burstOnView onViewBurst={seen} />
      </div>,
    );
    scrollInto(0.3);
    expect(seen).not.toHaveBeenCalled();
    scrollInto(0.8);
    step();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(drawn()).toBeGreaterThan(20);
    // It stops watching after the first time.
    expect(watched).toHaveLength(0);
  });

  it("draws nothing when the device asks for less motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    const seen = vi.fn();
    const { rerender } = render(<Confetti burst={0} burstOnView onViewBurst={seen} />);
    rerender(<Confetti burst={1} burstOnView onViewBurst={seen} />);
    scrollInto(1);
    expect(frames).toHaveLength(0);
    expect(drawn()).toBe(0);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div className="relative">
        <Confetti />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

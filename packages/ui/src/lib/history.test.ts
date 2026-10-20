import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { setViewport } from "../testing/viewport";
import {
  currentStep,
  goHistory,
  historyStartedFresh,
  onHistory,
  pushStep,
  replaceStep,
  resetHistoryForTest,
  restoreSteps,
  startHistory,
  useBackClose,
  type HistoryChange,
} from "./history";

const here = () => window.location.pathname + window.location.search;
/** One move through the window's history, and the popstate it brings (jsdom fires it after a task). */
const move = async (delta: number) => {
  await act(async () => {
    const landed = new Promise<void>((resolve) => window.addEventListener("popstate", () => setTimeout(resolve, 0), { once: true }));
    window.history.go(delta);
    await landed;
  });
};
/** Lets a carried-on move (a spent entry skipped) land too. */
const settle = () => act(async () => new Promise<void>((r) => setTimeout(r, 30)));

beforeEach(() => {
  resetHistoryForTest();
  window.history.replaceState(null, "", "/home?tab=overview");
});
afterEach(() => resetHistoryForTest());

describe("the window's history", () => {
  it("marks the entry it opens on, and knows a reload from a fresh start", () => {
    startHistory();
    expect(historyStartedFresh()).toBe(true);
    const first = currentStep();
    resetHistoryForTest();
    startHistory();
    expect(historyStartedFresh()).toBe(false);
    expect(currentStep().key).toBe(first.key);
  });

  it("pushes steps, replaces in place, and tells Back from a new step", async () => {
    startHistory();
    const seen: HistoryChange[] = [];
    onHistory((c) => seen.push(c));
    const home = currentStep();
    act(() => void pushStep("/people?tab=employees"));
    act(() => void replaceStep("/people?tab=employees&status=active"));
    expect(seen.map((c) => c.kind)).toEqual(["push", "replace"]);
    expect(seen[1]).toMatchObject({ key: seen[0]!.key, url: "/people?tab=employees&status=active" });
    await move(-1);
    expect(here()).toBe("/home?tab=overview");
    expect(seen.at(-1)).toMatchObject({ kind: "pop", key: home.key });
    await move(1);
    expect(here()).toBe("/people?tab=employees&status=active");
    expect(seen.at(-1)).toMatchObject({ kind: "pop", key: seen[0]!.key });
  });

  it("rebuilds the steps kept on the device, the last one on screen", async () => {
    startHistory();
    const steps = restoreSteps(["/home?tab=overview", "/people?tab=employees", "/people?tab=employees&id=e1"]);
    expect(steps.map((s) => s.pos)).toEqual([0, 1, 2]);
    expect(here()).toBe("/people?tab=employees&id=e1");
    await move(-2);
    expect(here()).toBe("/home?tab=overview");
  });

  it("jumps through the trail by places", async () => {
    startHistory();
    act(() => void pushStep("/people?tab=employees"));
    act(() => void pushStep("/payroll?tab=runs"));
    await act(async () => {
      const landed = new Promise<void>((r) => window.addEventListener("popstate", () => setTimeout(r, 0), { once: true }));
      goHistory(-2);
      await landed;
    });
    expect(here()).toBe("/home?tab=overview");
  });
});

describe("an overlay on a phone", () => {
  beforeEach(() => setViewport(390));
  afterEach(() => setViewport(1280));

  it("holds an entry while open, so Back closes it and leaves the screen", async () => {
    startHistory();
    act(() => void pushStep("/people?tab=employees"));
    const onClose = vi.fn();
    const { rerender } = renderHook(({ open }) => useBackClose(open, onClose), { initialProps: { open: true } });
    const length = window.history.length;
    await move(-1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(here()).toBe("/people?tab=employees");
    rerender({ open: false });
    expect(window.history.length).toBe(length);
  });

  it("comes back when its owner refuses to close, and swallows Back when it must be answered", async () => {
    startHistory();
    const refuse = vi.fn();
    renderHook(() => useBackClose(true, refuse));
    await move(-1);
    expect(refuse).toHaveBeenCalledTimes(1);
    // Still open: a fresh entry is on top, so the next Back asks again rather than leaving.
    await move(-1);
    expect(refuse).toHaveBeenCalledTimes(2);

    const prompt = vi.fn();
    renderHook(() => useBackClose(true, prompt, { hold: true }));
    await move(-1);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("closed by its own button leaves a spent entry that Back passes straight through", async () => {
    startHistory();
    act(() => void pushStep("/people?tab=employees"));
    const { rerender } = renderHook(({ open }) => useBackClose(open, () => undefined), { initialProps: { open: true } });
    rerender({ open: false });
    expect(here()).toBe("/people?tab=employees");
    await move(-1);
    await settle();
    expect(here()).toBe("/home?tab=overview");
  });

  it("a step taken from inside it takes its entry, so no stray entry is left", async () => {
    startHistory();
    const { rerender } = renderHook(({ open }) => useBackClose(open, () => undefined), { initialProps: { open: true } });
    act(() => void pushStep("/people?tab=employees"));
    rerender({ open: false });
    await move(-1);
    await settle();
    expect(here()).toBe("/home?tab=overview");
  });

  it("a filter changed under it stays when Back closes it", async () => {
    startHistory();
    act(() => void pushStep("/people?tab=employees"));
    const onClose = vi.fn();
    renderHook(() => useBackClose(true, onClose));
    act(() => void replaceStep("/people?tab=employees&status=active"));
    await move(-1);
    expect(onClose).toHaveBeenCalled();
    expect(here()).toBe("/people?tab=employees&status=active");
  });

  it("does nothing on desktop, or before the app's router starts the history", () => {
    setViewport(1280);
    startHistory();
    const length = window.history.length;
    renderHook(() => useBackClose(true, () => undefined));
    expect(window.history.length).toBe(length);
    resetHistoryForTest();
    setViewport(390);
    renderHook(() => useBackClose(true, () => undefined));
    expect(window.history.length).toBe(length);
  });
});

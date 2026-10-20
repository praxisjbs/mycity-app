// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { resetHistoryForTest } from "@mycity/ui";
import { installMatchMedia } from "@mycity/ui/testing";
import { RouterProvider, useRouter } from "./router";
import { forgetTrail, goTrail, resetTrailForTest, resumeTrail, startTrail, useTrail, useTrailTitle, RESUME_MS } from "./trail";

/**
 * This device's trail (FRONTEND_FOUNDATION F29) and the router's step rule: a
 * new screen, tab or record is a step, anything else changes the step in place;
 * the trail follows the steps, names records, jumps, comes back after the app
 * was closed for the same person only, and leaves with Sign Out.
 */

installMatchMedia();
const here = () => window.location.pathname + window.location.search;
const wrapper = ({ children }: { children: ReactNode }) => <RouterProvider>{children}</RouterProvider>;
/** One move through the window's history, and the popstate it brings (jsdom fires it after a task). */
const move = async (delta: number) => {
  await act(async () => {
    const landed = new Promise<void>((r) => window.addEventListener("popstate", () => setTimeout(r, 0), { once: true }));
    window.history.go(delta);
    await landed;
  });
};
const installed = (on: boolean) => Object.defineProperty(navigator, "standalone", { value: on, configurable: true });

beforeEach(() => {
  resetTrailForTest();
  resetHistoryForTest();
  localStorage.clear();
  window.history.replaceState(null, "", "/home?tab=overview");
});
afterEach(() => {
  cleanup();
  installed(false);
});

function useHub() {
  const router = useRouter();
  const trail = useTrail();
  return { ...router, trail };
}

describe("the router's steps", () => {
  it("another screen, tab or record is a step; a filter, a search or a page changes the step in place", async () => {
    const { result } = renderHook(useHub, { wrapper });
    act(() => startTrail("u1"));
    act(() => result.current.navigate("/people?tab=employees"));
    act(() => result.current.navigate("/people?tab=employees&status=active&page=2"));
    act(() => result.current.navigate("/people?tab=employees&status=active&page=2&id=e1"));
    expect(result.current.trail.places.map((p) => p.url)).toEqual([
      "/home?tab=overview",
      "/people?tab=employees&status=active&page=2",
      "/people?tab=employees&status=active&page=2&id=e1",
    ]);
    await move(-1);
    // Back returns to the list as it was left: the filter and the page kept.
    expect(here()).toBe("/people?tab=employees&status=active&page=2");
    expect(result.current.location.params.get("status")).toBe("active");
    expect(result.current.trail.index).toBe(1);
  });

  it("a caller that knows better still decides", () => {
    const { result } = renderHook(useHub, { wrapper });
    act(() => startTrail("u1"));
    act(() => result.current.navigate("/people?tab=employees", { replace: true }));
    act(() => result.current.navigate("/people?tab=employees&view=matrix", { replace: false }));
    expect(result.current.trail.places.map((p) => p.url)).toEqual(["/people?tab=employees", "/people?tab=employees&view=matrix"]);
  });
});

describe("the trail", () => {
  it("jumps straight to a place, and a record's screen names it", async () => {
    const { result } = renderHook(useHub, { wrapper });
    act(() => startTrail("u1"));
    act(() => result.current.navigate("/people?tab=employees"));
    act(() => result.current.navigate("/people?tab=employees&id=e1"));
    renderHook(() => useTrailTitle("Ada Obi"), { wrapper });
    expect(result.current.trail.places.at(-1)!.title).toBe("Ada Obi");
    act(() => result.current.navigate("/payroll?tab=payroll-runs"));
    await act(async () => {
      const landed = new Promise<void>((r) => window.addEventListener("popstate", () => setTimeout(r, 0), { once: true }));
      goTrail(-3);
      await landed;
    });
    expect(here()).toBe("/home?tab=overview");
    expect(result.current.location.module).toBe("home");
    expect(result.current.trail.index).toBe(0);
  });

  it("is kept on the device for the same person, and Sign Out wipes it", () => {
    const { result } = renderHook(useHub, { wrapper });
    act(() => startTrail("u1"));
    act(() => result.current.navigate("/people?tab=employees"));
    const saved = JSON.parse(localStorage.getItem("mc-trail")!);
    expect(saved).toMatchObject({ user: "u1", index: 1 });
    act(() => forgetTrail());
    expect(localStorage.getItem("mc-trail")).toBeNull();
  });
});

describe("reopening the installed app", () => {
  const leave = (user: string, at = Date.now()) =>
    localStorage.setItem(
      "mc-trail",
      JSON.stringify({
        v: 1,
        user,
        at,
        index: 2,
        places: [
          { key: "a", url: "/home?tab=overview", pos: 0 },
          { key: "b", url: "/people?tab=employees", pos: 1 },
          { key: "c", url: "/people?tab=employees&id=e1", pos: 2, title: "Ada Obi" },
        ],
      }),
    );
  const launch = () => {
    window.history.replaceState(null, "", "/");
    resetHistoryForTest();
    installed(true);
    resumeTrail();
  };

  it("opens on the last place before anything draws, then puts the steps behind it back for the same person", async () => {
    leave("u1");
    launch();
    expect(here()).toBe("/people?tab=employees&id=e1");
    const { result } = renderHook(useHub, { wrapper });
    act(() => void startTrail("u1"));
    expect(here()).toBe("/people?tab=employees&id=e1");
    expect(result.current.trail.places.map((p) => p.title ?? p.url)).toEqual(["/home?tab=overview", "/people?tab=employees", "Ada Obi"]);
    await move(-1);
    expect(here()).toBe("/people?tab=employees");
  });

  it("someone else signing in starts at Home with nothing of the last person's trail", () => {
    leave("u1");
    launch();
    renderHook(useHub, { wrapper });
    let landing: "home" | null = null;
    act(() => {
      landing = startTrail("u2");
    });
    expect(landing).toBe("home");
    expect(JSON.parse(localStorage.getItem("mc-trail")!)).toMatchObject({ user: "u2", places: [] });
  });

  it("not after 12 hours, not in a browser tab, and not when opened on a link", () => {
    leave("u1", Date.now() - RESUME_MS - 1000);
    launch();
    expect(here()).toBe("/");
    leave("u1");
    installed(false);
    window.history.replaceState(null, "", "/");
    resetHistoryForTest();
    resumeTrail();
    expect(here()).toBe("/");
    installed(true);
    window.history.replaceState(null, "", "/mailbox?tab=inbox&id=m1");
    resetHistoryForTest();
    resumeTrail();
    expect(here()).toBe("/mailbox?tab=inbox&id=m1");
  });
});

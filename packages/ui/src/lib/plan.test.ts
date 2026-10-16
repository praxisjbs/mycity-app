import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createDeliveryPlan, currentMilestone, openRule, screenOpens, type DeliveryPlan } from "./plan";
import { markStaging } from "./environment";

const PLAN: DeliveryPlan = {
  milestones: [
    { key: "M0", n: 0, name: "Foundation", demo: null },
    { key: "M1", n: 1, name: "Core Operations", demo: "2026-10-30" },
    { key: "M2", n: 2, name: "Productivity", demo: "2026-11-06" },
  ],
  screens: {
    "Home|overview": { m: "M1", api: true, delivered: true },
    "Home|team": { m: "M1", api: true, delivered: false },
    "Performance|goals": { m: "M2", api: false, delivered: false },
  },
};

afterEach(() => {
  document.documentElement.removeAttribute("data-env");
  localStorage.clear();
});

describe("openRule", () => {
  it("is mock for the in-browser mock, staging on a staging host or a dev server, production otherwise", () => {
    expect(openRule({ mode: "mock", dev: false, environment: "staging" })).toBe("mock");
    expect(openRule({ mode: "live", dev: false, environment: "staging" })).toBe("staging");
    expect(openRule({ mode: "live", dev: true, environment: "other" })).toBe("staging");
    expect(openRule({ mode: "live", dev: false, environment: "other" })).toBe("production");
  });
});

describe("screenOpens (F14)", () => {
  const s = PLAN.screens;
  it("production opens a screen with API, UI and Mobile ticked, and nothing unplanned", () => {
    expect(screenOpens(s["Home|overview"]!, "production", "full")).toBe(true);
    expect(screenOpens(s["Home|team"]!, "production", "full")).toBe(false);
    expect(screenOpens(null, "production", "full")).toBe(false);
  });

  it("staging opens a screen as soon as its API is ticked", () => {
    expect(screenOpens(s["Home|team"]!, "staging", "full")).toBe(true);
    expect(screenOpens(s["Performance|goals"]!, "staging", "full")).toBe(false);
  });

  it("mock opens everything in Full Design, and up to the current milestone As Delivered", () => {
    const m1 = PLAN.milestones[1];
    expect(screenOpens(s["Performance|goals"]!, "mock", "full", m1)).toBe(true);
    expect(screenOpens(s["Performance|goals"]!, "mock", "delivered", m1)).toBe(false);
    expect(screenOpens(s["Home|team"]!, "mock", "delivered", m1)).toBe(true);
  });
});

describe("currentMilestone", () => {
  it("is the earliest milestone neither past its demo day nor fully ticked", () => {
    expect(currentMilestone(PLAN, "2026-10-15")?.key).toBe("M1");
    expect(currentMilestone(PLAN, "2026-11-01")?.key).toBe("M2");
  });
});

describe("createDeliveryPlan", () => {
  it("binds the rule to the environment, re-rendering when staging is revealed", () => {
    const plan = createDeliveryPlan(PLAN, { viewKey: "mc-view-test", mode: "live", dev: false });
    const { result } = renderHook(() => plan.useScreenState("Home|team"));
    expect(result.current).toMatchObject({ open: false, rule: "production", production: true });
    act(() => markStaging());
    expect(result.current).toMatchObject({ open: true, rule: "staging", production: false });
  });

  it("keeps the Prototype View choice per browser in mock mode", () => {
    const plan = createDeliveryPlan(PLAN, { viewKey: "mc-view-test", mode: "mock", dev: true });
    const { result } = renderHook(() => ({ state: plan.useScreenState("Performance|goals"), view: plan.useView() }));
    expect(result.current.state.open).toBe(true);
    act(() => result.current.view.setView("delivered"));
    expect(localStorage.getItem("mc-view-test")).toBe("delivered");
    expect(result.current.view.view).toBe("delivered");
  });

  it("finds a screen, a milestone and the current milestone", () => {
    const plan = createDeliveryPlan(PLAN, { viewKey: "k", mode: "mock", dev: true });
    expect(plan.screenOf("Home|overview")?.m).toBe("M1");
    expect(plan.screenOf("Nope|x")).toBeNull();
    expect(plan.milestone("M2")?.name).toBe("Productivity");
    expect(plan.currentMilestone("2026-10-15")?.key).toBe("M1");
  });
});

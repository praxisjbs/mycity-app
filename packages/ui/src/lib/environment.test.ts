import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { initEnvironment, isStagingHost, markStaging, noteEnvironmentHeader, useEnvironment } from "./environment";

afterEach(() => {
  document.documentElement.removeAttribute("data-env");
  document.head.querySelectorAll('meta[name="theme-color"], link[rel="icon"]').forEach((n) => n.remove());
  window.history.replaceState(null, "", "/");
});

describe("environment", () => {
  it("knows a staging host", () => {
    expect(isStagingHost("hub.staging.mycityapp.io")).toBe(true);
    expect(isStagingHost("go.staging.mycityapp.io")).toBe(true);
    expect(isStagingHost("hub.mycityapp.io")).toBe(false);
  });

  it("marks staging: the attribute, the amber tab icon and the browser bar", () => {
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = "/favicon.svg";
    document.head.appendChild(icon);
    markStaging();
    expect(document.documentElement).toHaveAttribute("data-env", "staging");
    expect(icon.href).toMatch(/favicon-staging\.svg$/);
    expect(document.head.querySelector('meta[name="theme-color"]')).not.toBeNull();
  });

  it("re-renders when an API response says staging", () => {
    const { result } = renderHook(() => useEnvironment());
    expect(result.current).toBe("other");
    act(() => noteEnvironmentHeader("production"));
    expect(result.current).toBe("other");
    act(() => noteEnvironmentHeader("staging"));
    expect(result.current).toBe("staging");
  });

  it("takes ?env=staging only when allowed (development)", () => {
    window.history.replaceState(null, "", "/?env=staging");
    initEnvironment();
    expect(document.documentElement).not.toHaveAttribute("data-env");
    initEnvironment({ allowQuery: true });
    expect(document.documentElement).toHaveAttribute("data-env", "staging");
  });
});

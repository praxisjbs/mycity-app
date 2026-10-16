// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { install, installLater, noteVisit, resetPwaForTest, usePwa } from "./pwa";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetPwaForTest();
});

const prompt = (outcome: "accepted" | "dismissed") => Object.assign(new Event("beforeinstallprompt"), { prompt: async () => undefined, userChoice: Promise.resolve({ outcome }) });

describe("the installed app (PR 2 question 4)", () => {
  it("offers the banner from the second signed-in visit, counting once per browser session", () => {
    resetPwaForTest({ prompt: prompt("dismissed") as never });
    const { result } = renderHook(() => usePwa());
    act(() => noteVisit());
    act(() => noteVisit());
    expect(result.current).toMatchObject({ canInstall: true, banner: false });
    sessionStorage.clear();
    act(() => noteVisit());
    expect(result.current.banner).toBe(true);
  });

  it("Not Now holds the banner for 30 days", () => {
    resetPwaForTest({ prompt: prompt("dismissed") as never, visits: 3 });
    const { result } = renderHook(() => usePwa());
    expect(result.current.banner).toBe(true);
    act(() => installLater());
    expect(result.current.banner).toBe(false);
    expect(Number(localStorage.getItem("mc-install-later"))).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
  });

  it("offers nothing once installed", () => {
    resetPwaForTest({ prompt: prompt("dismissed") as never, visits: 5, installed: true });
    const { result } = renderHook(() => usePwa());
    expect(result.current).toMatchObject({ canInstall: false, banner: false });
  });

  it("installs through the browser's prompt, and shows the steps on an iPhone", async () => {
    resetPwaForTest({ prompt: prompt("accepted") as never });
    const { result } = renderHook(() => usePwa());
    await act(async () => expect(await install()).toBe("done"));
    expect(result.current.installed).toBe(true);
    resetPwaForTest({ ios: true });
    expect(await install()).toBe("steps");
  });
});

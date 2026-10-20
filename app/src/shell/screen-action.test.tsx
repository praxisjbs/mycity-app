// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { RouterProvider } from "@/lib/router";
import { ScreenActionProvider, useRegisteredAction, useRegisteredSecond, useScreenAction, useUrlAction } from "./screen-action";

const wrapper = ({ children }: { children: ReactNode }) => (
  <RouterProvider>
    <ScreenActionProvider>{children}</ScreenActionProvider>
  </RouterProvider>
);

const at = (url: string) => window.history.replaceState(null, "", url);

afterEach(() => {
  cleanup();
  at("/");
});

describe("opening a screen on an action (search's links)", () => {
  it("runs the New action once for ?action=new, and takes the word out of the address", () => {
    at("/ess?tab=my-leave&action=new");
    const open = vi.fn();
    const { result, rerender } = renderHook(
      () => {
        useScreenAction({ label: "Request Leave", onSelect: open });
        return useRegisteredAction();
      },
      { wrapper },
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?tab=my-leave");
    expect(result.current?.label).toBe("Request Leave");
    rerender();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("waits until the action is ready, and runs only the word it is given", () => {
    at("/ess?tab=my-security&action=pin");
    const password = vi.fn();
    const pin = vi.fn();
    const { rerender } = renderHook(({ ready }) => {
      useUrlAction("password", password);
      useUrlAction("pin", ready ? pin : null);
    }, { wrapper, initialProps: { ready: false } });
    expect(pin).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(pin).toHaveBeenCalledTimes(1);
    expect(password).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?tab=my-security");
  });

  it("registers once, however often the screen hands it a new function", async () => {
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        useScreenAction({ label: "Start Import", onSelect: () => undefined });
        return useRegisteredAction();
      },
      { wrapper },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current?.label).toBe("Start Import");
    expect(renders).toBeLessThan(5);
  });

  it("holds a second action beside the first, which ?action=new never runs", () => {
    at("/home?tab=overview&action=new");
    const task = vi.fn();
    const site = vi.fn();
    const { result } = renderHook(
      () => {
        useScreenAction({ label: "New Task", onSelect: task });
        useScreenAction({ label: "Add Work Site", icon: "pin", onSelect: site }, { second: true });
        return [useRegisteredAction(), useRegisteredSecond()];
      },
      { wrapper },
    );
    expect(result.current.map((a) => a?.label)).toEqual(["New Task", "Add Work Site"]);
    expect(task).toHaveBeenCalledTimes(1);
    expect(site).not.toHaveBeenCalled();
    result.current[1]?.onSelect();
    expect(site).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a screen opened without an action", () => {
    at("/settings?tab=users");
    const invite = vi.fn();
    renderHook(() => useScreenAction({ label: "Invite User", onSelect: invite }), { wrapper });
    expect(invite).not.toHaveBeenCalled();
  });
});

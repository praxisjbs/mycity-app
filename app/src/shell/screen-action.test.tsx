// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { RouterProvider } from "@/lib/router";
import { ScreenActionProvider, useAddressPrefill, useNewLink, useRegisteredAction, useRegisteredSecond, useScreenAction, useUrlAction } from "./screen-action";
import leave from "@mycity/contract/schemas/leave.js";

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

describe("a form filled from the address (Praxis AI's screen button)", () => {
  const TYPE = "4f5c2b9e-8c1d-4a7e-9b3f-2d6e1a0c5b7d";

  it("reads the fields its schema takes, once, and takes them out of the address", () => {
    at(`/ess?tab=my-leave&starts_on=2026-10-26&ends_on=2026-13-40&leave_type_id=${TYPE}&gross_monthly=900000.00`);
    const { result, rerender } = renderHook(() => useAddressPrefill(leave.LeaveRequestPrefill), { wrapper });
    // A day that is no day is left for the person; a field the schema does not have stays in the address.
    expect(result.current).toEqual({ starts_on: "2026-10-26", leave_type_id: TYPE });
    expect(window.location.search).toBe("?tab=my-leave&gross_monthly=900000.00");
    rerender();
    expect(result.current).toEqual({ starts_on: "2026-10-26", leave_type_id: TYPE });
  });

  it("an edit form reads and removes nothing", () => {
    at("/ess?tab=my-leave&starts_on=2026-10-26");
    const { result } = renderHook(() => useAddressPrefill(leave.LeaveRequestPrefill, false), { wrapper });
    expect(result.current).toEqual({});
    expect(window.location.search).toBe("?tab=my-leave&starts_on=2026-10-26");
  });

  it.each([
    ["the assistant's ?new=1", "new=1"],
    ["⌘K's ?action=new", "action=new"],
  ])("opened by %s, the form the action opens is filled and the address is left clean", (_how, ask) => {
    at(`/ess?tab=my-leave&${ask}&starts_on=2026-10-26&reason=Family`);
    let filled = {};
    let opened = 0;
    function Filled() {
      filled = useAddressPrefill(leave.LeaveRequestPrefill);
      return null;
    }
    function Screen() {
      const [open, setOpen] = useState(false);
      const request = () => {
        opened += 1;
        setOpen(true);
      };
      useScreenAction({ label: "Request Leave", onSelect: request });
      useNewLink(request);
      return open ? <Filled /> : null;
    }
    render(<Screen />, { wrapper });
    expect(opened).toBe(1);
    expect(filled).toEqual({ starts_on: "2026-10-26", reason: "Family" });
    expect(window.location.search).toBe("?tab=my-leave");
  });
});

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { installOverlayTestEnv } from "../overlay/test-env";
import { setViewport } from "../testing/viewport";
import { NavCapsule, type NavCapsuleProps } from "./NavCapsule";
import { TRAIL_ITEMS } from "./fixtures";

beforeAll(installOverlayTestEnv);
afterEach(() => {
  vi.useRealTimers();
  setViewport(1440);
});

const capsule = (props: Partial<NavCapsuleProps> = {}) => (
  <NavCapsule back="Employees" forward="Runs" onBack={vi.fn()} onForward={vi.fn()} onRefresh={() => Promise.resolve()} onReload={vi.fn()} trail={TRAIL_ITEMS} onGo={vi.fn()} {...props} />
);

describe("NavCapsule", () => {
  it("goes back and forward, and says so when there is nowhere to go", async () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const { rerender } = render(capsule({ onBack, onForward }));
    expect(screen.getByRole("group", { name: "History" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onForward).toHaveBeenCalledTimes(1);
    rerender(capsule({ onBack, onForward, back: null, forward: null }));
    expect(screen.getByRole("button", { name: "Back" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a browser tab shows refresh alone", () => {
    render(capsule({ arrows: false }));
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("a click refreshes in place and stays busy until the reads are in", async () => {
    let finish!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const onReload = vi.fn();
    render(capsule({ onRefresh, onReload }));
    const refresh = screen.getByRole("button", { name: "Refresh" });
    await userEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveAttribute("aria-busy", "true");
    await userEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(refresh).not.toHaveAttribute("aria-busy");
    expect(onReload).not.toHaveBeenCalled();
  });

  it("held, the ring closes and the app reloads, and the press does not refresh as well", () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn(() => Promise.resolve());
    const onReload = vi.fn();
    render(capsule({ onRefresh, onReload }));
    const refresh = screen.getByRole("button", { name: "Refresh" });
    fireEvent.pointerDown(refresh, { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(200));
    expect(refresh).toHaveAttribute("data-holding");
    act(() => vi.advanceTimersByTime(600));
    expect(onReload).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(refresh, { pointerId: 1 });
    fireEvent.click(refresh);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("let go before the ring closes, it is a plain refresh; Shift and Enter reload from the keyboard", () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn(() => Promise.resolve());
    const onReload = vi.fn();
    render(capsule({ onRefresh, onReload }));
    const refresh = screen.getByRole("button", { name: "Refresh" });
    fireEvent.pointerDown(refresh, { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(400));
    fireEvent.pointerUp(refresh, { pointerId: 1 });
    expect(refresh).not.toHaveAttribute("data-holding");
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.keyDown(refresh, { key: "Enter", shiftKey: true });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("a right click or Arrow Down on an arrow opens the trail, and a place takes the person there", async () => {
    const onGo = vi.fn();
    render(capsule({ onGo }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "Back" }));
    const trail = await screen.findByRole("menu", { name: "Trail" });
    expect(trail).toHaveTextContent("Inbox");
    expect(screen.getByRole("menuitem", { name: /^Employees/ })).toHaveFocus();
    await userEvent.click(screen.getByRole("menuitem", { name: /Overview/ }));
    expect(onGo).toHaveBeenCalledWith(-2);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Forward" }), { key: "ArrowDown" });
    expect(await screen.findByRole("menu", { name: "Trail" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(capsule());
    expect(await axe(container)).toHaveNoViolations();
  });
});

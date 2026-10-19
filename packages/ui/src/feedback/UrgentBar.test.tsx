import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { UrgentBar } from "./UrgentBar";

describe("UrgentBar", () => {
  it("shows the notice in an alert region with its one action", async () => {
    const onAction = vi.fn(async () => undefined);
    render(<UrgentBar title="Fire drill at 11" actionLabel="Acknowledge" onAction={onAction} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Fire drill at 11");
    expect(screen.queryByText(/of/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("opens the notice from its title, and steps through several", async () => {
    const onOpen = vi.fn();
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    render(<UrgentBar title="Access change: A role was created" position={2} count={3} actionLabel="Open" onAction={() => undefined} onOpen={onOpen} onNext={onNext} onPrevious={onPrevious} />);
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Access change: A role was created"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Next Notice" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous Notice" }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("a swipe sideways steps on a phone; a short drag does nothing", () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    render(<UrgentBar title="Fire drill at 11" position={1} count={2} actionLabel="Acknowledge" onAction={() => undefined} onNext={onNext} onPrevious={onPrevious} />);
    const bar = screen.getByRole("alert");
    fireEvent.touchStart(bar, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(bar, { changedTouches: [{ clientX: 100 }] });
    fireEvent.touchStart(bar, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(bar, { changedTouches: [{ clientX: 220 }] });
    fireEvent.touchStart(bar, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(bar, { changedTouches: [{ clientX: 120 }] });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<UrgentBar title="Fire drill at 11" position={1} count={2} actionLabel="Acknowledge" onAction={() => undefined} onNext={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

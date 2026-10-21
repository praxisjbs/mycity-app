import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useHold, type HoldOptions } from "./hold";

function Target({ onClick, ...opts }: HoldOptions & { onClick: () => void }) {
  const hold = useHold(opts);
  return (
    <button type="button" onClick={onClick} {...hold}>
      Back
    </button>
  );
}

afterEach(() => vi.useRealTimers());

describe("useHold", () => {
  it("a press that lasts is a hold, and the click after it is swallowed", () => {
    vi.useFakeTimers();
    const onHold = vi.fn();
    const onClick = vi.fn();
    render(<Target onHold={onHold} onClick={onClick} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(460));
    expect(onHold).toHaveBeenCalledOnce();
    // The phone also calls the long press a context menu: no second hold, no menu of its own.
    expect(fireEvent.contextMenu(button)).toBe(false);
    fireEvent.pointerUp(button, { pointerId: 1 });
    fireEvent.click(button);
    expect(onHold).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("a short press stays a click; a right click or the menu key holds at once, swallowing nothing after", () => {
    vi.useFakeTimers();
    const onHold = vi.fn();
    const onClick = vi.fn();
    const onHoldStart = vi.fn();
    const onHoldCancel = vi.fn();
    render(<Target onHold={onHold} onClick={onClick} ms={700} showAfter={150} onHoldStart={onHoldStart} onHoldCancel={onHoldCancel} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(300));
    expect(onHoldStart).toHaveBeenCalledOnce();
    fireEvent.pointerUp(button, { pointerId: 1 });
    expect(onHoldCancel).toHaveBeenCalledOnce();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(onHold).not.toHaveBeenCalled();
    fireEvent.contextMenu(button);
    expect(onHold).toHaveBeenCalledOnce();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

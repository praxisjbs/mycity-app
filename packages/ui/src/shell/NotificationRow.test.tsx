import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { NotificationRow } from "./NotificationRow";

afterEach(() => setViewport(1440));

describe("NotificationRow", () => {
  it("is one button: a click opens it, and unread is said in words as well as by the dot", async () => {
    const onOpen = vi.fn();
    render(<NotificationRow title="Tom-Blake Asaah" body="Re: Test mail" when="05:33" avatar="Tom-Blake Asaah" unread onOpen={onOpen} />);
    const row = screen.getByRole("button", { name: /Tom-Blake Asaah, Unread/ });
    expect(row).toHaveTextContent("Re: Test mail");
    expect(row).toHaveTextContent("05:33");
    await userEvent.click(row);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("offers Mark Read on desktop while unread, and not once read", async () => {
    const onMarkRead = vi.fn();
    const { rerender } = render(<NotificationRow title="Approval needed" when="08:41" unread onOpen={() => undefined} onMarkRead={onMarkRead} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark Read" }));
    expect(onMarkRead).toHaveBeenCalledOnce();
    rerender(<NotificationRow title="Approval needed" when="08:41" onOpen={() => undefined} onMarkRead={onMarkRead} />);
    expect(screen.queryByRole("button", { name: "Mark Read" })).not.toBeInTheDocument();
    expect(screen.getByRole("article")).not.toHaveTextContent("Unread");
  });

  it("on a phone, a swipe to the left marks it read and does not open it", () => {
    setViewport(390);
    const onOpen = vi.fn();
    const onMarkRead = vi.fn();
    render(<NotificationRow title="Approval needed" when="08:41" unread onOpen={onOpen} onMarkRead={onMarkRead} />);
    const button = screen.getByRole("button", { name: /Approval needed/ });
    const surface = button.parentElement!;
    fireEvent.pointerDown(surface, { pointerType: "touch", clientX: 300, clientY: 20 });
    fireEvent.pointerMove(surface, { pointerType: "touch", clientX: 260, clientY: 22 });
    fireEvent.pointerMove(surface, { pointerType: "touch", clientX: 200, clientY: 23 });
    fireEvent.pointerUp(surface, { pointerType: "touch", clientX: 200, clientY: 23 });
    fireEvent.click(button);
    expect(onMarkRead).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ul>
        <li>
          <NotificationRow title="Expense request waiting on you" body="₦185,000.00" when="08:41" tone="warn" icon="check" unread onOpen={() => undefined} onMarkRead={() => undefined} />
        </li>
        <li>
          <NotificationRow title="You were recognised" when="Yesterday" tone="ok" icon="thumb" onOpen={() => undefined} />
        </li>
      </ul>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

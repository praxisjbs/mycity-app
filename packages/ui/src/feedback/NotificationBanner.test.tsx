import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Toaster } from "./Toaster";
import { NotificationBanner, notify } from "./NotificationBanner";

describe("NotificationBanner", () => {
  it("is one button that opens it, with a Dismiss button beside it", async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(<NotificationBanner title="Tom-Blake Asaah" body="Re: Test mail" avatar="Tom-Blake Asaah" onOpen={onOpen} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: /Tom-Blake Asaah/ }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("notify() shows it in the top Toaster, once per id, and a tap opens and closes it", async () => {
    const onOpen = vi.fn();
    render(<Toaster />);
    notify({ id: "n-1", title: "Ada Okafor", body: "Lunch is here!", onOpen });
    notify({ id: "n-1", title: "Ada Okafor", body: "Lunch is here!", onOpen });
    const region = await screen.findByRole("region", { name: /New Notifications/ });
    expect(await screen.findAllByRole("button", { name: /Ada Okafor/ })).toHaveLength(1);
    expect(region).toHaveTextContent("Lunch is here!");
    await userEvent.click(screen.getByRole("button", { name: /Ada Okafor/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<NotificationBanner title="Approval needed: Leave request" body="Line manager is waiting on you." icon="check" tone="warn" onDismiss={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

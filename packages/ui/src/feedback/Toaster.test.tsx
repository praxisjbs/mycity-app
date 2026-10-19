import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { Toaster, Toasts } from "./Toaster";
import { toast } from "./toast";
import { installOverlayTestEnv } from "../overlay/test-env";

// Sonner captures the pointer on press (swipe to dismiss), which jsdom lacks.
beforeAll(installOverlayTestEnv);

const region = () => screen.getByRole("region", { name: /^Notifications/ });

describe("Toaster and toast", () => {
  it("keeps the merged call shape: toast(text) shows a success in a polite live region", async () => {
    render(<Toaster />);
    act(() => void toast("Rule created"));
    expect(await screen.findByText("Rule created")).toBeInTheDocument();
    expect(region()).toHaveAttribute("aria-live", "polite");
    const item = screen.getByText("Rule created").closest("[data-sonner-toast]");
    expect(item).toHaveAttribute("data-type", "success");
    act(() => toast.dismiss());
  });

  it("shows error and info kinds", async () => {
    render(<Toaster />);
    act(() => {
      toast.error("Could not save the draft");
      toast.info("Mailbox up to date");
    });
    expect((await screen.findByText("Could not save the draft")).closest("[data-sonner-toast]")).toHaveAttribute("data-type", "error");
    expect(screen.getByText("Mailbox up to date").closest("[data-sonner-toast]")).toHaveAttribute("data-type", "info");
    act(() => toast.dismiss());
  });

  it("carries Undo, which calls back and closes the toast", async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    render(<Toaster />);
    act(() => void toast("Alert cleared", { undo }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
  });

  it("sits bottom right on desktop and above the bottom bar on a phone", async () => {
    const { container, unmount } = render(<Toaster />);
    act(() => void toast("Clocked in", { id: "pos" }));
    await screen.findByText("Clocked in");
    expect(container.querySelector("[data-sonner-toaster]")).toHaveAttribute("data-x-position", "right");
    act(() => toast.dismiss());
    unmount();
    setViewport(390);
    const phone = render(<Toaster />);
    act(() => void toast("Clocked out"));
    await screen.findByText("Clocked out");
    const list = phone.container.querySelector<HTMLElement>("[data-sonner-toaster]");
    expect(list).toHaveAttribute("data-x-position", "center");
    expect(list?.style.getPropertyValue("--offset-bottom")).toContain("--bottom-bar");
    act(() => toast.dismiss());
  });

  it("warns in development past 8 words", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<Toaster />);
    act(() => void toast("Payslips are being emailed to every member of staff today"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("limit 8"));
    act(() => toast.dismiss());
  });

  it("keeps the merged Toasts name", () => {
    expect(Toasts).toBe(Toaster);
  });

  it("has no accessibility violations with a toast showing", async () => {
    const { container } = render(<Toaster />);
    act(() => void toast("Leave approved", { undo: () => undefined }));
    await screen.findByText("Leave approved");
    expect(await axe(container)).toHaveNoViolations();
    act(() => toast.dismiss());
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { installOverlayTestEnv } from "../overlay/test-env";
import { Details } from "./Details";

beforeAll(installOverlayTestEnv);

const ITEMS: Array<[string, string]> = [
  ["Grace Period", "10 minutes"],
  ["Counts From", "Shift start"],
];

describe("Details", () => {
  it("is one closed row, its body hidden but in the DOM", () => {
    render(<Details items={ITEMS} />);
    const row = screen.getByRole("button", { name: "Details" });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(row).toHaveAttribute("data-ui", "button");
    const body = document.getElementById(row.getAttribute("aria-controls") ?? "");
    expect(body).toHaveAttribute("data-ui", "details");
    expect(body).not.toBeVisible();
    expect(body).toHaveTextContent("Grace Period10 minutes");
  });

  it("expands inline on desktop, by click and by keyboard", async () => {
    const user = userEvent.setup();
    render(<Details items={ITEMS}>Late punches after the grace period go to the manager.</Details>);
    const row = screen.getByRole("button", { name: "Details" });
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("10 minutes")).toBeVisible();
    expect(screen.getByText("Late punches after the grace period go to the manager.")).toBeVisible();
    await user.keyboard("{Enter}");
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("10 minutes")).not.toBeVisible();
  });

  it("starts closed on every visit", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Details items={ITEMS} />);
    await user.click(screen.getByRole("button", { name: "Details" }));
    unmount();
    render(<Details items={ITEMS} />);
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a bottom sheet on a phone", async () => {
    setViewport(390);
    const user = userEvent.setup();
    render(<Details items={ITEMS} title="Work Schedule" />);
    const row = screen.getByRole("button", { name: "Details" });
    expect(row).toHaveAttribute("aria-haspopup", "dialog");
    expect(row.className).toContain("phone:min-h-tap");
    await user.click(row);
    const sheet = screen.getByRole("dialog", { name: "Work Schedule" });
    expect(sheet.querySelector('[data-ui="details"]')).toHaveTextContent("Shift start");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(row).toHaveAttribute("aria-expanded", "false");
  });

  it("warns in development past 60 words", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<Details>{Array.from({ length: 61 }, () => "word").join(" ")}</Details>);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("limit 60"));
  });

  it("has no accessibility violations, closed and open", async () => {
    const user = userEvent.setup();
    const { container } = render(<Details items={ITEMS} />);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

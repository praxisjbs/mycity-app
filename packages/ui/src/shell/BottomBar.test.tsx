import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { BottomBar } from "./BottomBar";
import { BOTTOM_ITEMS } from "./fixtures";

describe("BottomBar", () => {
  it("is the Main navigation with the five places, the current one marked", () => {
    setViewport(390);
    render(<BottomBar items={BOTTOM_ITEMS(() => undefined)} current="community" />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toHaveAttribute("data-ui", "phone-nav");
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getByRole("link", { name: /Community/ })).toHaveAttribute("aria-current", "page");
  });

  it("an urgent place shows its count in red, at least 1", () => {
    setViewport(390);
    const items = BOTTOM_ITEMS(() => undefined).map((i) => (i.key === "community" ? { ...i, count: 0, urgent: true } : i));
    render(<BottomBar items={items} current="home" />);
    expect(screen.getByRole("link", { name: /Community/ })).toHaveTextContent("1");
  });

  it("navigates on a tap, and More opens its sheet", async () => {
    setViewport(390);
    const onNavigate = vi.fn();
    const openMore = vi.fn();
    render(<BottomBar items={BOTTOM_ITEMS(openMore)} current="home" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole("link", { name: /Workspace/ }));
    expect(onNavigate).toHaveBeenCalledWith("#/BottomBar");
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-haspopup", "dialog");
    await userEvent.click(more);
    expect(openMore).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    setViewport(390);
    const { container } = render(<BottomBar items={BOTTOM_ITEMS(() => undefined)} current="home" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

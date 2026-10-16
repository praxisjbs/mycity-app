import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { IconButton } from "../actions/Button";
import { PhoneHeader } from "./PhoneHeader";
import { ShellScrollContext } from "./scroll";

const header = (onNavigate?: (href: string) => void) => (
  <PhoneHeader title="Employee Self-Service" homeHref="/home" onNavigate={onNavigate} actions={<IconButton icon="bell" label="Notifications" />} />
);

describe("PhoneHeader", () => {
  it("has the pin as a link home, the actions, and the module's name", async () => {
    setViewport(390);
    const onNavigate = vi.fn();
    render(header(onNavigate));
    await userEvent.click(screen.getByRole("link", { name: "MyCity App, Home" }));
    expect(onNavigate).toHaveBeenCalledWith("/home");
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByText("Employee Self-Service")).toHaveAttribute("data-ui", "title");
  });

  it("slides the title away while the page scrolls down", () => {
    setViewport(390);
    render(<ShellScrollContext.Provider value={{ direction: "down", atTop: false }}>{header()}</ShellScrollContext.Provider>);
    expect(screen.getByText("Employee Self-Service").parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the title at the top of the page even when the last move was down", () => {
    setViewport(390);
    render(<ShellScrollContext.Provider value={{ direction: "down", atTop: true }}>{header()}</ShellScrollContext.Provider>);
    expect(screen.getByText("Employee Self-Service").parentElement).not.toHaveAttribute("aria-hidden");
  });

  it("has no accessibility violations", async () => {
    setViewport(390);
    const { container } = render(header());
    expect(await axe(container)).toHaveNoViolations();
  });
});

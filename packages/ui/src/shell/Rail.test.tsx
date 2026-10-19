import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { installOverlayTestEnv } from "../overlay/test-env";
import { Rail } from "./Rail";
import { RAIL_ITEMS } from "./fixtures";

const account = (signOut = vi.fn()) => ({ name: "Cynthia Osakunih", subtitle: "Operations Manager", menu: [{ label: "Sign Out", icon: "logout" as const, onSelect: signOut }] });

beforeAll(installOverlayTestEnv);

describe("Rail", () => {
  it("is a named navigation with the current module marked, grouped by area, with counts", () => {
    render(<Rail items={RAIL_ITEMS} current="people" />);
    const nav = screen.getByRole("navigation", { name: "Modules" });
    expect(screen.getByRole("link", { name: /^People/ })).toHaveAttribute("aria-current", "page");
    expect(nav).toHaveTextContent("Work");
    expect(nav).toHaveTextContent("Business");
    expect(screen.getByRole("link", { name: /Mailbox/ })).toHaveTextContent("12");
  });

  it("an urgent module's count shows red, at least 1", () => {
    const items = RAIL_ITEMS.map((i) => (i.key === "community" ? { ...i, count: undefined, urgent: true } : i));
    render(<Rail items={items} current="home" />);
    const link = screen.getByRole("link", { name: /Community/ });
    expect(link).toHaveTextContent("1");
    expect(link.querySelector("[data-urgent]")).not.toBeNull();
  });

  it("navigates through the app on a plain click, and leaves a modified click to the browser", async () => {
    const onNavigate = vi.fn();
    render(<Rail items={RAIL_ITEMS} current="home" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole("link", { name: /Expenses/ }));
    expect(onNavigate).toHaveBeenCalledWith("#/Rail");
  });

  it("collapsed, keeps every item's name for screen readers and in our tooltip, never a browser title", async () => {
    render(<Rail items={RAIL_ITEMS} current="home" collapsed account={account()} />);
    const link = screen.getByRole("link", { name: /Staff Community/ });
    expect(link).not.toHaveAttribute("title");
    await userEvent.hover(link);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Staff Community");
    expect(screen.getByRole("button", { name: "Cynthia Osakunih" })).toBeInTheDocument();
  });

  it("opens the person's menu from the foot", async () => {
    const signOut = vi.fn();
    render(<Rail items={RAIL_ITEMS} current="home" account={account(signOut)} />);
    await userEvent.click(screen.getByRole("button", { name: /Cynthia Osakunih/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign Out" }));
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Rail items={RAIL_ITEMS} current="people" account={account()} foot="Engineered by JBS Praxis" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

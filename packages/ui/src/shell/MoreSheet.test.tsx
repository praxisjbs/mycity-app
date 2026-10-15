import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { installOverlayTestEnv } from "../overlay/test-env";
import { setViewport } from "../testing/viewport";
import { IconButton } from "../actions/Button";
import { MoreSheet } from "./MoreSheet";
import { MORE_GROUPS } from "./fixtures";

const sheet = (over: Partial<Parameters<typeof MoreSheet>[0]> = {}) => (
  <MoreSheet
    open
    onClose={vi.fn()}
    person={{ name: "Cynthia Osakunih", subtitle: "Operations Manager" }}
    personActions={<IconButton icon="moon" label="Dark Theme" />}
    groups={MORE_GROUPS}
    onSignOut={vi.fn()}
    {...over}
  />
);

beforeAll(installOverlayTestEnv);

describe("MoreSheet", () => {
  it("is a dialog named More with the person, the search bar, the groups and Sign Out", () => {
    setViewport(390);
    render(sheet({ onSearch: vi.fn() }));
    const dialog = screen.getByRole("dialog", { name: "More" });
    expect(within(dialog).getByRole("group", { name: "Your Account" })).toHaveTextContent("Cynthia Osakunih");
    expect(within(dialog).getByRole("button", { name: "Search" })).toBeInTheDocument();
    for (const g of ["Work", "People", "Business", "System"]) expect(within(dialog).getByRole("heading", { name: g })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
  });

  it("a tile navigates and closes the sheet", async () => {
    setViewport(390);
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(sheet({ onNavigate, onClose, current: "people" }));
    expect(screen.getByRole("link", { name: /^People/ })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("link", { name: /Payroll/ }));
    expect(onNavigate).toHaveBeenCalledWith("#/MoreSheet");
    expect(onClose).toHaveBeenCalled();
  });

  it("signs out and opens search", async () => {
    setViewport(390);
    const onSignOut = vi.fn();
    const onSearch = vi.fn();
    render(sheet({ onSignOut, onSearch }));
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onSearch).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    setViewport(390);
    render(sheet({ onSearch: vi.fn() }));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

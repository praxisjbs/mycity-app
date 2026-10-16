import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { IconButton } from "../actions/Button";
import { SearchButton, TopBar } from "./TopBar";

describe("TopBar", () => {
  it("holds the toggle, the search button and the actions", () => {
    render(<TopBar start={<IconButton icon="panel" label="Collapse Menu" />} search={<SearchButton onClick={() => undefined} />} actions={<IconButton icon="bell" label="Notifications" />} />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Menu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Search Anything/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("the search button opens the palette and names its shortcut", async () => {
    const onClick = vi.fn();
    render(<SearchButton onClick={onClick} />);
    const button = screen.getByRole("button", { name: /Search Anything/ });
    expect(button).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<TopBar search={<SearchButton onClick={() => undefined} />} actions={<IconButton icon="bell" label="Notifications" dot />} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

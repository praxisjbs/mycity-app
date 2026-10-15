import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { IconButton } from "../actions/Button";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("shows on keyboard focus and hides on Esc", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Notifications">
        <IconButton icon="bell" label="Notifications" />
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Notifications" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Notifications");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows after a hover", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Search" delay={0}>
        <IconButton icon="srch" label="Search" />
      </Tooltip>,
    );
    await user.hover(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Search");
  });

  it("renders nothing extra on a phone", async () => {
    setViewport(390);
    const user = userEvent.setup();
    render(
      <Tooltip label="Notifications">
        <IconButton icon="bell" label="Notifications" />
      </Tooltip>,
    );
    await user.tab();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByRole("button", { name: "Notifications" })).not.toHaveAttribute("data-state");
  });

  it("has no accessibility violations", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Tooltip label="Notifications">
        <IconButton icon="bell" label="Notifications" />
      </Tooltip>,
    );
    await user.tab();
    await screen.findByRole("tooltip");
    expect(await axe(container)).toHaveNoViolations();
  });
});

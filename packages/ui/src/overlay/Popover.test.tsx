import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { Button } from "../actions/Button";
import { Popover } from "./Popover";
import { installOverlayTestEnv } from "./test-env";

beforeAll(installOverlayTestEnv);

const filters = (close: () => void) => (
  <div className="flex flex-col gap-2">
    <Button onClick={close}>Annual Leave</Button>
    <Button onClick={close}>Sick Leave</Button>
  </div>
);

describe("Popover on desktop", () => {
  it("opens a named panel from its button and closes on Esc, returning focus", async () => {
    const user = userEvent.setup();
    render(
      <Popover title="Filter Leave" trigger={<Button icon="flag">Filters</Button>}>
        {filters}
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Filters" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Filter Leave" })).not.toHaveAttribute("data-vaul-drawer");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("gives the content its close", async () => {
    const user = userEvent.setup();
    render(
      <Popover title="Filter Leave" trigger={<Button>Filters</Button>}>
        {filters}
      </Popover>,
    );
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByRole("button", { name: "Sick Leave" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    render(
      <Popover open title="Filter Leave" trigger={<Button>Filters</Button>}>
        {filters}
      </Popover>,
    );
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe("Popover on a phone", () => {
  it("opens a bottom sheet titled for the content", async () => {
    setViewport(390);
    const user = userEvent.setup();
    render(
      <Popover title="Filter Leave" trigger={<Button>Filters</Button>}>
        {filters}
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Filters" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const sheet = screen.getByRole("dialog", { name: "Filter Leave" });
    expect(sheet).toHaveAttribute("data-vaul-drawer");
    expect(sheet.querySelector('[data-ui="title"]')).toHaveTextContent("Filter Leave");
    await user.click(screen.getByRole("button", { name: "Annual Leave" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

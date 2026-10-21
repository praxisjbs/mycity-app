import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { installOverlayTestEnv } from "../overlay/test-env";
import { setViewport } from "../testing/viewport";
import { TrailMenu } from "./TrailMenu";
import { TRAIL_ITEMS } from "./fixtures";

beforeAll(installOverlayTestEnv);
afterEach(() => setViewport(1440));

describe("TrailMenu", () => {
  it("lists the places, the one on screen marked Now, each saying how far it is", async () => {
    render(
      <TrailMenu open onOpenChange={() => undefined} items={TRAIL_ITEMS} onGo={() => undefined}>
        <button type="button">Back</button>
      </TrailMenu>,
    );
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["RunsPayrollAhead", "Ada ObiPeople · EmployeesNow", "EmployeesPeople1 Back", "OverviewHome2 Back", "InboxMailbox3 Back"]);
    expect(items[1]).toHaveAttribute("aria-current", "page");
  });

  it("goes to a place and closes; the place on screen just closes; arrows move", async () => {
    const onGo = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <TrailMenu open onOpenChange={onOpenChange} items={TRAIL_ITEMS} onGo={onGo}>
        <button type="button">Back</button>
      </TrailMenu>,
    );
    expect(await screen.findByRole("menuitem", { name: /Employees.*1 Back/ })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Overview/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onGo).toHaveBeenCalledWith(-2);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("menuitem", { name: /Ada Obi/ }));
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it("is a sheet on a phone, with 44 px rows", async () => {
    setViewport(390);
    render(<TrailMenu open onOpenChange={() => undefined} items={TRAIL_ITEMS} onGo={() => undefined} />);
    expect(await screen.findByRole("dialog", { name: "Trail" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")[0]).toHaveClass("min-h-tap");
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <TrailMenu open onOpenChange={() => undefined} items={TRAIL_ITEMS} onGo={() => undefined}>
        <button type="button">Back</button>
      </TrailMenu>,
    );
    await screen.findAllByRole("menuitem");
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});

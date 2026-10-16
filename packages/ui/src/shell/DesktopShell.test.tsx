import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { DesktopShell } from "./DesktopShell";
import { Rail } from "./Rail";
import { SearchButton, TopBar } from "./TopBar";
import { ShellNotice } from "./ShellNotice";
import { RAIL_ITEMS } from "./fixtures";

const frame = (fit = false) => (
  <DesktopShell
    fit={fit}
    rail={<Rail items={RAIL_ITEMS} current="people" />}
    topBar={<TopBar search={<SearchButton onClick={() => undefined} />} />}
    tabs={<div role="tablist" aria-label="People" />}
    notice={<ShellNotice>A new version is ready</ShellNotice>}
  >
    <h1>Employees</h1>
    <div>
      <p>Panes</p>
    </div>
  </DesktopShell>
);

describe("DesktopShell", () => {
  it("lays out the rail, the top bar, the tabs and the page as the main landmark the gates read", () => {
    render(frame());
    expect(screen.getByRole("main")).toHaveAttribute("data-ui", "scroller");
    expect(screen.getByRole("main").querySelector("[data-ui=page]")).toHaveTextContent("Employees");
    expect(document.querySelector("[data-ui=desktop-nav]")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("A new version is ready");
  });

  it("a fit page does not scroll as a page, and slides its header away past a pane's end", () => {
    render(frame(true));
    const main = screen.getByRole("main");
    expect(main).toHaveClass("overflow-y-hidden");
    const page = main.querySelector("[data-ui=page]")!;
    expect(page).toHaveClass("fit-page");
    fireEvent.wheel(main, { deltaY: 40 });
    expect(page).toHaveClass("hidehead");
    fireEvent.wheel(main, { deltaY: -40 });
    expect(page).not.toHaveClass("hidehead");
  });

  it("draws no main landmark inside another page", () => {
    render(<DesktopShell landmarks={false} rail={null} topBar={null}><p>Page</p></DesktopShell>);
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(frame());
    expect(await axe(container)).toHaveNoViolations();
  });
});

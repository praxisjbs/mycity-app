import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { SplitPanes, useSplitPanes, type SplitState } from "./SplitPanes";

beforeEach(() => {
  setViewport(1440);
  try {
    localStorage.clear();
  } catch {
    /* a private window has none; the hook falls back to its default */
  }
});

/** Renders the hook beside the panes, as a screen does. */
function Screen({ initial = 320, open, aside }: { initial?: number; open?: boolean; aside?: boolean }) {
  const split = useSplitPanes("test", initial);
  return <SplitPanes split={split} list={<p>The list</p>} detail={<p>The record</p>} aside={aside ? <p>The aside</p> : undefined} open={open} />;
}

const state = (width = 320): SplitState => ({ width, onDragStart: vi.fn(), nudge: vi.fn() });

describe("SplitPanes on desktop", () => {
  it("puts the list, the divider and the record side by side", () => {
    render(<Screen />);
    expect(screen.getByText("The list")).toBeInTheDocument();
    expect(screen.getByText("The record")).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize the list" })).toBeInTheDocument();
  });

  it("holds the list's width in a CSS variable the layout reads", () => {
    const { container } = render(<Screen initial={360} />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.getPropertyValue("--pane")).toBe("360px");
    expect(grid.className).toContain("cols-panes");
  });

  it("makes room for a third pane when the screen gives one", () => {
    const { container } = render(<Screen aside />);
    expect(screen.getByText("The aside")).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).className).toContain("cols-panes-aside");
  });

  it("says how wide the list is, so it can be resized without a pointer", () => {
    render(<Screen initial={300} />);
    const divider = screen.getByRole("separator");
    expect(divider).toHaveAttribute("aria-orientation", "vertical");
    expect(divider).toHaveAttribute("aria-valuenow", "300");
    expect(divider).toHaveAttribute("aria-valuemin", "220");
    expect(divider).toHaveAttribute("aria-valuemax", "480");
  });

  it("the arrow keys move the divider, and it stops at each end", async () => {
    render(<Screen initial={240} />);
    const divider = screen.getByRole("separator");
    divider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(divider).toHaveAttribute("aria-valuenow", "260");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(divider).toHaveAttribute("aria-valuenow", "220");
    for (let i = 0; i < 20; i += 1) await userEvent.keyboard("{ArrowRight}");
    expect(divider).toHaveAttribute("aria-valuenow", "480");
  });

  it("remembers the width on this device, and starts at the default without one", async () => {
    render(<Screen initial={300} />);
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{ArrowRight}");
    // The width is stored when a drag ends, not on a nudge, so the default holds here.
    expect(localStorage.getItem("mc-split-test")).toBeNull();
    localStorage.setItem("mc-split-test", "412");
    const second = render(<Screen initial={300} />);
    expect(second.getAllByRole("separator").at(-1)).toHaveAttribute("aria-valuenow", "412");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<SplitPanes split={state()} list={<p>The list</p>} detail={<p>The record</p>} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("SplitPanes on a phone", () => {
  beforeEach(() => setViewport(390));

  it("gives the list the screen, with no divider at all", () => {
    render(<Screen />);
    expect(screen.getByText("The list")).toBeInTheDocument();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.queryByText("The record")).toBeNull();
  });

  it("covers the list when a record is open, keeping the safe area clear", () => {
    render(<Screen open />);
    const record = screen.getByText("The record").parentElement!;
    expect(record.className).toContain("pt-safe");
    expect(record.className).toContain("top-(--env-bar)");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<SplitPanes split={state()} list={<p>The list</p>} detail={<p>The record</p>} open />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

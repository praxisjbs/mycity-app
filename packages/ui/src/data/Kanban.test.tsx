import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { installOverlayTestEnv } from "../overlay/test-env";
import { Kanban, type KanbanColumn } from "./Kanban";

beforeAll(installOverlayTestEnv);
beforeEach(() => setViewport(1440));

const COLUMNS: KanbanColumn[] = [
  { key: "lead", label: "Lead", count: 12, cards: [{ key: "c1", title: "Lagos Water Board", owner: "Ada Obi" }] },
  { key: "qualified", label: "Qualified", count: 8, cards: [{ key: "c2", title: "Ikeja Mall" }] },
  { key: "signed", label: "Signed", count: 4, cards: [] },
];

describe("Kanban on desktop", () => {
  it("draws a named column per stage with its count", () => {
    render(<Kanban columns={COLUMNS} />);
    expect(screen.getByRole("region", { name: "Lead" })).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Lagos Water Board")).toBeInTheDocument();
  });

  it("falls back to the cards it holds when the server sends no count", () => {
    render(<Kanban columns={[{ key: "lead", label: "Lead", cards: COLUMNS[0]!.cards }]} />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("opens a card's record", async () => {
    const onOpen = vi.fn();
    render(<Kanban columns={COLUMNS} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /Lagos Water Board/ }));
    expect(onOpen).toHaveBeenCalledWith("c1", "lead");
  });

  it("offers Move To as a real menu, so a card moves without dragging", async () => {
    const onMove = vi.fn();
    render(<Kanban columns={COLUMNS} onMove={onMove} />);
    const lead = screen.getByRole("region", { name: "Lead" });
    await userEvent.click(within(lead).getByRole("button", { name: /Move/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move to Signed" }));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("c1", "lead", "signed"));
  });

  it("never offers a move to the stage the card is already in", async () => {
    render(<Kanban columns={COLUMNS} onMove={vi.fn()} />);
    const lead = screen.getByRole("region", { name: "Lead" });
    await userEvent.click(within(lead).getByRole("button", { name: /Move/ }));
    expect(await screen.findByRole("menuitem", { name: "Move to Qualified" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to Lead" })).toBeNull();
  });

  it("is read only, and not draggable, without onMove", () => {
    const { container } = render(<Kanban columns={COLUMNS} />);
    expect(screen.queryByRole("button", { name: /Move/ })).toBeNull();
    expect(container.querySelector("[draggable=true]")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Kanban columns={COLUMNS} onOpen={vi.fn()} onMove={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Kanban on a phone (F19)", () => {
  beforeEach(() => setViewport(390));

  it("is a stage switcher over one stage's cards, with no columns", () => {
    render(<Kanban columns={COLUMNS} />);
    expect(screen.queryByRole("region", { name: "Qualified" })).toBeNull();
    expect(screen.getByRole("group", { name: "Stage" })).toBeInTheDocument();
    expect(screen.getByText("Lagos Water Board")).toBeInTheDocument();
    expect(screen.queryByText("Ikeja Mall")).toBeNull();
  });

  it("switches stage on a chip", async () => {
    render(<Kanban columns={COLUMNS} />);
    await userEvent.click(screen.getByRole("button", { name: /Qualified 8/ }));
    expect(screen.getByText("Ikeja Mall")).toBeInTheDocument();
    expect(screen.queryByText("Lagos Water Board")).toBeNull();
  });

  it("never lets a card be dragged (F19), and moves it by Move To instead", async () => {
    const onMove = vi.fn();
    const { container } = render(<Kanban columns={COLUMNS} onMove={onMove} />);
    expect(container.querySelector("[draggable=true]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Move To" }));
    await userEvent.click(await screen.findByRole("button", { name: "Move to Signed" }));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("c1", "lead", "signed"));
  });

  it("says so when a stage is empty", async () => {
    render(<Kanban columns={COLUMNS} />);
    await userEvent.click(screen.getByRole("button", { name: /Signed 4/ }));
    expect(screen.getByText("Nothing in this stage")).toBeInTheDocument();
  });

  it("moves to the first stage when the one in view disappears", async () => {
    const { rerender } = render(<Kanban columns={COLUMNS} />);
    await userEvent.click(screen.getByRole("button", { name: /Qualified 8/ }));
    expect(screen.getByText("Ikeja Mall")).toBeInTheDocument();
    rerender(<Kanban columns={[COLUMNS[0]!, COLUMNS[2]!]} />);
    await waitFor(() => expect(screen.getByText("Lagos Water Board")).toBeInTheDocument());
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Kanban columns={COLUMNS} onOpen={vi.fn()} onMove={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

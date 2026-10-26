import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { installOverlayTestEnv } from "../overlay/test-env";
import { Kanban, type KanbanColumn } from "./Kanban";
import { RowMarksContext, type RowMarks } from "../lib/marks";

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
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("c1", "lead", "signed", null));
  });

  it("reorders within a stage by Move Up and Move Down, naming the card it now sits above", async () => {
    const onMove = vi.fn();
    const three: KanbanColumn[] = [{ key: "lead", label: "Lead", cards: [{ key: "a", title: "Alpha" }, { key: "b", title: "Bravo" }, { key: "c", title: "Charlie" }] }, COLUMNS[1]!];
    render(<Kanban columns={three} onMove={onMove} reorder />);
    const lead = screen.getByRole("region", { name: "Lead" });
    const menus = within(lead).getAllByRole("button", { name: /Move/ });
    await userEvent.click(menus[2]!);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move Up" }));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("c", "lead", "lead", "b"));
    expect(screen.queryByRole("menuitem", { name: "Move Down" })).toBeNull();
    await userEvent.click(menus[0]!);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move Down" }));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("a", "lead", "lead", "c"));
  });

  it("without reorder, offers no Move Up and ignores a drop in the card's own stage", async () => {
    const onMove = vi.fn();
    const two: KanbanColumn[] = [{ key: "lead", label: "Lead", cards: [{ key: "a", title: "Alpha" }, { key: "b", title: "Bravo" }] }, COLUMNS[1]!];
    render(<Kanban columns={two} onMove={onMove} />);
    await userEvent.click(within(screen.getByRole("region", { name: "Lead" })).getAllByRole("button", { name: /Move/ })[1]!);
    expect(await screen.findByRole("menuitem", { name: "Move to Qualified" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move Up" })).toBeNull();
    fireEvent.drop(screen.getByText("Alpha").closest("li")!, { dataTransfer: { getData: () => "b|lead", setData: () => undefined } });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.drop(screen.getByText("Ikeja Mall").closest("li")!, { dataTransfer: { getData: () => "b|lead", setData: () => undefined } });
    expect(onMove).toHaveBeenCalledWith("b", "lead", "qualified", null);
  });

  it("drops a card above the card it lands on, and at the foot of a stage it lands in", () => {
    const onMove = vi.fn();
    render(<Kanban columns={COLUMNS} onMove={onMove} reorder />);
    const data = (value: string) => ({ dataTransfer: { getData: () => value, setData: () => undefined } });
    fireEvent.drop(screen.getByText("Ikeja Mall").closest("li")!, data("c1|lead"));
    expect(onMove).toHaveBeenCalledWith("c1", "lead", "qualified", "c2");
    fireEvent.drop(screen.getByRole("region", { name: "Signed" }), data("c1|lead"));
    expect(onMove).toHaveBeenCalledWith("c1", "lead", "signed", null);
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

  it("offers Load More under a stage the server holds more of, and spins until it lands", async () => {
    let done: () => void = () => undefined;
    const onMore = vi.fn(() => new Promise<void>((r) => (done = r)));
    render(<Kanban columns={[{ ...COLUMNS[0]!, onMore }, COLUMNS[1]!]} />);
    const lead = screen.getByRole("region", { name: "Lead" });
    expect(within(screen.getByRole("region", { name: "Qualified" })).queryByRole("button", { name: /Load More/ })).toBeNull();
    await userEvent.click(within(lead).getByRole("button", { name: /Load More/ }));
    expect(onMore).toHaveBeenCalledTimes(1);
    await userEvent.click(within(lead).getByRole("button", { name: /Load More/ }));
    expect(onMore).toHaveBeenCalledTimes(1);
    done();
  });

  it("holds a card while its move is on its way: its Move To spins and refuses to open, and it moves once (F26)", async () => {
    let done: () => void = () => undefined;
    const onMove = vi.fn(() => new Promise<void>((r) => (done = r)));
    render(<Kanban columns={COLUMNS} onMove={onMove} />);
    const trigger = () => within(screen.getByRole("region", { name: "Lead" })).getByRole("button", { name: /Move/ });
    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move to Signed" }));
    await waitFor(() => expect(trigger()).toHaveAttribute("aria-busy", "true"));
    expect(trigger()).toHaveAttribute("aria-disabled", "true");
    expect(trigger()).not.toBeDisabled();
    await userEvent.click(trigger());
    expect(screen.queryByRole("menuitem", { name: "Move to Signed" })).toBeNull();
    fireEvent.drop(screen.getByRole("region", { name: "Signed" }), { dataTransfer: { getData: () => "c1|lead", setData: () => undefined } });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Lagos Water Board").closest("[draggable]")).toHaveAttribute("draggable", "false");
    done();
    await waitFor(() => expect(trigger()).not.toHaveAttribute("aria-busy"));
    await userEvent.click(trigger());
    expect(await screen.findByRole("menuitem", { name: "Move to Signed" })).toBeInTheDocument();
  });

  it("holds nothing when the move hands back no work", async () => {
    const onMove = vi.fn();
    render(<Kanban columns={COLUMNS} onMove={onMove} />);
    const lead = screen.getByRole("region", { name: "Lead" });
    await userEvent.click(within(lead).getByRole("button", { name: /Move/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move to Signed" }));
    await waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));
    expect(within(lead).getByRole("button", { name: /Move/ })).not.toHaveAttribute("aria-busy");
  });

  it("while loading, an empty stage shows a placeholder and the empty state waits", () => {
    const empty = COLUMNS.map((c) => ({ ...c, cards: [], count: undefined }));
    const { container, rerender } = render(<Kanban columns={empty} loading empty={<p>No Tasks Yet</p>} />);
    expect(screen.queryByText("No Tasks Yet")).toBeNull();
    expect(screen.queryByText("Nothing in this stage")).toBeNull();
    expect(container.querySelector("[aria-busy=true]")).not.toBeNull();
    expect(container.querySelectorAll("[data-skeleton]")).toHaveLength(3);
    rerender(<Kanban columns={empty} empty={<p>No Tasks Yet</p>} />);
    expect(screen.getByText("No Tasks Yet")).toBeInTheDocument();
  });

  it("marks an empty stage, and shows the empty state when no stage holds a card", () => {
    const { rerender } = render(<Kanban columns={COLUMNS} empty={<p>No Tasks Yet</p>} />);
    expect(within(screen.getByRole("region", { name: "Signed" })).getByText("Nothing in this stage")).toBeInTheDocument();
    expect(screen.queryByText("No Tasks Yet")).toBeNull();
    rerender(<Kanban columns={COLUMNS.map((c) => ({ ...c, cards: [], count: 0 }))} empty={<p>No Tasks Yet</p>} />);
    expect(screen.getByText("No Tasks Yet")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Lead" })).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Kanban columns={COLUMNS} onOpen={vi.fn()} onMove={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Kanban: what waits on the reader", () => {
  /** Cards new to the reader, as the app's RowMarksContext gives them; `opened` records the reads. */
  const marksOf = (fresh: string[], opened: (key: string) => void): RowMarks => ({
    useMarked: (keys) => new Set(keys.filter((k) => fresh.includes(k))),
    opened,
  });
  const WAITING: KanbanColumn[] = [
    { ...COLUMNS[0]! },
    { ...COLUMNS[1]!, unread: 2 },
    { ...COLUMNS[2]!, urgent: true },
  ];

  it("counts each stage's unread notifications beside its name, red and at least 1 while urgent", () => {
    render(<Kanban columns={WAITING} />);
    const qualified = within(screen.getByRole("region", { name: "Qualified" })).getByRole("heading");
    expect(qualified.querySelector("[data-count]")).toHaveTextContent("2");
    expect(qualified.querySelector("[data-count]")).toHaveClass("bg-primary");
    expect(within(screen.getByRole("region", { name: "Signed" })).getByRole("heading").querySelector("[data-count]")).toHaveClass("bg-destructive");
    expect(within(screen.getByRole("region", { name: "Lead" })).getByRole("heading").querySelector("[data-count]")).toBeNull();
  });

  it("dots and tints a card new to the reader, which opening reads", async () => {
    const opened = vi.fn();
    const onOpen = vi.fn();
    render(
      <RowMarksContext.Provider value={marksOf(["c2"], opened)}>
        <Kanban columns={COLUMNS} onOpen={onOpen} />
      </RowMarksContext.Provider>,
    );
    const card = screen.getByRole("button", { name: /Ikeja Mall/ });
    expect(card).toHaveAccessibleName(/^Unread, Ikeja Mall/);
    expect(screen.getByRole("region", { name: "Qualified" }).querySelector("[data-unread]")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Lead" }).querySelector("[data-unread]")).toBeNull();
    await userEvent.click(card);
    expect(opened).toHaveBeenCalledWith("c2");
    expect(onOpen).toHaveBeenCalledWith("c2", "qualified");
    await userEvent.click(screen.getByRole("button", { name: /Lagos Water Board/ }));
    expect(opened).toHaveBeenCalledOnce();
  });

  it("on a phone, opens on the stage holding the news, and stays where the person picks", async () => {
    setViewport(390);
    const { rerender } = render(<Kanban columns={COLUMNS} />);
    expect(screen.getByText("Lagos Water Board")).toBeInTheDocument();
    rerender(<Kanban columns={WAITING} />);
    await waitFor(() => expect(screen.getByText("Ikeja Mall")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Qualified 8 2/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /Lead 12/ }));
    rerender(<Kanban columns={WAITING.map((c) => ({ ...c, unread: (c.unread ?? 0) + 1 }))} />);
    expect(screen.getByText("Lagos Water Board")).toBeInTheDocument();
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
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("c1", "lead", "signed", null));
  });

  it("says so when a stage is empty", async () => {
    render(<Kanban columns={COLUMNS} />);
    await userEvent.click(screen.getByRole("button", { name: /Signed 4/ }));
    expect(screen.getByText("Nothing in this stage")).toBeInTheDocument();
  });

  it("holds a card's Move To while its move is on its way", async () => {
    let done: () => void = () => undefined;
    const onMove = vi.fn(() => new Promise<void>((r) => (done = r)));
    render(<Kanban columns={COLUMNS} onMove={onMove} />);
    await userEvent.click(screen.getByRole("button", { name: "Move To" }));
    await userEvent.click(await screen.findByRole("button", { name: "Move to Signed" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Move To" })).toHaveAttribute("aria-busy", "true"));
    await userEvent.click(screen.getByRole("button", { name: "Move To" }));
    expect(screen.queryByRole("button", { name: "Move to Signed" })).toBeNull();
    expect(onMove).toHaveBeenCalledTimes(1);
    done();
    await waitFor(() => expect(screen.getByRole("button", { name: "Move To" })).not.toHaveAttribute("aria-busy"));
  });

  it("shows a placeholder, not an empty stage, while loading", () => {
    const { container } = render(<Kanban columns={COLUMNS.map((c) => ({ ...c, cards: [] }))} loading />);
    expect(screen.queryByText("Nothing in this stage")).toBeNull();
    expect(container.querySelectorAll("[data-skeleton]")).toHaveLength(1);
  });

  it("offers Load More under the stage in view", async () => {
    const onMore = vi.fn();
    render(<Kanban columns={[{ ...COLUMNS[0]!, onMore }, COLUMNS[1]!]} />);
    await userEvent.click(screen.getByRole("button", { name: /Load More/ }));
    expect(onMore).toHaveBeenCalled();
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

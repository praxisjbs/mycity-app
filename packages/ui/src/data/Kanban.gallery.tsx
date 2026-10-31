import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Money } from "../display/Money";
import { Pill } from "../display/Pill";
import { EmptyState } from "../display/EmptyState";
import { Kanban, type KanbanColumn } from "./Kanban";

const START: KanbanColumn[] = [
  {
    key: "lead",
    label: "Lead",
    series: 1,
    cards: [
      { key: "c1", title: "Lagos Water Board", meta: <Pill>Public</Pill>, owner: "Adaeze Okonkwo" },
      { key: "c2", title: "Ikeja City Mall", meta: <Money value="4200000.00" short />, owner: "Chidi Eze" },
    ],
  },
  { key: "qualified", label: "Qualified", series: 2, cards: [{ key: "c3", title: "Victoria Island Estates", meta: <Money value="8600000.00" short />, owner: "Fatima Yusuf" }] },
  { key: "proposal", label: "Proposal Out", series: 3, cards: [{ key: "c4", title: "Yaba Tech Hub", owner: "Tunde Balogun" }] },
  { key: "signed", label: "Signed", series: 4, cards: [] },
];

/** The board with its cards moving; `slow` hands back a move that takes a while, so the card is held meanwhile. */
const Moving = ({ slow = false }: { slow?: boolean }) => {
  const [columns, setColumns] = useState(START);
  const apply = (card: string, from: string, to: string) =>
    setColumns((cols) => {
      const moved = cols.find((c) => c.key === from)?.cards.find((c) => c.key === card);
      if (!moved) return cols;
      return cols.map((c) =>
        c.key === from ? { ...c, cards: c.cards.filter((x) => x.key !== card) } : c.key === to ? { ...c, cards: [...c.cards, moved] } : c,
      );
    });
  return (
    <Kanban
      columns={columns}
      onOpen={() => undefined}
      reorder
      onMove={(card, from, to) => (slow ? new Promise<void>((r) => setTimeout(() => (apply(card, from, to), r()), 1500)) : apply(card, from, to))}
    />
  );
};

export default {
  component: "Kanban",
  states: {
    Moving: () => <Moving />,
    "Slow Move": () => <Moving slow />,
    Loading: () => <Kanban columns={START.map((c) => ({ ...c, cards: [], count: undefined }))} loading onMove={() => undefined} empty={<EmptyState title="No Deals Yet" />} />,
    "Read Only": () => <Kanban columns={START} />,
    "With Unread": () => <Kanban columns={START.map((c, i) => (i === 1 ? { ...c, unread: 2 } : i === 2 ? { ...c, urgent: true } : c))} onMove={() => undefined} />,
    "Empty Board": () => <Kanban columns={START.map((c) => ({ ...c, cards: [], count: 0 }))} onMove={() => undefined} />,
    "Empty With State": () => (
      <Kanban columns={START.map((c) => ({ ...c, cards: [], count: 0 }))} empty={<EmptyState title="No Deals Yet" text="Add the first partner to start" />} />
    ),
    "More To Load": () => <Kanban columns={START.map((c, i) => (i === 0 ? { ...c, count: 9, onMore: () => new Promise((r) => setTimeout(r, 800)) } : c))} onMove={() => undefined} />,
  },
} satisfies GalleryEntry;

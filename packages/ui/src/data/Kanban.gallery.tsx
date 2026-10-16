import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Money } from "../display/Money";
import { Pill } from "../display/Pill";
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

const Moving = () => {
  const [columns, setColumns] = useState(START);
  return (
    <Kanban
      columns={columns}
      onOpen={() => undefined}
      onMove={(card, from, to) =>
        setColumns((cols) => {
          const moved = cols.find((c) => c.key === from)?.cards.find((c) => c.key === card);
          if (!moved) return cols;
          return cols.map((c) =>
            c.key === from ? { ...c, cards: c.cards.filter((x) => x.key !== card) } : c.key === to ? { ...c, cards: [...c.cards, moved] } : c,
          );
        })
      }
    />
  );
};

export default {
  component: "Kanban",
  states: {
    Moving,
    "Read Only": () => <Kanban columns={START} />,
    "Empty Board": () => <Kanban columns={START.map((c) => ({ ...c, cards: [], count: 0 }))} onMove={() => undefined} />,
  },
} satisfies GalleryEntry;

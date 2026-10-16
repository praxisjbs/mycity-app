import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { StatusPill } from "./Pill";
import type { DataViewColumn, DataViewList } from "../data/DataView";
import { KpiDetail, type KpiDetailGroup } from "./KpiDetail";

interface Person {
  id: string;
  display_name: string;
  where: string;
  clock_in: string;
  status: { tone: "ok" | "warn"; text: string };
}

const PEOPLE: Person[] = [
  { id: "p1", display_name: "Adaeze Okonkwo", where: "On Site", clock_in: "07:52", status: { tone: "ok", text: "On Time" } },
  { id: "p2", display_name: "Chidi Eze", where: "Remote", clock_in: "08:04", status: { tone: "ok", text: "On Time" } },
  { id: "p3", display_name: "Tunde Balogun", where: "On Site", clock_in: "09:21", status: { tone: "warn", text: "Late" } },
];

const COLUMNS: DataViewColumn<Person>[] = [
  { key: "display_name", label: "Name", render: (r) => r.display_name },
  { key: "where", label: "Where", render: (r) => r.where },
  { key: "clock_in", label: "Clock-In", render: (r) => r.clock_in },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
];

const GROUPS: KpiDetailGroup[] = [
  { value: "on_site", label: "On Site", count: 14 },
  { value: "remote", label: "Remote", count: 8 },
  { value: "late", label: "Late", count: 3 },
];

function useSample(over: Partial<DataViewList<Person>> = {}): DataViewList<Person> {
  const [q, setQ] = useState("");
  return {
    rows: PEOPLE,
    page: { number: 1, size: 25, total: 22, pages: 1, has_next: false },
    loading: false,
    error: null,
    setPage: () => undefined,
    q,
    setQ,
    ...over,
  };
}

const Plain = () => <KpiDetail list={useSample()} columns={COLUMNS} rowKey={(r) => r.id} caption="Clocked In Today" noun="person" nounPlural="people" />;

const ShortList = () => (
  <KpiDetail
    list={useSample({ rows: PEOPLE.slice(0, 2), page: { number: 1, size: 25, total: 2, pages: 1, has_next: false } })}
    columns={COLUMNS}
    rowKey={(r) => r.id}
    caption="On Leave Today"
    noun="person"
    nounPlural="people"
  />
);

const Empty = () => (
  <KpiDetail
    list={useSample({ rows: [], page: undefined })}
    columns={COLUMNS}
    rowKey={(r) => r.id}
    caption="No Clock-Out Yesterday"
    empty={{ title: "Nobody Missed One", text: "Everyone clocked out yesterday." }}
  />
);

const Grouped = () => {
  const [group, setGroup] = useState("all");
  return (
    <KpiDetail
      summary="22 of 25 clocked in across the organisation"
      groups={GROUPS}
      group={group}
      onGroup={setGroup}
      list={useSample()}
      columns={COLUMNS}
      rowKey={(r) => r.id}
      onRowClick={() => undefined}
      caption="Clocked In Today"
      noun="person"
      nounPlural="people"
    />
  );
};

export default {
  component: "KpiDetail",
  states: {
    Grouped,
    Plain,
    "Short List": ShortList,
    Empty: Empty,
  },
} satisfies GalleryEntry;

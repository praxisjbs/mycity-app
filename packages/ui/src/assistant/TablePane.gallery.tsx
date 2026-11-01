import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { TablePane } from "./TablePane";

const NAMES = ["Ayo Bello", "Kemi Ade", "Ngozi Eze", "Tunde Balogun", "Chidi Okafor"];
const rows = (page: number) => NAMES.map((n, i) => [`${n} ${page > 1 ? page : ""}`.trim(), String((i + page) % 4), "27/10/2026"]);

function Paged({ total }: { total: number }) {
  const [number, setNumber] = useState(1);
  const pages = Math.ceil(total / 25);
  return (
    <div className="rounded-card border border-border bg-card p-3.5">
      <TablePane caption="Leave requests" columns={["Employee", "Days", "Starts"]} rows={rows(number)} numeric={[1]} links={NAMES.map((_, i) => (i % 2 ? null : "/people?tab=leave&id=l1"))} page={{ number, size: 25, total, pages, has_next: number < pages }} onPage={setNumber} onOpenRow={() => undefined} />
    </div>
  );
}

export default {
  component: "TablePane",
  states: {
    "Two Pages": () => <Paged total={40} />,
    "Past 200 Rows": () => <Paged total={1240} />,
    "With Export": () => (
      <div className="rounded-card border border-border bg-card p-3.5">
        <TablePane caption="Employees" columns={["Name", "Department"]} rows={NAMES.map((n) => [n, "Operations"])} numeric={[]} links={NAMES.map(() => null)} onExport={() => Promise.resolve()} />
      </div>
    ),
  },
} satisfies GalleryEntry;

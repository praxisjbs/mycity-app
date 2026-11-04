import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { PaneTabs } from "./PaneTabs";
import { SourcesPane } from "./SourcesPane";
import { RecordPane } from "./RecordPane";
import type { PaneRead, PaneTab } from "./pane";

const READS: PaneRead[] = [
  { n: 1, name: "Leave Requests", kind: "read", outcome: "read", filters: [["Status", "waiting"]], rows: 2, total: 2, masked: [], opens: true },
  { n: 2, name: "Employees", kind: "read", outcome: "refused", filters: [], rows: 0, total: null, masked: ["salary"] },
];

function Panes({ start, all }: { start: PaneTab; all?: boolean }) {
  const [tab, setTab] = useState<PaneTab>(start);
  return (
    <div className="flex h-96 flex-col overflow-hidden rounded-card border border-border bg-card">
      <PaneTabs
        value={tab}
        onValueChange={setTab}
        overview={all ? <p className="text-sm text-muted-foreground">Figures</p> : undefined}
        table={all ? <p className="text-sm text-muted-foreground">Rows</p> : undefined}
        record={<RecordPane record={{ title: "Ayo Bello", items: [["Days", "3"], ["Starts", "27/10/2026"]], link: "/people?tab=leave&id=l1" }} onOpen={() => undefined} />}
        sources={<SourcesPane reads={READS} when="22/10/2026 09:30" onOpenTable={() => undefined} />}
      />
    </div>
  );
}

export default {
  component: "PaneTabs",
  states: {
    "Some Empty": () => <Panes start="sources" />,
    "All Four": () => <Panes start="record" all />,
  },
} satisfies GalleryEntry;

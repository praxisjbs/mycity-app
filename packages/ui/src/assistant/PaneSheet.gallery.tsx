import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { PaneSheet } from "./PaneSheet";
import { PaneTabs } from "./PaneTabs";
import { SourcesPane } from "./SourcesPane";
import type { PaneRead, PaneTab } from "./pane";

const READS: PaneRead[] = [{ n: 1, name: "Leave Requests", kind: "read", outcome: "read", filters: [["Status", "waiting"]], rows: 2, total: 2, masked: [], opens: true }];

function Opens() {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PaneTab>("sources");
  return (
    <div ref={ref}>
      <Button variant="ghost" icon="chart" onClick={() => setOpen(true)}>
        Open Figures
      </Button>
      <PaneSheet open={open} onClose={() => setOpen(false)} container={frame}>
        <PaneTabs value={tab} onValueChange={setTab} sources={<SourcesPane reads={READS} onOpenTable={() => setTab("table")} />} />
      </PaneSheet>
    </div>
  );
}

export default {
  component: "PaneSheet",
  states: { "Opens on a Phone": () => <Opens /> },
} satisfies GalleryEntry;

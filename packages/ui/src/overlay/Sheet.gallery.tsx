import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Sheet } from "./Sheet";
import { useGalleryFrame } from "./gallery-frame";

function Opens({ full, hideHeader, footer }: { full?: boolean; hideHeader?: boolean; footer?: boolean }) {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  return (
    <div ref={ref}>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Leave Balance
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Leave Balance"
        full={full}
        hideHeader={hideHeader}
        container={frame}
        footer={footer ? <Button variant="primary">Request Leave</Button> : undefined}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Entitled</dt>
          <dd data-copy="content">20 days</dd>
          <dt className="text-muted-foreground">Taken</dt>
          <dd data-copy="content">8 days</dd>
          <dt className="text-muted-foreground">Remaining</dt>
          <dd data-copy="content">12 days</dd>
        </dl>
      </Sheet>
    </div>
  );
}

export default {
  component: "Sheet",
  states: {
    "Fits Content": () => <Opens />,
    "With Footer": () => <Opens footer />,
    "Full Screen": () => <Opens full footer />,
    "No Header": () => <Opens hideHeader />,
  },
} satisfies GalleryEntry;

import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button, IconButton } from "../actions/Button";
import { PhonePage } from "./PhonePage";
import { useGalleryFrame } from "./gallery-frame";

function Opens({ withBar }: { withBar?: boolean }) {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  return (
    <div ref={ref}>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Notification Settings
      </Button>
      <PhonePage
        open={open}
        onClose={() => setOpen(false)}
        title="Notification Settings"
        actions={<IconButton icon="help" label="Help" />}
        bar={withBar ? <p className="text-xs text-subtle-foreground">This device: On</p> : undefined}
        container={frame}
      >
        <ul className="divide-y divide-border">
          {["Approvals", "Messages and Mail", "Attendance and Leave", "Security"].map((c) => (
            <li key={c} className="px-4 py-3 text-sm" data-copy="content">
              {c}
            </li>
          ))}
        </ul>
      </PhonePage>
    </div>
  );
}

export default {
  component: "PhonePage",
  states: {
    Default: () => <Opens />,
    "With Bar": () => <Opens withBar />,
  },
} satisfies GalleryEntry;

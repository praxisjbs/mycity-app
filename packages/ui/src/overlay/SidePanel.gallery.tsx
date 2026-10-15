import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { SidePanel } from "./SidePanel";
import { useGalleryFrame } from "./gallery-frame";

function Opens({ size, dirty }: { size?: "md" | "wide"; dirty?: boolean }) {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div ref={ref}>
      <Button onClick={() => setOpen(true)}>Edit Employee</Button>
      <SidePanel
        open={open}
        onClose={close}
        title="Edit Employee"
        size={size}
        dirty={dirty}
        container={frame}
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={close}>
              Save Changes
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd data-copy="content">Cynthia Osakunih</dd>
          <dt className="text-muted-foreground">Department</dt>
          <dd data-copy="content">Operations</dd>
          <dt className="text-muted-foreground">Arrangement</dt>
          <dd data-copy="content">Hybrid</dd>
        </dl>
      </SidePanel>
    </div>
  );
}

export default {
  component: "SidePanel",
  states: {
    Default: () => <Opens />,
    Wide: () => <Opens size="wide" />,
    "Unsaved Changes": () => <Opens dirty />,
  },
} satisfies GalleryEntry;

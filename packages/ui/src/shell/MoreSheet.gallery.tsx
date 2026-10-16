import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button, IconButton } from "../actions/Button";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { MoreSheet } from "./MoreSheet";
import { MORE_GROUPS } from "./fixtures";

function Opens({ install }: { install?: boolean }) {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  return (
    <div ref={ref}>
      <Button variant="primary" icon="grid" onClick={() => setOpen(true)}>
        Open More
      </Button>
      <MoreSheet
        open={open}
        onClose={() => setOpen(false)}
        container={frame}
        person={{ name: "Cynthia Osakunih", subtitle: "Operations Manager" }}
        personActions={
          <>
            <IconButton icon="moon" label="Dark Theme" />
            <IconButton icon="rows" label="Comfortable Density" />
            <IconButton icon="cog" label="Settings" />
          </>
        }
        onSearch={() => undefined}
        groups={MORE_GROUPS}
        current="people"
        extra={
          install ? (
            <Button block icon="download">
              Install App
            </Button>
          ) : undefined
        }
        onSignOut={() => setOpen(false)}
      />
    </div>
  );
}

export default {
  component: "MoreSheet",
  states: {
    Launcher: () => <Opens />,
    "With Install": () => <Opens install />,
  },
} satisfies GalleryEntry;

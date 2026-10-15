import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { ModalProvider } from "./Modal";
import { ConfirmDialog, useConfirm } from "./ConfirmDialog";
import { useGalleryFrame } from "./gallery-frame";

function Opens({ destructive, body, title, label }: { destructive?: boolean; body?: string; title: string; label: string }) {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  return (
    <div ref={ref}>
      <Button variant={destructive ? "danger" : "default"} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        title={title}
        body={body}
        destructive={destructive}
        container={frame}
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

function Busy() {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  return (
    <div ref={ref}>
      <Button onClick={() => setOpen(true)}>Revoke Device</Button>
      <ConfirmDialog
        open={open}
        title="Revoke Device"
        destructive
        container={frame}
        onConfirm={() => new Promise<void>((r) => setTimeout(r, 1500)).then(() => setOpen(false))}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

function Asks() {
  const confirm = useConfirm();
  const [answer, setAnswer] = useState<string>("");
  return (
    <div className="flex items-center gap-3">
      <Button variant="danger" onClick={async () => setAnswer((await confirm({ title: "Empty Trash", destructive: true })) ? "Emptied" : "Kept")}>
        Empty Trash
      </Button>
      <span className="text-sm text-muted-foreground" data-copy="content">
        {answer}
      </span>
    </div>
  );
}

export default {
  component: "ConfirmDialog",
  states: {
    Destructive: () => <Opens destructive title="Delete Rule" label="Delete Rule" body="Queries already raised keep their history." />,
    Plain: () => <Opens title="Publish Policy" label="Publish Policy" />,
    Busy: () => <Busy />,
    "Use Confirm": () => (
      <ModalProvider>
        <Asks />
      </ModalProvider>
    ),
  },
} satisfies GalleryEntry;

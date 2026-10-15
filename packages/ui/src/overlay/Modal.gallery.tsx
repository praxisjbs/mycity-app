import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Grow, Modal, ModalFooter, ModalProvider, useModal } from "./Modal";
import { useUnsavedChanges } from "./context";
import { useGalleryFrame } from "./gallery-frame";

const Rule = () => (
  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
    <dt className="text-muted-foreground">Trigger</dt>
    <dd data-copy="content">Late Clock In</dd>
    <dt className="text-muted-foreground">Threshold</dt>
    <dd data-copy="content">3 times a month</dd>
    <dt className="text-muted-foreground">Raised To</dt>
    <dd data-copy="content">Line Manager</dd>
  </dl>
);

function Opens({ label, ...modal }: { label: string; wide?: boolean; full?: boolean; dirty?: boolean; sub?: string; title: string; withFooter?: boolean }) {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div ref={ref}>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        {...modal}
        open={open}
        onClose={close}
        container={frame}
        footer={
          modal.withFooter === false ? undefined : (
            <>
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" onClick={close}>
                Create Rule
              </Button>
            </>
          )
        }
      >
        <Rule />
      </Modal>
    </div>
  );
}

function DirtyForm() {
  const [count, setCount] = useState(0);
  useUnsavedChanges(count > 0);
  return (
    <div className="flex flex-col items-start gap-3">
      <Rule />
      <Button onClick={() => setCount((n) => n + 1)}>Add Step</Button>
      <p className="text-sm text-muted-foreground" data-copy="content">
        {count} steps added
      </p>
      <ModalFooter>
        <Button>Cancel</Button>
        <Grow />
        <Button variant="primary">Save Steps</Button>
      </ModalFooter>
    </div>
  );
}

function FromProvider() {
  const modal = useModal();
  return (
    <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Approval Steps", body: <DirtyForm /> })}>
      Edit Steps
    </Button>
  );
}

function WithProvider() {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref}>
      <ModalProvider container={frame}>
        <FromProvider />
      </ModalProvider>
    </div>
  );
}

export default {
  component: "Modal",
  states: {
    Form: () => <Opens label="New Rule" title="New Rule" />,
    "With Subtitle": () => <Opens label="New Rule" title="New Rule" sub="Raised automatically on a schedule" />,
    Wide: () => <Opens label="Alert Rules" title="Alert Rules" wide withFooter={false} />,
    "Full Phone Sheet": () => <Opens label="New Message" title="New Message" full />,
    "Unsaved Changes": () => <Opens label="Edit Rule" title="Edit Rule" dirty />,
    "Use Modal": () => <WithProvider />,
  },
} satisfies GalleryEntry;

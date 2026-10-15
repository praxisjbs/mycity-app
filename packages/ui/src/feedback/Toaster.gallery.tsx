import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { Toaster } from "./Toaster";
import { toast, type ToastOptions } from "./toast";

/** Each themed frame mounts its own Toaster, and its buttons show toasts in that one. */
function Frame({ kind, label, text, undo }: { kind: "success" | "error" | "info"; label: string; text: string; undo?: boolean }) {
  const [ref, frame] = useGalleryFrame();
  const id = `gallery-${frame?.dataset.galleryFrame ?? "light"}`;
  const options: ToastOptions = { toasterId: id, ...(undo && { undo: () => toast.info("Alert restored", { toasterId: id }) }) };
  return (
    <div ref={ref}>
      <Button onClick={() => toast[kind](text, options)}>{label}</Button>
      <Toaster id={id} />
    </div>
  );
}

export default {
  component: "Toaster",
  states: {
    Success: () => <Frame kind="success" label="Approve Leave" text="Leave approved" />,
    "With Undo": () => <Frame kind="success" label="Clear Alert" text="Alert cleared" undo />,
    Error: () => <Frame kind="error" label="Save Draft" text="Could not save the draft" />,
    Info: () => <Frame kind="info" label="Refresh Mailbox" text="Mailbox up to date" />,
  },
} satisfies GalleryEntry;

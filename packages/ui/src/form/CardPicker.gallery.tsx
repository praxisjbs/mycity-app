import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Grow, Modal } from "../overlay/Modal";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { CardPicker, type CardPickerOption } from "./CardPicker";

const OPERATIONS: CardPickerOption[] = [
  { id: "headcount", title: "Headcount" },
  { id: "attendance_today", title: "Clocked In Today", locked: true },
  { id: "leave_pending", title: "Leave Awaiting Approval" },
  { id: "tasks_overdue", title: "Overdue Tasks" },
  { id: "approvals_awaiting_you", title: "Awaiting Your Approval" },
  { id: "partnerships_active", title: "Active Partnerships" },
  { id: "expenses_pending", title: "Expenses Awaiting Approval" },
];

const STAFF: CardPickerOption[] = [
  { id: "my_attendance_30d", title: "My Attendance" },
  { id: "my_tasks_overdue", title: "My Overdue Tasks" },
  { id: "my_reviews_due", title: "My Reviews Due" },
  { id: "my_leave_left", title: "My Leave Left" },
];

const ROLE_CARDS = ["attendance_today", "tasks_overdue", "expenses_pending", "partnerships_active"];

function Choosing({ options, start }: { options: CardPickerOption[]; start: string[] }) {
  const [value, setValue] = useState(start);
  return <CardPicker label="Overview Cards" options={options} value={value} onChange={setValue} />;
}

/** The picker as Home opens it: Choose Cards, with the footer's Cancel, Use Role Default and Save Cards. */
function InDialog() {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(ROLE_CARDS);
  const close = () => setOpen(false);
  return (
    <div ref={ref}>
      <Button
        onClick={() => {
          setDraft(ROLE_CARDS);
          setOpen(true);
        }}
      >
        Choose Cards
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Choose Cards"
        container={frame}
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Grow />
            <Button onClick={() => setDraft(ROLE_CARDS)}>Use Role Default</Button>
            <Button variant="primary" onClick={close}>
              Save Cards
            </Button>
          </>
        }
      >
        <CardPicker label="Overview Cards" options={OPERATIONS} value={draft} onChange={setDraft} />
      </Modal>
    </div>
  );
}

export default {
  component: "CardPicker",
  states: {
    Choosing: () => <Choosing options={OPERATIONS} start={["attendance_today", "tasks_overdue", "expenses_pending"]} />,
    "Full Row": () => <Choosing options={OPERATIONS} start={ROLE_CARDS} />,
    "Nothing Chosen": () => <Choosing options={STAFF} start={[]} />,
    "In a Dialog": InDialog,
  },
} satisfies GalleryEntry;

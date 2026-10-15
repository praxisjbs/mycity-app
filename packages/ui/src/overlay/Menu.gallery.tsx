import type { GalleryEntry } from "../testing/gallery";
import { Button, IconButton } from "../actions/Button";
import { Menu, type MenuItem } from "./Menu";
import { useGalleryFrame } from "./gallery-frame";

const MOVES: MenuItem[] = [
  { label: "Archive", icon: "book", onSelect: () => undefined },
  { label: "Move to Inbox", icon: "mail", onSelect: () => undefined },
  { label: "Move to Spam", icon: "alert", onSelect: () => undefined, disabled: true },
  "sep",
  { label: "Move to Trash", icon: "x", danger: true, onSelect: () => undefined },
];

const SCHEDULE: MenuItem[] = [
  { label: "Tomorrow at 08:00", icon: "clock", onSelect: () => undefined },
  { label: "Monday at 08:00", icon: "clock", onSelect: () => undefined },
  "sep",
  { label: "Pick Date and Time", icon: "check", onSelect: () => undefined },
];

function Row({ items, button }: { items: MenuItem[]; button: "icon" | "schedule" }) {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref} className="flex">
      <Menu
        container={frame}
        align={button === "icon" ? "start" : "end"}
        items={items}
        trigger={button === "icon" ? (p) => <IconButton {...p} icon="dots" label="More Actions" /> : (p) => <Button {...p} icon="clock">Schedule</Button>}
      />
    </div>
  );
}

export default {
  component: "Menu",
  states: {
    "Record Actions": () => <Row items={MOVES} button="icon" />,
    "Split Button": () => <Row items={SCHEDULE} button="schedule" />,
  },
} satisfies GalleryEntry;

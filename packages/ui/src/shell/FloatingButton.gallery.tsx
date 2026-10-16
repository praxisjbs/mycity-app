import type { GalleryEntry } from "../testing/gallery";
import { FloatingButton, type FabAction } from "./FloatingButton";

const ACTIONS: FabAction[] = [
  { key: "new", label: "New Task", icon: "plus", onSelect: () => undefined },
  { key: "clock", label: "Clock In", icon: "clock", onSelect: () => undefined },
  { key: "ai", label: "Praxis AI", icon: "spark", onSelect: () => undefined },
  { key: "help", label: "Help", icon: "help", onSelect: () => undefined },
];

export default {
  component: "FloatingButton",
  states: {
    Closed: () => (
      <div className="flex justify-end">
        <FloatingButton actions={ACTIONS} onHideHere={() => undefined} />
      </div>
    ),
    Open: () => (
      <div className="flex h-96 items-end justify-end">
        <FloatingButton actions={ACTIONS} onHideHere={() => undefined} defaultOpen />
      </div>
    ),
  },
} satisfies GalleryEntry;

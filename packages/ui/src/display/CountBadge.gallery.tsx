import type { GalleryEntry } from "../testing/gallery";
import { unreadNotices } from "../lib/format";
import { CountBadge } from "./CountBadge";

export default {
  component: "CountBadge",
  states: {
    Default: () => <CountBadge count={3} label="approvals waiting" />,
    Overdue: () => <CountBadge count={12} tone="err" label="overdue tasks" />,
    Neutral: () => <CountBadge count={0} showZero tone="neutral" label="drafts" />,
    "Over Max": () => <CountBadge count={240} label="unread messages" />,
    "Unread Notices": () => <CountBadge count={21} words={unreadNotices(21)} tip />,
  },
} satisfies GalleryEntry;

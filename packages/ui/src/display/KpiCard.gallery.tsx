import type { GalleryEntry } from "../testing/gallery";
import { Money } from "./Money";
import { KpiCard } from "./KpiCard";

export default {
  component: "KpiCard",
  states: {
    Default: () => <KpiCard title="Clocked In Today" value="22 of 25" caption="3 late" />,
    Trends: () => (
      <div className="grid grid-cols-2 gap-3">
        <KpiCard title="Present Today" value={22} caption="2 more than Monday" trend="up" />
        <KpiCard title="Late Arrivals" value={3} tone="warn" caption="1 fewer than Monday" trend="down" />
        <KpiCard title="On Leave" value={2} caption="Same as Monday" trend="flat" />
        <KpiCard title="Owed This Month" value={<Money value="1340500.00" short />} tone="err" caption="4 overdue" />
      </div>
    ),
    Opens: () => <KpiCard title="Open Queries" value={4} onOpen={() => undefined} caption="2 past due" />,
    "With Help": () => <KpiCard title="Over By" value="2 Days" help="How far past its due date the oldest open item is." />,
    "Opens With Help": () => <KpiCard title="Over By" value="2 Days" onOpen={() => undefined} help="How far past its due date the oldest open item is." />,
    "Phone Only": () => <KpiCard title="My Leave Days" value={12} onOpen={() => undefined} opensOn="phone" caption="4 taken" />,
  },
} satisfies GalleryEntry;

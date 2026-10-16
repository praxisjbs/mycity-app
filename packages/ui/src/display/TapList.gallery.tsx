import type { GalleryEntry } from "../testing/gallery";
import { Money } from "./Money";
import { Pill } from "./Pill";
import { TapList } from "./TapList";

const PAYSLIPS = [
  { key: "p1", title: "September 2026", sub: "Paid 25/09/2026", end: <Money value="412500.00" short /> },
  { key: "p2", title: "August 2026", sub: "Paid 25/08/2026", end: <Money value="412500.00" short /> },
  { key: "p3", title: "July 2026", sub: "Paid 25/07/2026", end: <Money value="398000.00" short /> },
];

export default {
  component: "TapList",
  states: {
    Default: () => <TapList items={PAYSLIPS.map((p) => ({ ...p, onSelect: () => undefined }))} label="Payslips" />,
    "With Pills": () => (
      <TapList
        label="Leave Requests"
        items={[
          { key: "l1", title: "Annual Leave", sub: "12/11/2026 to 20/11/2026", end: <Pill tone="warn">Pending</Pill>, onSelect: () => undefined },
          { key: "l2", title: "Casual Leave", sub: "03/10/2026", end: <Pill tone="ok">Approved</Pill>, onSelect: () => undefined },
        ]}
      />
    ),
    Flat: () => <TapList items={PAYSLIPS.map((p) => ({ ...p, onSelect: () => undefined }))} label="Payslips" flat />,
  },
} satisfies GalleryEntry;

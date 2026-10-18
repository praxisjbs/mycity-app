import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { ItemChip } from "./ItemChip";

const noop = () => {};

/** Letters after a module's name; on a screen each is a help term. */
const marks = (letters: string[]) => (
  <>
    {letters.map((l) => (
      <span key={l}>{l}</span>
    ))}
  </>
);

const EDIT = [
  { key: "people", name: "People", letters: ["T", "A"] },
  { key: "performance", name: "Performance", letters: ["T", "A"] },
  { key: "partnerships", name: "Partnerships", letters: ["T"] },
  { key: "expenses", name: "Expenses", letters: ["T", "A"] },
];

function EditLevel() {
  const [open, setOpen] = useState("performance");
  return (
    <div className="flex flex-wrap gap-2">
      {EDIT.map((m) => (
        <ItemChip key={m.key} selected={open === m.key} onSelect={() => setOpen(m.key)} marks={marks(m.letters)}>
          {m.name}
        </ItemChip>
      ))}
      <ItemChip muted onSelect={() => setOpen("payroll")} label="Payroll, No Access">
        Payroll
      </ItemChip>
      <ItemChip>Attendance</ItemChip>
    </div>
  );
}

export default {
  component: "ItemChip",
  states: {
    "Edit Level": () => <EditLevel />,
    Selected: () => (
      <ItemChip selected onSelect={noop} marks={marks(["T", "A"])}>
        People
      </ItemChip>
    ),
    "No Access": () => (
      <ItemChip muted onSelect={noop} label="Payroll, No Access">
        Payroll
      </ItemChip>
    ),
    "Plain Label": () => <ItemChip marks={marks(["T"])}>Partnerships</ItemChip>,
  },
} satisfies GalleryEntry;

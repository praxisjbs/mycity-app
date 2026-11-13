import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { LinesField, type LineValue } from "./LinesField";

function Lines({ start }: { start: LineValue[] }) {
  const [lines, setLines] = useState(start);
  return (
    <Field label="Lines">
      <LinesField value={lines} onChange={setLines} />
    </Field>
  );
}

export default {
  component: "LinesField",
  states: {
    Empty: () => <Lines start={[]} />,
    Filled: () => (
      <Lines
        start={[
          { description: "Crates of water", quantity: "2", unit_price: "4,500" },
          { description: "Ice", quantity: "1.5", unit_price: "1,000" },
        ]}
      />
    ),
    "From an Invoice": () => (
      <Lines
        start={[
          { description: "Payment gateway integration", quantity: "1", unit_price: "250,000.00" },
          { description: "Ticket checkout pages", quantity: "1", unit_price: "150,000.00" },
          { description: "Discount", quantity: "1", unit_price: "-100,000.00" },
          { description: "Paid to date on INV-202611-9525", quantity: "1", unit_price: "-300,000.00" },
        ]}
      />
    ),
  },
} satisfies GalleryEntry;

import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { MoneyField } from "./MoneyField";

function Amount({ start, signed = false }: { start: string; signed?: boolean }) {
  const [v, setV] = useState(start);
  return (
    <Field label={signed ? "Unit Price" : "Amount"}>
      <MoneyField value={v} onChange={setV} signed={signed} />
    </Field>
  );
}

export default {
  component: "MoneyField",
  states: {
    Empty: () => <Amount start="" />,
    Filled: () => <Amount start="1,250,000.00" />,
    Signed: () => <Amount start="-100,000.00" signed />,
    Error: () => (
      <Field label="Amount" state="bad" message="Two decimals at most">
        <MoneyField value="12.345" onChange={() => undefined} />
      </Field>
    ),
  },
} satisfies GalleryEntry;

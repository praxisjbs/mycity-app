import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { MoneyField } from "./MoneyField";

function Amount({ start }: { start: string }) {
  const [v, setV] = useState(start);
  return (
    <Field label="Amount">
      <MoneyField value={v} onChange={setV} />
    </Field>
  );
}

export default {
  component: "MoneyField",
  states: {
    Empty: () => <Amount start="" />,
    Filled: () => <Amount start="1,250,000.00" />,
    Error: () => (
      <Field label="Amount" state="bad" message="Two decimals at most">
        <MoneyField value="12.345" onChange={() => undefined} />
      </Field>
    ),
  },
} satisfies GalleryEntry;

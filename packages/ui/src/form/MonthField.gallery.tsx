import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { MonthField } from "./MonthField";

function RunMonth({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  return (
    <Field label="Month">
      <MonthField value={v} onChange={setV} min="2024-01-01" max="2026-11-30" />
    </Field>
  );
}

export default {
  component: "MonthField",
  states: {
    Month: () => <RunMonth initial="2026-10-01" />,
    Empty: () => <RunMonth initial="" />,
    "No Month": () => (
      <Field label="Month" state="bad" message="Pick a month">
        <MonthField value="" onChange={() => undefined} />
      </Field>
    ),
    Disabled: () => (
      <Field label="Month">
        <MonthField value="2026-09-01" onChange={() => undefined} disabled />
      </Field>
    ),
  },
} satisfies GalleryEntry;

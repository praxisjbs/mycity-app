import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { DateField, DateRangeField, TimeField, type DateRange } from "./DateField";

function OneDate() {
  const [v, setV] = useState("2026-10-15");
  return (
    <Field label="Start Date">
      <DateField value={v} onChange={setV} />
    </Field>
  );
}

function Range() {
  const [v, setV] = useState<DateRange>({ from: "2026-10-01", to: "2026-10-31" });
  return (
    <Field label="Report Period">
      <DateRangeField value={v} onChange={setV} />
    </Field>
  );
}

function Time() {
  const [v, setV] = useState("09:00");
  return (
    <Field label="Shift Start">
      <TimeField value={v} onChange={setV} />
    </Field>
  );
}

export default {
  component: "DateField",
  states: {
    Date: () => <OneDate />,
    "Not a Date": () => (
      <Field label="Start Date" state="bad" message="Not a real date">
        <DateField value="" onChange={() => undefined} />
      </Field>
    ),
    Period: () => <Range />,
    Time: () => <Time />,
  },
} satisfies GalleryEntry;

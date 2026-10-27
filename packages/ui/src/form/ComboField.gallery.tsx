import { useEffect, useRef, useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import type { DataViewList } from "../data/DataView";
import { Field } from "./Field";
import { ComboField } from "./ComboField";
import { SAMPLE_UNITS, type SampleUnit } from "./fixtures";

function useUnits(total = SAMPLE_UNITS.length): DataViewList<SampleUnit> {
  const [q, setQ] = useState("");
  const rows = SAMPLE_UNITS.filter((u) => u.unit.toLowerCase().includes(q.toLowerCase()));
  return { rows, page: { number: 1, size: 25, total, pages: 1, has_next: false }, loading: false, error: null, q, setQ };
}

/** A field with its list open, as it is while the person types. */
function Open({ start, total }: { start: string; total?: number }) {
  const [value, setValue] = useState(start);
  const list = useUnits(total);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.querySelector("input")?.focus(), []);
  return (
    <div ref={box}>
      <Field label="Unit" optional>
        <ComboField value={value} onChange={setValue} list={list} option={(u) => u.unit} sub={(u) => `Used ${u.uses}`} placeholder="users" />
      </Field>
    </div>
  );
}

const Picked = () => {
  const [value, setValue] = useState("%");
  return (
    <Field label="Unit" optional state="good">
      <ComboField value={value} onChange={setValue} list={useUnits()} option={(u) => u.unit} sub={(u) => `Used ${u.uses}`} />
    </Field>
  );
};

const Refused = () => {
  const [value, setValue] = useState("");
  return (
    <Field label="Unit" state="bad" message="Required">
      <ComboField value={value} onChange={setValue} list={useUnits()} option={(u) => u.unit} />
    </Field>
  );
};

export default {
  component: "ComboField",
  states: {
    "Units In Use": () => <Open start="" />,
    "Typed Unit": () => <Open start="tickets" />,
    "Narrowed To Match": () => <Open start="us" />,
    "Longer List": () => <Open start="" total={64} />,
    "One Picked": Picked,
    Refused,
  },
} satisfies GalleryEntry;

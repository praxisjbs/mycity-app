import { useEffect, useRef, useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import type { DataViewList } from "../data/DataView";
import { Field } from "./Field";
import { ComboListField } from "./ComboListField";
import { SAMPLE_IMPACTS, type SampleImpact } from "./fixtures";

function useImpacts(): DataViewList<SampleImpact> {
  const [q, setQ] = useState("");
  const rows = SAMPLE_IMPACTS.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
  return { rows, page: { number: 1, size: 25, total: rows.length, pages: 1, has_next: false }, loading: false, error: null, q, setQ };
}

/** The field as a form holds it, its list open when `focus` is set. */
function Impacts({ start, focus = false, max }: { start: string[]; focus?: boolean; max?: number }) {
  const [value, setValue] = useState(start);
  const list = useImpacts();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) box.current?.querySelector("input")?.focus();
  }, [focus]);
  return (
    <div ref={box}>
      <Field label="Impact" optional>
        <ComboListField value={value} onChange={setValue} list={list} option={(i) => i.label} max={max} placeholder="Brand Visibility" />
      </Field>
    </div>
  );
}

const Refused = () => {
  const [value, setValue] = useState<string[]>([]);
  return (
    <Field label="Impact" state="bad" message="Pick at least one">
      <ComboListField value={value} onChange={setValue} list={useImpacts()} option={(i) => i.label} />
    </Field>
  );
};

export default {
  component: "ComboListField",
  states: {
    Empty: () => <Impacts start={[]} />,
    "Suggestions Open": () => <Impacts start={[]} focus />,
    "Two Held": () => <Impacts start={["App Downloads & Visibility", "Tourism Reach"]} focus />,
    "All It Holds": () => <Impacts start={["Brand Visibility", "User Acquisition"]} max={2} />,
    Refused,
  },
} satisfies GalleryEntry;

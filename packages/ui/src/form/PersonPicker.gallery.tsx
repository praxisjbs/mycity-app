import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import type { DataViewList } from "../data/DataView";
import { Field } from "./Field";
import { PersonPicker, type PickedPerson } from "./PersonPicker";
import { SAMPLE_PEOPLE } from "./fixtures";

function usePeople(total = 312): DataViewList<PickedPerson> {
  const [q, setQ] = useState("");
  const rows = SAMPLE_PEOPLE.filter((p) => p.display_name.toLowerCase().includes(q.toLowerCase()));
  return { rows, page: { number: 1, size: 25, total, pages: 13, has_next: true }, loading: false, error: null, q, setQ };
}

const OnePerson = () => {
  const [value, setValue] = useState<PickedPerson[]>([]);
  return <PersonPicker list={usePeople()} value={value} onChange={setValue} />;
};

const Panel = () => {
  const [value, setValue] = useState<PickedPerson[]>([SAMPLE_PEOPLE[0]!, SAMPLE_PEOPLE[2]!]);
  return <PersonPicker list={usePeople()} value={value} onChange={setValue} multiple />;
};

const InAField = () => {
  const [value, setValue] = useState<PickedPerson[]>([]);
  return (
    <Field label="Approver" help="Who signs this off after you. Their name is on the claim.">
      <PersonPicker list={usePeople()} value={value} onChange={setValue} />
    </Field>
  );
};

export default {
  component: "PersonPicker",
  states: { "One Person": OnePerson, "A Panel": Panel, "In A Field": InAField },
} satisfies GalleryEntry;

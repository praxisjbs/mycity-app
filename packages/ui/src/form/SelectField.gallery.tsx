import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { ChoiceField, SelectField } from "./SelectField";

function Select() {
  const [v, setV] = useState("");
  return (
    <Field label="Department">
      <SelectField
        value={v}
        onChange={setV}
        placeholder="Choose One"
        options={[["ops", "Operations"], ["hr", "People"], ["fin", "Finance"], ["mkt", "Marketing"], ["it", "Technology"], ["ceo", "Office of the CEO"]]}
      />
    </Field>
  );
}

function Choice() {
  const [v, setV] = useState("on_site");
  return (
    <Field label="Work Pattern">
      <ChoiceField value={v} onChange={setV} options={[["on_site", "On Site"], ["hybrid", "Hybrid"], ["remote", "Remote"]]} />
    </Field>
  );
}

export default {
  component: "SelectField",
  states: {
    Select: () => <Select />,
    Choice: () => <Choice />,
  },
} satisfies GalleryEntry;

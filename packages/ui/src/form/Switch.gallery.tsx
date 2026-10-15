import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { CheckboxField, Switch, ToggleRow } from "./Switch";

function Rows() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  return (
    <div>
      <ToggleRow title="Late Alerts" text="Notify the line manager" checked={a} onChange={setA} />
      <ToggleRow title="Weekend Shifts" checked={b} onChange={setB} changed />
    </div>
  );
}

function Check() {
  const [v, setV] = useState(false);
  return <CheckboxField label="Send a Copy to Me" value={v} onChange={setV} />;
}

export default {
  component: "Switch",
  states: {
    Switch: () => <Switch checked onChange={() => undefined} label="Late Alerts" />,
    "Setting Rows": () => <Rows />,
    Checkbox: () => <Check />,
  },
} satisfies GalleryEntry;

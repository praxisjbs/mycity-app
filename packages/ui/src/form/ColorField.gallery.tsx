import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { ColorField } from "./ColorField";

/** Colours as a person pastes them, without the # (the field takes either). */
function Pasted({ start, label }: { start: string; label: string }) {
  const [v, setV] = useState(start);
  return (
    <Field label={label}>
      <ColorField value={v} onChange={setV} />
    </Field>
  );
}

export default {
  component: "ColorField",
  states: {
    Pasted: () => <Pasted start="1E2023" label="Card" />,
    Empty: () => <Pasted start="" label="Background" />,
    "Not a Colour": () => (
      <Field label="Brand Green" state="bad" message="Use #RRGGBB">
        <ColorField value="45C8B" onChange={() => undefined} />
      </Field>
    ),
    Refused: () => (
      <Field label="Background" state="bad" message="Too light for dark">
        <ColorField value="F4F4F4" onChange={() => undefined} />
      </Field>
    ),
  },
} satisfies GalleryEntry;

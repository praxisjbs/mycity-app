import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { TextField } from "./TextField";
import { MoreFields } from "./MoreFields";

const fields = (
  <>
    <Field label="Baseline" optional>
      <TextField value="38,000 in Q3" onChange={() => undefined} />
    </Field>
    <Field label="Owner Note" optional>
      <TextField value="CEO with interim finance owner" onChange={() => undefined} />
    </Field>
  </>
);

export default {
  component: "MoreFields",
  states: {
    Closed: () => <MoreFields>{fields}</MoreFields>,
    Open: () => <MoreFields defaultOpen>{fields}</MoreFields>,
    "Field Marked": () => (
      <MoreFields invalid>
        <Field label="Start" optional state="bad" message="Not a real date">
          <TextField value="31/02/2026" onChange={() => undefined} state="bad" />
        </Field>
      </MoreFields>
    ),
  },
} satisfies GalleryEntry;

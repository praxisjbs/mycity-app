import type { GalleryEntry } from "../testing/gallery";
import { Field, FormError, FormRow } from "./Field";
import { TextField } from "./TextField";

const noop = () => undefined;

export default {
  component: "Field",
  states: {
    Empty: () => (
      <Field label="First Name">
        <TextField value="" onChange={noop} />
      </Field>
    ),
    Optional: () => (
      <Field label="Middle Name" optional>
        <TextField value="" onChange={noop} />
      </Field>
    ),
    "With Help": () => (
      <Field label="Grace Period" help="Minutes after the shift starts before a clock-in counts as late.">
        <TextField value="10" onChange={noop} />
      </Field>
    ),
    Error: () => (
      <Field label="Work Email" state="bad" message="Check the email">
        <TextField value="ada@mycity" onChange={noop} />
      </Field>
    ),
    "Two Columns": () => (
      <FormRow>
        <Field label="First Name" state="good">
          <TextField value="Adaeze" onChange={noop} />
        </Field>
        <Field label="Last Name" state="good">
          <TextField value="Okafor" onChange={noop} />
        </Field>
      </FormRow>
    ),
    "Form Error": () => <FormError>Could not reach the server</FormError>,
  },
} satisfies GalleryEntry;

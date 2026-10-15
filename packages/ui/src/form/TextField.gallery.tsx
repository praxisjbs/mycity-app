import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { NumberField, PasswordField, PhoneField, TextAreaField, TextField } from "./TextField";

function Live({ kind, label }: { kind: "text" | "password" | "number" | "phone" | "area"; label: string }) {
  const [v, setV] = useState("");
  const C = { text: TextField, password: PasswordField, number: NumberField, phone: PhoneField, area: TextAreaField }[kind];
  return (
    <Field label={label}>
      <C value={v} onChange={setV} />
    </Field>
  );
}

export default {
  component: "TextField",
  states: {
    Text: () => <Live kind="text" label="Job Title" />,
    Password: () => <Live kind="password" label="New Password" />,
    "Whole Number": () => <Live kind="number" label="Annual Leave Days" />,
    Phone: () => <Live kind="phone" label="Mobile Number" />,
    "Long Text": () => <Live kind="area" label="Reason" />,
  },
} satisfies GalleryEntry;

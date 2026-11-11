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

function Years() {
  const [v, setV] = useState("9");
  return (
    <Field label="Years of Experience">
      <NumberField stepper={{ min: 0, max: 50 }} value={v} onChange={setV} className="max-w-60" />
    </Field>
  );
}

export default {
  component: "TextField",
  states: {
    Text: () => <Live kind="text" label="Job Title" />,
    Password: () => <Live kind="password" label="New Password" />,
    "Whole Number": () => <Live kind="number" label="Annual Leave Days" />,
    "Number Stepper": () => <Years />,
    Phone: () => <Live kind="phone" label="Mobile Number" />,
    "Long Text": () => <Live kind="area" label="Reason" />,
  },
} satisfies GalleryEntry;

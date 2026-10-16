import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { OtpField } from "./OtpField";

function Code({ start }: { start: string }) {
  const [v, setV] = useState(start);
  return <OtpField label="Sign-In Code" value={v} onChange={setV} />;
}

function Pin() {
  const [v, setV] = useState("58");
  return (
    <Field label="PIN">
      <OtpField label="PIN" length={4} secret value={v} onChange={setV} />
    </Field>
  );
}

export default {
  component: "OtpField",
  states: {
    Empty: () => <Code start="" />,
    Partly: () => <Code start="482" />,
    Wrong: () => <OtpField label="Sign-In Code" value="482913" onChange={() => undefined} state="bad" />,
    "Secret PIN": () => <Pin />,
  },
} satisfies GalleryEntry;

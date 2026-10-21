import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { SecretField } from "./SecretField";

function Live({ label, saved, hint, noun }: { label: string; saved?: boolean; hint?: string; noun?: "password" | "key" }) {
  const [v, setV] = useState("");
  return (
    <Field label={label}>
      <SecretField value={v} onChange={setV} saved={saved} hint={hint} noun={noun} />
    </Field>
  );
}

export default {
  component: "SecretField",
  states: {
    "Saved Key": () => <Live label="API Key" saved hint="1a2b" noun="key" />,
    "Saved Password": () => <Live label="Password" saved />,
    "Nothing Saved": () => <Live label="API Key" noun="key" />,
  },
} satisfies GalleryEntry;

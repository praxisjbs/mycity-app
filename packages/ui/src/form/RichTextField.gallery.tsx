import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { RichTextField } from "./RichTextField";

const Writing = () => {
  const [body, setBody] = useState("<p>Please approve this claim before Friday.</p>");
  return (
    <Field label="Message">
      <RichTextField label="Message" value={body} onChange={setBody} placeholder="Your message" />
    </Field>
  );
};

export default {
  component: "RichTextField",
  states: {
    Writing,
    Empty: () => <RichTextField label="Message" value="" onChange={() => undefined} placeholder="Your message" />,
    "Already Sent": () => (
      <RichTextField
        label="Message"
        readOnly
        value="<h2>Quarter close</h2><p>Every claim for September must be in by <strong>Friday</strong>.</p><ul><li>Receipts attached</li><li>Approved by your manager</li></ul>"
        onChange={() => undefined}
      />
    ),
    "With An Error": () => (
      <Field label="Message" state="bad" message="Say something">
        <RichTextField label="Message" value="" onChange={() => undefined} placeholder="Your message" />
      </Field>
    ),
  },
} satisfies GalleryEntry;

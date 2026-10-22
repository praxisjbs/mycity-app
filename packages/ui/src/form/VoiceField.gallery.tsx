import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { TextAreaField } from "./TextField";
import { VoiceField } from "./VoiceField";

const slowTranscribe = () => new Promise<string>((resolve) => setTimeout(() => resolve("He met every goal this quarter and took on the Lagos rollout."), 1200));

const Dictating = () => {
  const [text, setText] = useState("");
  return (
    <Field label="Comments" optional>
      <TextAreaField value={text} onChange={setText} rows={4} />
      <VoiceField label="Comments" transcribe={slowTranscribe} onTranscript={(words) => setText((t) => (t ? `${t} ${words}` : words))} className="mt-2" />
    </Field>
  );
};

export default {
  component: "VoiceField",
  states: {
    Dictating,
    "On Its Own": () => <VoiceField label="Comments" transcribe={slowTranscribe} onTranscript={() => undefined} />,
    Disabled: () => <VoiceField label="Comments" transcribe={slowTranscribe} onTranscript={() => undefined} disabled />,
    "In a Message Box": () => <VoiceField compact label="Question" transcribe={slowTranscribe} onTranscript={() => undefined} />,
  },
} satisfies GalleryEntry;

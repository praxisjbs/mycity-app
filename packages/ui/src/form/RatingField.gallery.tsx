import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { RatingField } from "./RatingField";

function Trait({ trait, initial }: { trait: string; initial: number | null }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <Field label={trait}>
      <RatingField value={v} onChange={setV} />
    </Field>
  );
}

function Card() {
  const [a, setA] = useState<number | null>(8);
  const [b, setB] = useState<number | null>(6);
  const [c, setC] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <Field label="Level of Confidence">
        <RatingField value={a} onChange={setA} />
      </Field>
      <Field label="Oral Communication Skills">
        <RatingField value={b} onChange={setB} />
      </Field>
      <Field label="Job Knowledge and Experience">
        <RatingField value={c} onChange={setC} />
      </Field>
    </div>
  );
}

function Missing() {
  const [v, setV] = useState<number | null>(null);
  return (
    <Field label="Stability Level in Career" state={v ? undefined : "bad"} message="Rate this trait">
      <RatingField value={v} onChange={setV} />
    </Field>
  );
}

function Overall() {
  const [v, setV] = useState<number | null>(4);
  return (
    <Field label="Overall Rating">
      <RatingField value={v} onChange={setV} max={5} />
    </Field>
  );
}

function Closed() {
  return (
    <div className="flex flex-col gap-3">
      <RatingField label="Appearance and Grooming" value={8} readOnly />
      <RatingField label="Level of Confidence" value={7.3} readOnly />
      <RatingField label="Accuracy in Language" value={null} readOnly />
    </div>
  );
}

export default {
  component: "RatingField",
  states: {
    "Interview Card": () => <Card />,
    "Not Rated": () => <Trait trait="Future Growth Potential in Career" initial={null} />,
    "Field Error": () => <Missing />,
    "Five Stars": () => <Overall />,
    "Round Closed": () => <Closed />,
  },
} satisfies GalleryEntry;

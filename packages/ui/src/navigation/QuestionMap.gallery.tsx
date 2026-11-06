import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { QuestionMap } from "./QuestionMap";

function Map() {
  const [at, setAt] = useState(1);
  return <QuestionMap label="Questions" count={3} at={at} answered={[true, false, false]} onPick={setAt} />;
}

export default {
  component: "QuestionMap",
  states: {
    "Question 2 of 3": () => <Map />,
  },
} satisfies GalleryEntry;

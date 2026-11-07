import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { DocumentFrame } from "./DocumentFrame";
// The proposal kit's sample (scripts/gen/proposal-kit.js): pages in the shape the server draws them.
import sample from "./proposal-kit.sample.html?raw";

function Picking() {
  const [key, setKey] = useState<string | null>("opportunity");
  return <DocumentFrame title="Proposal PRO-0012" html={sample} selected={key} onSelect={setKey} />;
}

export default {
  component: "DocumentFrame",
  states: {
    "Read Only": () => <DocumentFrame title="Proposal PRO-0012" html={sample} />,
    "Pages to Pick": () => <Picking />,
  },
} satisfies GalleryEntry;

import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { InlineInput, InlineLabel, InlineSelect } from "./InlineInput";

function Message() {
  const [v, setV] = useState("");
  return <InlineInput aria-label="Message" placeholder="Message" value={v} onChange={setV} className="h-control w-full rounded-full border border-input bg-background px-3" />;
}

function Row() {
  const [v, setV] = useState("ops");
  return (
    <span className="flex items-center gap-2">
      <InlineLabel htmlFor="inline-to" className="text-sm text-muted-foreground">
        To
      </InlineLabel>
      <InlineSelect id="inline-to" value={v} onChange={setV} options={[["ops", "Operations"], ["hr", "People"]]} className="h-control rounded-ctl border border-input bg-background px-2" />
    </span>
  );
}

export default {
  component: "InlineInput",
  states: {
    "Message Box": () => <Message />,
    "Composer Row": () => <Row />,
  },
} satisfies GalleryEntry;

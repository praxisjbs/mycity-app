import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { NoteTaker, type NoteSave } from "./NoteTaker";

function Notes({ start = "", saved = "saved" as NoteSave, loading = false }) {
  const [value, setValue] = useState(start);
  return (
    <NoteTaker
      open
      onClose={() => undefined}
      subject="NDPA Data Protection Essentials"
      value={value}
      onChange={setValue}
      saved={saved}
      onRetry={() => undefined}
      loading={loading}
      onDownload={() => new Promise((done) => setTimeout(done, 600))}
    />
  );
}

export default {
  component: "NoteTaker",
  states: {
    "With Notes": () => <Notes start={"Personal data names a person.\nLock the screen before leaving the desk.\nReport a breach to the DPO within the day."} />,
    Empty: () => <Notes saved={null} />,
    Saving: () => <Notes start="Lawful basis: consent" saved="saving" />,
    "Not Saved": () => <Notes start="Lawful basis: consent" saved="failed" />,
    Loading: () => <Notes saved={null} loading />,
  },
} satisfies GalleryEntry;

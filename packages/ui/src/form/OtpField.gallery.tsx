import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { OtpField } from "./OtpField";

function Code({ start }: { start: string }) {
  const [v, setV] = useState(start);
  return <OtpField label="Sign-In Code" value={v} onChange={setV} />;
}

export default {
  component: "OtpField",
  states: {
    Empty: () => <Code start="" />,
    Partly: () => <Code start="482" />,
    Wrong: () => <OtpField label="Sign-In Code" value="482913" onChange={() => undefined} state="bad" />,
  },
} satisfies GalleryEntry;

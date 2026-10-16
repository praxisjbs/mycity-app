import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Tick } from "./Tick";

const Pressing = () => {
  const [on, setOn] = useState(false);
  return <Tick checked={on} onChange={setOn} label="Select Ada Obi" />;
};

export default {
  component: "Tick",
  states: {
    Empty: () => <Tick checked={false} onChange={() => undefined} label="Select Page" />,
    Ticked: () => <Tick checked onChange={() => undefined} label="Select Page" />,
    Pressing,
    Disabled: () => <Tick checked={false} onChange={() => undefined} label="Select Page" disabled />,
  },
} satisfies GalleryEntry;

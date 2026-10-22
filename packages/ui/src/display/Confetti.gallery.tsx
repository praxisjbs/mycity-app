import { useRef, useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Confetti } from "./Confetti";

/* A card that bursts the first time it is in view, and again from its button. */
function Card({ shape, on, title }: { shape: "paper" | "stars"; on: "card" | "brand"; title: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const [presses, setPresses] = useState(0);
  return (
    <div className={on === "brand" ? "relative isolate overflow-hidden rounded-sheet bg-secondary p-6 text-secondary-foreground" : "relative isolate overflow-hidden rounded-sheet border border-border bg-card p-6"}>
      <Confetti shape={shape} on={on} burstOnView burst={presses} from={button} />
      <b className="block text-xl">{title}</b>
      <Button ref={button} variant="primary" icon="party" className="mt-4" onClick={() => setPresses((n) => n + 1)}>
        Celebrate
      </Button>
    </div>
  );
}

export default {
  component: "Confetti",
  states: {
    "A Birthday": () => <Card shape="paper" on="card" title="Happy Birthday, Adaeze" />,
    "An Anniversary": () => <Card shape="stars" on="brand" title="Three Years at MyCity" />,
  },
} satisfies GalleryEntry;

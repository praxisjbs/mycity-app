import type { GalleryEntry } from "../testing/gallery";
import { Confetti } from "./Confetti";

const card = (shape: "paper" | "stars", title: string, warm: boolean) => (
  <div className={`sheen relative isolate flex h-36 items-center gap-4 overflow-hidden rounded-sheet p-4 text-on-deep ${warm ? "celebrate-warm" : "celebrate-cool"}`}>
    <Confetti shape={shape} />
    <span className={`relative flex size-16 flex-none animate-spin-slow items-center justify-center rounded-full p-1 ${warm ? "ring-warm" : "ring-cool"}`}>
      <span className="flex size-full items-center justify-center rounded-full border-2 border-deep bg-primary text-xl font-bold text-primary-foreground">AO</span>
    </span>
    <span className="relative">
      <b className="block text-lg">{title}</b>
      <span className="text-xs opacity-85">Adaeze Okonkwo</span>
    </span>
  </div>
);

export default {
  component: "Confetti",
  states: {
    "A Birthday": () => card("paper", "Happy Birthday", true),
    "An Anniversary": () => card("stars", "Four Years Today", false),
    "On Its Own": () => (
      <div className="relative h-32 overflow-hidden rounded-card bg-deep">
        <Confetti />
      </div>
    ),
  },
} satisfies GalleryEntry;

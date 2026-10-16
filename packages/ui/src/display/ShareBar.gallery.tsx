import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { cn } from "../lib/cn";
import { ShareBar } from "./ShareBar";

const OPTIONS = [
  { text: "Lekki Office", votes: 14 },
  { text: "Ikeja Depot", votes: 6 },
  { text: "Either suits me", votes: 3 },
];

const Poll = () => {
  const [mine, setMine] = useState<number | null>(0);
  const total = OPTIONS.reduce((sum, o) => sum + o.votes, 0);
  return (
    <div className="max-w-136 rounded-card border border-border bg-background px-3.5 py-3">
      <h3 className="mb-2 text-sm">Where should the town hall be?</h3>
      {OPTIONS.map((option, i) => {
        const percent = Math.round((option.votes * 100) / total);
        return (
          <button
            key={option.text}
            type="button"
            onClick={() => setMine(i)}
            aria-pressed={mine === i}
            className={cn("relative mb-1.5 block w-full overflow-hidden rounded-box border px-2.5 py-2 text-left text-xs phone:min-h-tap", mine === i ? "border-secondary" : "border-border")}
          >
            <ShareBar percent={percent} />
            <span className={cn("relative flex justify-between gap-2", mine === i && "font-strong")}>
              <span>{option.text}</span>
              <span>{percent}%</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default {
  component: "ShareBar",
  states: {
    "A Poll": Poll,
    Empty: () => (
      <button type="button" className="relative block w-full overflow-hidden rounded-box border border-border px-2.5 py-2 text-left text-xs phone:min-h-tap">
        <ShareBar percent={0} />
        <span className="relative">No votes yet</span>
      </button>
    ),
  },
} satisfies GalleryEntry;

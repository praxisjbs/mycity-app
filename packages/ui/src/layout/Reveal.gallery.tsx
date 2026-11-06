import type { GalleryEntry } from "../testing/gallery";
import { Reveal, Stagger } from "./Reveal";

const tile = (title: string, text: string) => (
  <div className="rounded-sheet border border-border bg-card p-6">
    <h3 data-ui="title" className="text-xl font-strong">
      {title}
    </h3>
    <p className="mt-1 text-md text-muted-foreground">{text}</p>
  </div>
);

export default {
  component: "Reveal",
  states: {
    "Rising Tiles": () => (
      <div className="grid grid-cols-1 gap-5 desk:grid-cols-2">
        <Reveal lift>{tile("Discover Places", "Restaurants, experiences and the places worth knowing.")}</Reveal>
        <Reveal lift delay={200}>
          {tile("Find What's On", "Events and what is happening around you.")}
        </Reveal>
      </div>
    ),
    "From Each Side": () => (
      <div className="grid grid-cols-1 gap-5 desk:grid-cols-2">
        <Reveal as="article" from="left" lift="shadow">
          {tile("Know Someone Great?", "Send them our roles.")}
        </Reveal>
        <Reveal as="article" from="right" delay={120} lift="shadow">
          {tile("Verify a Document", "Check an offer letter by its reference.")}
        </Reveal>
      </div>
    ),
    "Staggered Steps": () => (
      <Stagger as="ol" step={120} className="grid grid-cols-1 gap-6 desk:grid-cols-4">
        {["Apply", "Screening", "Assessment", "Interview"].map((t, i) => (
          <div key={t} className="text-center">
            <p className="text-3xl font-strong">{i + 1}</p>
            <h3 data-ui="title" className="mt-2 text-xl font-strong">
              {t}
            </h3>
          </div>
        ))}
      </Stagger>
    ),
    "Tied to the Scroll": () => <Reveal scroll>{tile("Responsibilities", "Lead the sales team across Lagos.")}</Reveal>,
  },
} satisfies GalleryEntry;

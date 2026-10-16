import type { GalleryEntry } from "../testing/gallery";
import { SplitPanes, useSplitPanes } from "./SplitPanes";

const list = (
  <div className="flex flex-col gap-1 p-2">
    {["Adaeze Okonkwo", "Chidi Eze", "Ngozi Bello", "Tunde Balogun"].map((name, i) => (
      <button key={name} type="button" className={`rounded-box px-2 py-2 text-left text-sm ${i === 0 ? "bg-muted bar-selected" : "hover:bg-muted"}`}>
        <b className="block truncate font-semibold">{name}</b>
        <span className="block truncate text-2xs text-subtle-foreground">Quarter close is Friday</span>
      </button>
    ))}
  </div>
);

const detail = (
  <div className="p-4">
    <h3 className="text-lg">Quarter close is Friday</h3>
    <p className="mt-2 text-sm text-muted-foreground">Every claim for September must be in by Friday, with receipts attached.</p>
  </div>
);

const aside = <div className="rounded-card border border-border bg-card p-3 text-xs text-muted-foreground shadow-1">Channel members, files and pinned messages.</div>;

const Panes = () => <SplitPanes split={useSplitPanes("gallery", 300)} list={list} detail={detail} />;
const WithAside = () => <SplitPanes split={useSplitPanes("gallery-aside", 280)} list={list} detail={detail} aside={aside} />;
const Opened = () => <SplitPanes split={useSplitPanes("gallery-open", 300)} list={list} detail={detail} open />;

export default {
  component: "SplitPanes",
  states: { "Two Panes": Panes, "With An Aside": WithAside, "Record Open": Opened },
} satisfies GalleryEntry;

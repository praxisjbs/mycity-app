import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { MediaViewer, type ViewerItem } from "./MediaViewer";
import { SAMPLE_IMAGE, samplePdfBlob } from "./fixtures";

const ITEMS: ViewerItem[] = [
  { key: "stage", name: "Stage.jpg", mime: "image/svg+xml", by: "Bola Ade", at: "Today, 14:02", caption: "Stage build for the Lagos leg, more at nfelia.com", poster: SAMPLE_IMAGE },
  { key: "sheet", name: "Call sheet.pdf", mime: "application/pdf", by: "Tunde Ola", at: "Today, 14:05" },
];

/* The gallery holds no server: the photo is the sample picture and the PDF the sample bytes. */
const load = async (item: ViewerItem): Promise<Blob> => (item.mime === "application/pdf" ? samplePdfBlob() : (await fetch(SAMPLE_IMAGE)).blob());

function Opens({ start }: { start: number }) {
  const [ref, frame] = useGalleryFrame();
  const [at, setAt] = useState<number | null>(null);
  return (
    <div ref={ref}>
      <Button variant="primary" icon="image" onClick={() => setAt(start)}>
        Open File
      </Button>
      <MediaViewer open={at !== null} items={ITEMS} index={at ?? 0} onIndex={setAt} onClose={() => setAt(null)} load={load} container={frame} />
    </div>
  );
}

export default {
  component: "MediaViewer",
  states: {
    Photo: () => <Opens start={0} />,
    PDF: () => <Opens start={1} />,
  },
} satisfies GalleryEntry;

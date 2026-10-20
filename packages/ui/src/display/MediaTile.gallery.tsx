import type { GalleryEntry } from "../testing/gallery";
import { SAMPLE_IMAGE } from "../documents/fixtures";
import { MediaAlbum, MediaTile } from "./MediaTile";

const album = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `p${i}`, src: SAMPLE_IMAGE, alt: `Stage ${i + 1}.jpg` }));

export default {
  component: "MediaTile",
  states: {
    Photo: () => <MediaTile src={SAMPLE_IMAGE} alt="Stage.jpg" width={400} height={280} />,
    Loading: () => <MediaTile src={null} alt="Stage.jpg" width={1200} height={1600} />,
    Video: () => <MediaTile src={SAMPLE_IMAGE} alt="Walkthrough.mp4" kind="video" duration="0:42" width={400} height={280} />,
    Album: () => <MediaAlbum tiles={album(7)} />,
    "Picked Files": () => (
      <div className="grid w-72 grid-cols-3 gap-1">
        <MediaTile src={SAMPLE_IMAGE} alt="Stage.jpg" fit="square" onRemove={() => undefined} />
        <MediaTile src={null} alt="Budget.xlsx" kind="file" glyph="sheet" fit="square" onRemove={() => undefined} />
        <MediaTile src={null} alt="Call sheet.pdf" kind="file" glyph="doc" fit="square" onRemove={() => undefined} />
      </div>
    ),
  },
} satisfies GalleryEntry;

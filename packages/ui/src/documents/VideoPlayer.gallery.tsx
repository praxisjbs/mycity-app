import type { GalleryEntry } from "../testing/gallery";
import { VideoPlayer } from "./VideoPlayer";

export default {
  component: "VideoPlayer",
  states: {
    YouTube: () => <VideoPlayer title="Why Data Matters" youtubeId="dQw4w9WgXcQ" />,
    "Uploaded Video": () => <VideoPlayer title="Platform Walkthrough" load={() => new Promise<Blob>(() => undefined)} />,
    "Did Not Load": () => <VideoPlayer title="Platform Walkthrough" load={() => Promise.reject(new Error("Files open once the API is connected"))} />,
    "No Video": () => <VideoPlayer title="Old Link" youtubeId={null} />,
  },
} satisfies GalleryEntry;

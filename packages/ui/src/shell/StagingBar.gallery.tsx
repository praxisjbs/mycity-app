import type { GalleryEntry } from "../testing/gallery";
import { StagingBar } from "./StagingBar";

export default {
  component: "StagingBar",
  states: {
    "Staff App": () => <StagingBar placement="inline" message="For training and testing. Every feature works and mail reaches real people." short="Mail here is real" />,
    "Public Site": () => <StagingBar placement="inline" message="A test copy of the site. Applications here are not for real roles." short="A test copy" />,
  },
} satisfies GalleryEntry;

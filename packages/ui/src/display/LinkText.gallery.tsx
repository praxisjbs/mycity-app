import type { GalleryEntry } from "../testing/gallery";
import { LinkText } from "./LinkText";

export default {
  component: "LinkText",
  states: {
    "With Links": () => <LinkText text="Stage build for the Lagos leg is confirmed: https://nfelia.com/lagos and mycityapp.io/events." />,
    "Search Match": () => <LinkText text="Shot list for Friday is on nfelia.com" highlight="friday" />,
    "No Links": () => <LinkText text={"Call time is 08:00.\nBring the second camera."} />,
  },
} satisfies GalleryEntry;

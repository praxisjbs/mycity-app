import type { GalleryEntry } from "../testing/gallery";
import { Accordion } from "./Accordion";

const FAQS = [
  { title: "How do I claim overtime?", body: "Open My Attendance, find the day, and add the hours. Your manager approves it with the week." },
  { title: "When is payday?", body: "The 25th, or the working day before it when the 25th is a Sunday or a holiday." },
  { title: "Who approves my leave?", body: "Your line manager, then People where the request runs past ten working days." },
];

export default {
  component: "Accordion",
  states: {
    Default: () => <Accordion items={FAQS} />,
    "First Open": () => <Accordion items={[{ ...FAQS[0]!, open: true }, FAQS[1]!, FAQS[2]!]} />,
    "One Item": () => <Accordion items={[FAQS[0]!]} />,
  },
} satisfies GalleryEntry;

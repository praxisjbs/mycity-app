import type { GalleryEntry } from "../testing/gallery";
import { StepBar } from "./StepBar";

const steps = ["Name", "Access", "Details", "Review"];

export default {
  component: "StepBar",
  states: {
    "First Step": () => <StepBar steps={steps} at={0} />,
    "Second Step": () => <StepBar steps={steps} at={1} />,
    "Third Step": () => <StepBar steps={steps} at={2} />,
    "Last Step": () => <StepBar steps={steps} at={3} />,
    Titled: () => <StepBar steps={steps} at={1} titled />,
  },
} satisfies GalleryEntry;

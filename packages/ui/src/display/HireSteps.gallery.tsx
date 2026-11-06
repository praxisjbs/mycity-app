import type { GalleryEntry } from "../testing/gallery";
import { HireSteps } from "./HireSteps";

export default {
  component: "HireSteps",
  states: {
    "Four Steps": () => (
      <HireSteps
        label="How We Hire"
        steps={[
          { title: "Apply", text: "Your CV and a short cover letter, on one form." },
          { title: "Screening", text: "Our team reads every application against the role." },
          { title: "Assessment", text: "A short test or a practical brief, for some roles." },
          { title: "Interview", text: "Meet the panel in person, by video or by phone." },
        ]}
      />
    ),
    Compact: () => <HireSteps compact label="How We Hire" steps={[{ title: "Apply" }, { title: "Screening" }, { title: "Assessment" }, { title: "Interview" }]} />,
  },
} satisfies GalleryEntry;

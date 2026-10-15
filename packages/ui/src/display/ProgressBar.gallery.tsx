import type { GalleryEntry } from "../testing/gallery";
import { Meter, ProgressBar } from "./ProgressBar";

export default {
  component: "ProgressBar",
  states: {
    Determinate: () => <ProgressBar label="Importing Employees" value={64} />,
    Indeterminate: () => <ProgressBar label="Preparing Payslips" />,
    Complete: () => <ProgressBar label="Onboarding Steps" value={100} tone="ok" />,
    Meter: () => (
      <div className="flex w-64 flex-col gap-2">
        <Meter pct={40} label="8 of 20" name="Annual Leave Used" />
        <Meter pct={75} label="75%" name="Target Met" tone="ok" />
        <Meter pct={95} label="95%" name="Budget Used" tone="warn" />
      </div>
    ),
  },
} satisfies GalleryEntry;

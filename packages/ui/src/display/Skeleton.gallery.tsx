import type { GalleryEntry } from "../testing/gallery";
import { Skeleton, Spinner } from "./Skeleton";

export default {
  component: "Skeleton",
  states: {
    Lines: () => <Skeleton lines={5} />,
    Shapes: () => (
      <div className="flex items-center gap-3">
        <Skeleton shape="circle" />
        <Skeleton className="w-40" />
        <Skeleton shape="block" className="h-16 w-32" />
      </div>
    ),
    Spinner: () => <Spinner label="Loading payslips" size="m" />,
  },
} satisfies GalleryEntry;

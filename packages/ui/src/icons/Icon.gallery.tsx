import type { GalleryEntry } from "../testing/gallery";
import { ICON_NAMES, Icon } from "./Icon";

export default {
  component: "Icon",
  states: {
    "All Icons": () => (
      <ul className="grid grid-cols-4 gap-2 desk:grid-cols-8">
        {ICON_NAMES.map((name) => (
          <li key={name} className="flex flex-col items-center gap-1 rounded-box border border-border p-2 text-muted-foreground">
            <Icon name={name} size="m" className="text-foreground" />
            <code className="text-2xs" data-copy="content">
              {name}
            </code>
          </li>
        ))}
      </ul>
    ),
    Sizes: () => (
      <div className="flex items-center gap-4">
        <Icon name="clock" size="s" label="Small" />
        <Icon name="clock" size="m" label="Medium" />
        <Icon name="clock" size="l" label="Large" />
      </div>
    ),
    "Status Colours": () => (
      <div className="flex items-center gap-4">
        <Icon name="ok" size="m" className="text-success" label="Approved" />
        <Icon name="alert" size="m" className="text-warning" label="Late" />
        <Icon name="x" size="m" className="text-destructive" label="Rejected" />
        <Icon name="info" size="m" className="text-info" label="Pending" />
      </div>
    ),
  },
} satisfies GalleryEntry;

import type { GalleryEntry } from "../testing/gallery";
import { Avatar, Who } from "./Avatar";

export default {
  component: "Avatar",
  states: {
    Sizes: () => (
      <div className="flex items-center gap-3">
        <Avatar name="Cynthia Osakunih" size="xs" />
        <Avatar name="Cynthia Osakunih" size="sm" />
        <Avatar name="Cynthia Osakunih" size="md" />
        <Avatar name="Cynthia Osakunih" size="lg" />
        <Avatar name="Cynthia Osakunih" size="xl" />
      </div>
    ),
    Presence: () => (
      <div className="flex items-center gap-3">
        <Avatar name="Tobi Adeyemi" size="lg" presence="online" label="Tobi Adeyemi" />
        <Avatar name="Adaeze Okafor" size="lg" presence="away" label="Adaeze Okafor" />
        <Avatar name="Emeka Nwosu" size="lg" presence="busy" label="Emeka Nwosu" />
        <Avatar name="Bisi Lawal" size="lg" presence="offline" label="Bisi Lawal" />
      </div>
    ),
    Brand: () => <Avatar name="Tom Blake" tone="brand" size="md" label="Tom Blake" />,
    Who: () => <Who name="Tobi Adeyemi" role="Field Sales, Lekki" size="md" presence="online" />,
  },
} satisfies GalleryEntry;

import type { GalleryEntry } from "../testing/gallery";
import { Rail } from "./Rail";
import { RAIL_ITEMS } from "./fixtures";

const account = { name: "Cynthia Osakunih", subtitle: "Operations Manager", menu: [{ label: "My Profile", icon: "user" as const, onSelect: () => undefined }, "sep" as const, { label: "Sign Out", icon: "logout" as const, onSelect: () => undefined }] };

export default {
  component: "Rail",
  states: {
    Open: () => (
      <div className="flex h-120">
        <Rail items={RAIL_ITEMS} current="people" account={account} foot="Engineered by JBS Praxis" />
      </div>
    ),
    Collapsed: () => (
      <div className="flex h-120">
        <Rail items={RAIL_ITEMS} current="people" collapsed account={account} />
      </div>
    ),
  },
} satisfies GalleryEntry;

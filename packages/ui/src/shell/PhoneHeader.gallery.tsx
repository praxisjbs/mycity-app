import type { GalleryEntry } from "../testing/gallery";
import { IconButton } from "../actions/Button";
import { Avatar } from "../display/Avatar";
import { Tabs } from "../navigation/Tabs";
import { PhoneHeader } from "./PhoneHeader";
import { ShellScrollContext } from "./scroll";

const actions = (
  <>
    <IconButton icon="srch" label="Search" />
    <IconButton icon="bell" label="Notifications" dot />
    <button type="button" aria-label="Your Account" className="flex size-tap items-center justify-center rounded-full">
      <Avatar name="Cynthia Osakunih" size="sm" tone="brand" />
    </button>
  </>
);
const tabs = (
  <Tabs
    label="Queries"
    value="queries"
    items={[
      { value: "queries", label: "Queries" },
      { value: "rules", label: "Rules" },
      { value: "sanctions", label: "Sanctions" },
    ]}
  />
);

export default {
  component: "PhoneHeader",
  states: {
    "At Rest": () => <PhoneHeader title="Queries & Sanctions" homeHref="#/PhoneHeader" actions={actions} tabs={tabs} />,
    "Long Title": () => <PhoneHeader title="Employee Self-Service and Records" homeHref="#/PhoneHeader" actions={actions} />,
    "Scrolled Down": () => (
      <ShellScrollContext.Provider value={{ direction: "down", atTop: false }}>
        <PhoneHeader title="Queries & Sanctions" homeHref="#/PhoneHeader" actions={actions} tabs={tabs} />
      </ShellScrollContext.Provider>
    ),
  },
} satisfies GalleryEntry;

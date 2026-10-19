import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { TabPanel, Tabs, type TabItem } from "./Tabs";

const MODULE: TabItem[] = [
  { value: "register", label: "Register" },
  { value: "assignments", label: "Field Assignments", count: 3 },
  { value: "requests", label: "Location Requests", count: 12 },
  { value: "worksites", label: "Worksites" },
  { value: "devices", label: "Devices" },
  { value: "policy", label: "Policy", disabled: true },
];

function Strip() {
  const [tab, setTab] = useState("register");
  return <Tabs label="Attendance" value={tab} onValueChange={setTab} items={MODULE.map((t) => ({ ...t, href: `#/Tabs?tab=${t.value}` }))} />;
}

const ESS: TabItem[] = ["My Profile", "My Attendance", "Work Location Requests", "My Devices", "My Performance", "My Payslips", "My Leave", "My Queries", "My Documents", "My Security", "Org Chart"].map((label, i) => ({
  value: label.toLowerCase().replace(/ /g, "-"),
  label,
  count: i === 8 ? 1 : undefined,
}));

/** A desktop window too narrow for the module's tabs: what fits, the rest behind More Tabs. */
function Narrow() {
  const [tab, setTab] = useState("my-profile");
  return (
    <div className="max-w-md">
      <Tabs label="Employee Self-Service" value={tab} onValueChange={setTab} items={ESS} />
    </div>
  );
}

function WithPanels() {
  const [tab, setTab] = useState("profile");
  return (
    <Tabs
      label="Employee"
      value={tab}
      onValueChange={setTab}
      items={[
        { value: "profile", label: "Profile" },
        { value: "leave", label: "Leave", count: 2 },
        { value: "documents", label: "Documents" },
      ]}
    >
      <TabPanel value="profile">
        <p className="text-sm">Ada Okafor, Operations, Lekki Office</p>
      </TabPanel>
      <TabPanel value="leave">
        <p className="text-sm">12 days left, 2 requests waiting</p>
      </TabPanel>
      <TabPanel value="documents">
        <p className="text-sm">Contract, NDA, ID Card</p>
      </TabPanel>
    </Tabs>
  );
}

export default {
  component: "Tabs",
  states: {
    "Module Strip": () => <Strip />,
    "With Panels": () => <WithPanels />,
    "Many Tabs, Narrow": () => <Narrow />,
  },
} satisfies GalleryEntry;

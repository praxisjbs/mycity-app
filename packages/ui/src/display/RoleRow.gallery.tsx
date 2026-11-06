import type { GalleryEntry } from "../testing/gallery";
import { RoleListTop, RoleRow } from "./RoleRow";

export default {
  component: "RoleRow",
  states: {
    "The List": () => (
      <div>
        <RoleListTop shown={3} total={12} order="Closing soonest first" />
        <RoleRow href="#/RoleRow" team="Operations & People" title="Operations Intern" facts={[{ icon: "pin", text: "Lekki Phase 1, Lagos" }, { icon: "building", text: "On Site" }, { icon: "brief", text: "Internship" }]} closes="11/11/2026" />
        <RoleRow href="#/RoleRow" team="Marketing & Sales" title="Head, Sales & Revenue" facts={[{ icon: "pin", text: "Lekki Phase 1, Lagos" }, { icon: "building", text: "Hybrid, 2 days in office" }, { icon: "brief", text: "Full Time" }]} closes="18/11/2026" />
        <RoleRow href="#/RoleRow" team="Content" title="City Editor, Abuja" facts={[{ icon: "pin", text: "Wuse, Abuja" }, { icon: "building", text: "On Site" }, { icon: "brief", text: "Full Time" }]} closes="25/11/2026" />
      </div>
    ),
  },
} satisfies GalleryEntry;

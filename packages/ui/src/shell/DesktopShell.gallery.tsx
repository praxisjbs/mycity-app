import type { GalleryEntry } from "../testing/gallery";
import { useIsPhone } from "../lib/media";
import { IconButton } from "../actions/Button";
import { Card } from "../layout/Card";
import { PageHeader } from "../layout/PageHeader";
import { Tabs } from "../navigation/Tabs";
import { DesktopShell } from "./DesktopShell";
import { Rail } from "./Rail";
import { SearchButton, TopBar } from "./TopBar";
import { RAIL_ITEMS } from "./fixtures";

/** The desktop frame never shows on a phone; the gallery's phone view draws it with the rail collapsed so it fits. */
function Shell({ open }: { open: boolean }) {
  const phone = useIsPhone();
  const collapsed = !open || phone;
  return (
    <div className="h-120 overflow-hidden rounded-box border border-border">
      <DesktopShell
        landmarks={false}
        rail={<Rail items={RAIL_ITEMS} current="people" collapsed={collapsed} />}
        topBar={
          <TopBar
            start={<IconButton icon="panel" label={collapsed ? "Expand Menu" : "Collapse Menu"} />}
            search={<SearchButton onClick={() => undefined} />}
            actions={<IconButton icon="bell" label="Notifications" dot />}
          />
        }
        tabs={
          <Tabs
            label="People"
            value="employees"
            items={[
              { value: "employees", label: "Employees" },
              { value: "attendance", label: "Attendance" },
              { value: "leave", label: "Leave" },
            ]}
          />
        }
      >
        <PageHeader title="Employees" />
        <Card>
          <p className="text-sm" data-copy="content">
            25 employees
          </p>
        </Card>
      </DesktopShell>
    </div>
  );
}

export default {
  component: "DesktopShell",
  states: {
    "Rail Open": () => <Shell open />,
    "Rail Collapsed": () => <Shell open={false} />,
  },
} satisfies GalleryEntry;

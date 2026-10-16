import type { GalleryEntry } from "../testing/gallery";
import { IconButton } from "../actions/Button";
import { Avatar } from "../display/Avatar";
import { Card } from "../layout/Card";
import { PageHeader } from "../layout/PageHeader";
import { Tabs } from "../navigation/Tabs";
import { PhoneShell } from "./PhoneShell";
import { PhoneHeader } from "./PhoneHeader";
import { BottomBar } from "./BottomBar";
import { FloatingButton } from "./FloatingButton";
import { BOTTOM_ITEMS } from "./fixtures";

export default {
  component: "PhoneShell",
  states: {
    "My Profile": () => (
      <div className="mx-auto h-160 max-w-96 overflow-hidden rounded-sheet border border-border">
        <PhoneShell
          landmarks={false}
          header={
            <PhoneHeader
              title="Employee Self-Service"
              homeHref="#/PhoneShell"
              actions={
                <>
                  <IconButton icon="srch" label="Search" />
                  <IconButton icon="bell" label="Notifications" dot />
                  <button type="button" aria-label="Your Account" className="flex size-tap items-center justify-center rounded-full">
                    <Avatar name="Cynthia Osakunih" size="sm" tone="brand" />
                  </button>
                </>
              }
              tabs={
                <Tabs
                  label="Employee Self-Service"
                  value="my-profile"
                  items={[
                    { value: "my-profile", label: "My Profile" },
                    { value: "my-attendance", label: "My Attendance" },
                    { value: "my-leave", label: "My Leave" },
                  ]}
                />
              }
            />
          }
          bottomBar={<BottomBar items={BOTTOM_ITEMS(() => undefined)} current="ess" />}
          fab={<FloatingButton actions={[{ key: "clock", label: "Clock In", icon: "clock", onSelect: () => undefined }]} onHideHere={() => undefined} />}
        >
          <PageHeader title="My Profile" />
          <Card>
            <p className="text-sm" data-copy="content">
              Cynthia Osakunih · Operations Manager
            </p>
          </Card>
        </PhoneShell>
      </div>
    ),
  },
} satisfies GalleryEntry;

import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { PageHeader } from "./PageHeader";

export default {
  component: "PageHeader",
  states: {
    Default: () => <PageHeader title="My Attendance" subtitle="October 2026" />,
    "With Action": () => (
      <PageHeader
        title="My Leave"
        subtitle="2026 entitlement"
        actions={
          <Button variant="primary" icon="plus">
            Request Leave
          </Button>
        }
      />
    ),
    "Two Actions": () => (
      <PageHeader
        title="Worksites"
        subtitle="Geofenced locations"
        actions={
          <>
            <Button icon="doc">Export</Button>
            <Button variant="primary" icon="plus">
              Add Worksite
            </Button>
          </>
        }
      />
    ),
    "Title Only": () => <PageHeader title="Payslips" />,
  },
} satisfies GalleryEntry;

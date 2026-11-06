import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { RoleCard, ShareCard } from "./RoleCard";

export default {
  component: "RoleCard",
  states: {
    "The Role": () => (
      <div className="max-w-85">
        <RoleCard
          title="The Role"
          items={[
            { label: "Employment", value: "Full Time" },
            { label: "Working Days", value: "Monday to Saturday" },
            { label: "Experience", value: "At least 8 years" },
            { label: "Reports To", value: "Chief Executive Officer" },
            { label: "Probation", value: "6 months" },
          ]}
          closing="Closes 18/11/2026"
          action={
            <Button variant="primary" size="lg" block>
              Apply Now
            </Button>
          }
          note="12 people have applied"
        />
        <ShareCard
          title="Know Someone for This?"
          text="Send them this role. Their application comes straight to us."
          action={
            <Button variant="line" size="sm">
              Copy Role Link
            </Button>
          }
        />
      </div>
    ),
  },
} satisfies GalleryEntry;

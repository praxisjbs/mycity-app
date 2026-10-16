import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Pill } from "./Pill";
import { BackButton, ProfileHeader } from "./ProfileHeader";

export default {
  component: "ProfileHeader",
  states: {
    "A Person": () => (
      <ProfileHeader
        name="Adaeze Okonkwo"
        role="Financial Controller · Finance"
        chips={
          <>
            <Pill tone="ok">Active</Pill>
            <Pill>Grade 4</Pill>
            <Pill>Full Time</Pill>
          </>
        }
        actions={
          <>
            <Button icon="mail">Send Letter</Button>
            <Button variant="primary" icon="edit">
              Edit Record
            </Button>
          </>
        }
      />
    ),
    "A Partner": () => (
      <ProfileHeader name="Lagos Water Board" role="Public Sector · Lagos Island" brand chips={<Pill tone="warn">Proposal Out</Pill>} actions={<Button icon="plus">Log Contact</Button>} />
    ),
    "Name Only": () => <ProfileHeader name="Ngozi Bello" />,
    "With Back": () => (
      <div>
        <BackButton label="Back to Employees" onBack={() => undefined} />
        <ProfileHeader name="Adaeze Okonkwo" role="Financial Controller" chips={<Pill tone="ok">Active</Pill>} />
      </div>
    ),
  },
} satisfies GalleryEntry;

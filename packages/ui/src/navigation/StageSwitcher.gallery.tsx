import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { StageSwitcher } from "./StageSwitcher";

/** MyCity's stages as its tracker lists them (docs/guides/partnerships.md §6.3). */
const STAGES = [
  { code: "prospect_identified", label: "Prospect Identified" },
  { code: "initial_contact", label: "Initial Contact" },
  { code: "intro_meeting_held", label: "Meeting Held" },
  { code: "proposal_sent", label: "Proposal Sent" },
  { code: "negotiation", label: "Negotiation" },
  { code: "partnership_signed", label: "Partnership Signed" },
  { code: "active_partnership", label: "Active Partnership" },
  { code: "closed_lost", label: "Closed Lost" },
  { code: "on_hold", label: "On Hold" },
];

function Moving() {
  const [stage, setStage] = useState("proposal_sent");
  return <StageSwitcher stages={STAGES} value={stage} onMove={(code) => new Promise<void>((resolve) => setTimeout(() => (setStage(code), resolve()), 600))} />;
}

function Start() {
  const [stage, setStage] = useState("prospect_identified");
  return <StageSwitcher stages={STAGES} value={stage} onMove={setStage} />;
}

export default {
  component: "StageSwitcher",
  states: {
    "A Deal at Proposal Sent": () => <Moving />,
    "A New Deal": () => <Start />,
    "Read Only": () => <StageSwitcher stages={STAGES} value="partnership_signed" onMove={() => undefined} readOnly />,
  },
} satisfies GalleryEntry;

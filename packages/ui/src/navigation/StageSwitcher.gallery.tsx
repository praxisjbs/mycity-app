import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { StageSwitcher } from "./StageSwitcher";

/** The seven steps a stage counts as, and MyCity's stages as its tracker lists them (docs/guides/partnerships.md §6.3). */
const STEPS = [
  { code: "prospect", label: "Prospect" },
  { code: "contacted", label: "Contacted" },
  { code: "meeting", label: "Meeting" },
  { code: "proposal", label: "Proposal" },
  { code: "negotiation", label: "Negotiation" },
  { code: "signed", label: "Signed" },
  { code: "active", label: "Active" },
];

const STAGES = [
  {
    code: "prospect_identified",
    label: "Prospect Identified",
    step: "prospect",
  },
  { code: "initial_contact", label: "Initial Contact", step: "contacted" },
  { code: "intro_meeting_held", label: "Meeting Held", step: "meeting" },
  { code: "proposal_sent", label: "Proposal Sent", step: "proposal" },
  { code: "negotiation", label: "Negotiation", step: "negotiation" },
  { code: "contract_review", label: "Contract Review", step: "negotiation" },
  { code: "partnership_signed", label: "Partnership Signed", step: "signed" },
  { code: "active_partnership", label: "Active Partnership", step: "active" },
  { code: "closed_lost", label: "Closed Lost", step: null },
  { code: "on_hold", label: "On Hold", step: null },
];

const OPEN = STAGES.filter((s) => s.step);
const after = (code: string) => {
  const i = OPEN.findIndex((s) => s.code === code);
  return OPEN[i + 1]?.code ?? null;
};

function Moving({ from }: { from: string }) {
  const [stage, setStage] = useState(from);
  return <StageSwitcher steps={STEPS} stages={STAGES} value={stage} next={after(stage)} onMove={(code) => new Promise<void>((resolve) => setTimeout(() => (setStage(code), resolve()), 600))} />;
}

export default {
  component: "StageSwitcher",
  states: {
    "At Contract Review": () => <Moving from="contract_review" />,
    "A New Deal": () => <Moving from="prospect_identified" />,
    "On Hold": () => <Moving from="on_hold" />,
    "Read Only": () => <StageSwitcher steps={STEPS} stages={STAGES} value="partnership_signed" onMove={() => undefined} readOnly />,
  },
} satisfies GalleryEntry;

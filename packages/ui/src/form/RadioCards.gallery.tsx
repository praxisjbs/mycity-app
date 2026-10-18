import { useState } from "react";
import { cn } from "../lib/cn";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { RadioCards, type RadioCardOption } from "./RadioCards";

type Level = "none" | "view" | "add" | "edit" | "full";

/** A level as a few short bars filled up to its rank, drawn here from plain spans. */
function Bars({ rank }: { rank: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4].map((step) => (
        <span key={step} className={cn("block h-3.5 w-1 rounded-sm", step <= rank ? "bg-current" : "bg-border")} />
      ))}
    </span>
  );
}

const LEVELS: ReadonlyArray<RadioCardOption<Level>> = [
  { value: "none", label: "No Access", leading: <Bars rank={0} /> },
  { value: "view", label: "View", leading: <Bars rank={1} /> },
  { value: "add", label: "Add", leading: <Bars rank={2} /> },
  { value: "edit", label: "Edit", leading: <Bars rank={3} /> },
  { value: "full", label: "Full", leading: <Bars rank={4} /> },
];

function Levels({ module, initial, fullOff = false }: { module: string; initial: Level | null; fullOff?: boolean }) {
  const [level, setLevel] = useState<Level | null>(initial);
  const options = fullOff ? LEVELS.map((o) => (o.value === "full" ? { ...o, disabled: true } : o)) : LEVELS;
  return (
    <Field label={`${module} Access`}>
      <RadioCards value={level} onChange={setLevel} options={options} className="max-w-sm" />
    </Field>
  );
}

function Missing() {
  const [level, setLevel] = useState<Level | null>(null);
  return (
    <Field label="Performance Access" state={level ? undefined : "bad"} message="Choose a level">
      <RadioCards value={level} onChange={setLevel} options={LEVELS} className="max-w-sm" />
    </Field>
  );
}

function LeaveType() {
  const [type, setType] = useState<string | null>("annual");
  return (
    <RadioCards
      label="Leave Type"
      value={type}
      onChange={setType}
      options={[
        { value: "annual", label: "Annual Leave" },
        { value: "sick", label: "Sick Leave" },
        { value: "study", label: "Study Leave" },
      ]}
      className="max-w-sm"
    />
  );
}

export default {
  component: "RadioCards",
  states: {
    "Access Levels": () => <Levels module="Payroll" initial="edit" />,
    "Nothing Chosen": () => <Levels module="People" initial={null} />,
    "Full Disabled": () => <Levels module="Payroll" initial="view" fullOff />,
    "Field Error": () => <Missing />,
    "Without Glyphs": () => <LeaveType />,
  },
} satisfies GalleryEntry;

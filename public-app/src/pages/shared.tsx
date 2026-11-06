import type { PublicJob, PublicJobCard } from "@mycity/contract/contract.gen.ts";
import type { IconName } from "@mycity/ui";

/**
 * What the careers pages share (one file per screen, Decision 15): how a role's facts read, in the
 * words a stranger sees them. The values come from the API; only the labels live here.
 */

export const PATTERN: Record<NonNullable<PublicJobCard["work_pattern"]>, string> = { on_site: "On Site", hybrid: "Hybrid", remote: "Remote" };

export const EMPLOYMENT: Record<NonNullable<PublicJob["employment_type"]>, string> = {
  full_time: "Full Time",
  part_time: "Part Time",
  contract: "Contract",
  internship: "Internship",
};

/** The steps of How We Hire, in the order a candidate meets them. */
export const HIRING_STEP: Record<PublicJob["how_we_hire"][number], string> = {
  apply: "Apply",
  screening: "Screening",
  assessment: "Assessment",
  interview: "Interview",
};

/** How it is worked, with its note when it has one: "Hybrid, 2 days in office". */
export const patternOf = (r: Pick<PublicJob, "work_pattern"> & Partial<Pick<PublicJob, "work_pattern_note">>) =>
  r.work_pattern ? `${PATTERN[r.work_pattern]}${r.work_pattern_note ? `, ${r.work_pattern_note}` : ""}` : null;

/** A role's facts as glyph and words, for a card's line or the hero's chips. Missing facts are left out. */
export function factsOf(r: PublicJobCard & Partial<Pick<PublicJob, "work_pattern_note" | "employment_type">>): Array<{ icon: IconName; text: string }> {
  const out: Array<{ icon: IconName; text: string } | null> = [
    r.location ? { icon: "pin", text: r.location } : null,
    patternOf(r) ? { icon: "building", text: patternOf(r)! } : null,
    r.employment_type ? { icon: "brief", text: EMPLOYMENT[r.employment_type] } : null,
  ];
  return out.filter((x): x is { icon: IconName; text: string } => x !== null);
}

/** "1 person has applied", "23 people have applied". */
export const applicantsLine = (n: number) => (n === 1 ? "1 person has applied" : `${n} people have applied`);

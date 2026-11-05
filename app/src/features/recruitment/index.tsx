/**
 * Recruitment (docs/guides/recruitment.md §2, §10): one file per tab, and the sheets and forms
 * the tabs open. Vacancies, Candidates, Assessments, Interviews and Talent Pool are M4's; Offers
 * and Onboarding are M5's (owner AJ), INTERIM until M5 puts them on the contract.
 */
import type { ModuleScreenProps } from "@/shell/screens";
import { Assessments } from "./Assessments";
import { Candidates } from "./Candidates";
import { Interviews } from "./Interviews";
import { Offers } from "./Offers";
import { Onboarding } from "./Onboarding";
import { TalentPool } from "./TalentPool";
import { Vacancies } from "./Vacancies";

export default function Recruitment({ tab }: ModuleScreenProps) {
  if (tab === "candidates") return <Candidates />;
  if (tab === "assessments") return <Assessments />;
  if (tab === "interviews") return <Interviews />;
  if (tab === "offers") return <Offers />;
  if (tab === "onboarding") return <Onboarding />;
  if (tab === "talent-pool") return <TalentPool />;
  return <Vacancies />;
}

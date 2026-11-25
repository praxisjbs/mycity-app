import type { ReactNode } from "react";
import type { HomeKpiCard } from "@mycity/contract/contract.gen.ts";
import { EmptyValue, formatCount, KpiCard, KpiGrid, Money, plural } from "@mycity/ui";

/**
 * A KPI card's figure as people read it, formatted here from the wire (FRONTEND_GUIDE §6):
 * a count, Naira in the short form KPI tiles use, a percentage, a part of a whole ("22 of
 * 25") or days. A ratio with nothing to measure (a denominator of 0) shows no figure rather
 * than a zero, so "0 of 30" and "0 of nothing" stay different (docs/guides/home.md §6).
 */
export function figureOf(card: HomeKpiCard): ReactNode {
  if (!card.measurable) return <EmptyValue />;
  if (card.unit === "money") return <Money value={card.amount} short />;
  if (card.value === null) return <EmptyValue />;
  switch (card.unit) {
    case "pct":
      return `${formatCount(card.value)}%`;
    case "pair":
      return card.denominator === null ? formatCount(card.value) : `${formatCount(card.value)} of ${formatCount(card.denominator)}`;
    case "days":
      return plural(card.value, "day");
    default:
      return formatCount(card.value);
  }
}

/** Expected in today, as the attendance register counts it: the same words on every attendance card. */
const EXPECTED = "Expected means an active login, a working day of their schedule and not on leave.";

/**
 * Help on a card whose figure could be read as another screen's count (docs/guides/home.md §10.1):
 * who it counts, and for a part of a whole what the whole is. Headcount, Clocked In Today, Team
 * and Attendance This Month each count a different set of people, so each says which.
 */
export const CARD_HELP: Readonly<Record<string, string>> = {
  headcount: "Active staff on the register you can see, with or without a login.",
  attendance_today: `People you can see clocked in today, of those expected in. ${EXPECTED}`,
  my_attendance_30d: "Your days on time in the last 30 days, of the working days you were expected in.",
  team_present: `People on this roster in today, of those expected in. ${EXPECTED}`,
  team_on_site: "People on this roster in on time at their office today.",
  team_remote: "People on this roster in on time and working remotely today.",
  team_flags: "People on this roster late today or with no clock-out on their last working day, each counted once.",
  tasks_overdue: "Overdue tasks of everyone you can see.",
  my_tasks_overdue: "Your own overdue tasks.",
  goals_on_track: "Key results you can see on track or done this quarter, of all of them.",
  my_targets_on_track: "Your scored lines at Meets or above, of all your scored lines.",
};

export interface CardRowProps {
  /** The cards, in the order the server sent them. */
  cards: HomeKpiCard[];
  /** Opens the records behind a card. */
  onOpen: (card: HomeKpiCard) => void;
}

/** A row of KPI cards, on Overview and on Team: four across on desktop, two to a row on a phone (KpiGrid). */
export function CardRow({ cards, onOpen }: CardRowProps) {
  return (
    <KpiGrid>
      {cards.map((card) => (
        <KpiCard
          key={card.key}
          title={card.title}
          value={figureOf(card)}
          caption={card.caption ?? undefined}
          tone={card.tone ?? undefined}
          trend={card.trend ?? undefined}
          help={CARD_HELP[card.key]}
          onOpen={card.opens ? () => onOpen(card) : undefined}
        />
      ))}
    </KpiGrid>
  );
}

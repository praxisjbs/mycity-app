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
          onOpen={card.opens ? () => onOpen(card) : undefined}
        />
      ))}
    </KpiGrid>
  );
}

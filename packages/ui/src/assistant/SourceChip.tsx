/**
 * @component SourceChip
 * @group Assistant
 * @summary A kind of record an answer was read from, with how many ("partnership ×4"), or the one record it rests on; pressed, it opens the pane on them.
 * @use Under an answer's words, after From (docs/guides/praxis-ai.md decision 9): one chip per kind of record, or one for the single record.
 * @avoid A chip for every record (From names kinds); a filter chip (use Chips); a status (use Pill).
 * @phone A 44 px target; the row of chips wraps.
 * @a11y An ItemChip: a button named by the kind and its count ("partnership, 4 records") when it opens something, a plain label otherwise.
 * @status beta
 * @example <SourceChip label="partnership" count={4} onSelect={showTable} />
 * @example <SourceChip kind="record" label="Ayo Bello" onSelect={showRecord} />
 */
import { ItemChip } from "../display/ItemChip";

export interface SourceChipProps {
  /** The kind of record in words ("partnership"), or the one record's name. */
  label: string;
  /** `type` (the default): a kind of record with a count. `record`: the one record the answer rests on. */
  kind?: "type" | "record";
  /** How many of the kind were read; shown as ×N from 2. */
  count?: number;
  /** Opens the pane on them (the Table for a kind, the Record for one). Without it the chip is a label. */
  onSelect?: () => void;
  /** The chip whose records the pane shows now. */
  selected?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function SourceChip({ label, kind = "type", count = 1, onSelect, selected, className }: SourceChipProps) {
  const many = kind === "type" && count > 1;
  const name = kind === "record" ? label : `${label}, ${count} ${count === 1 ? "record" : "records"}`;
  return (
    <ItemChip onSelect={onSelect} selected={selected} label={onSelect ? name : undefined} className={className}>
      {many ? `${label} ×${count}` : label}
    </ItemChip>
  );
}

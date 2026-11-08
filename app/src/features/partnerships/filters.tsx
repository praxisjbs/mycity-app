import { useApi } from "@/api/hooks";
import { DesktopOnly, FilterSelect, Grid } from "@mycity/ui";
import { SCOPES, useCategoryOptions, useOwnerOptions, useStages } from "./lib";

/**
 * The filters Pipeline, Partners and Leads share on desktop (docs/guides/partnerships.md §2, §10.1):
 * Stage, Category, Region, Owner and Health, and on the Partners and Leads lists each filterable
 * custom field that is a pick or a yes or no (§6.3). A phone keeps its chips (§10.2). Each value is
 * sent to the server as a filter; nothing is narrowed on the client.
 */

export interface RecordFilterValue {
  stage: string;
  partner_category_id: string;
  region_scope: string;
  owner_id: string;
  health: string;
  /** A filterable custom field's key and the value picked ("" for any). */
  custom: Record<string, string>;
}

export const NO_FILTERS: RecordFilterValue = { stage: "", partner_category_id: "", region_scope: "", owner_id: "", health: "", custom: {} };

type Health = "on_track" | "follow_up_required" | "stalled";
type Scope = "cities" | "national" | "africa" | "worldwide";

/**
 * The filters as a list's query carries them: empty ones left out; the custom fields as one JSON value
 * (`{"ticket_model":"Free Entry"}`), a yes or no as a boolean.
 */
export function filterQuery(v: RecordFilterValue, withCustom = true) {
  const custom: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(v.custom)) if (value) custom[key] = value === "yes" ? true : value === "no" ? false : value;
  return {
    ...(v.stage && { stage: v.stage }),
    ...(v.partner_category_id && { partner_category_id: v.partner_category_id }),
    ...(v.region_scope && { region_scope: v.region_scope as Scope }),
    ...(v.owner_id && { owner_id: v.owner_id }),
    ...(v.health && { health: v.health as Health }),
    ...(withCustom && Object.keys(custom).length > 0 && { custom: JSON.stringify(custom) }),
  };
}

/** The filter row, desktop only. `kind` names whose filterable custom fields join it; Pipeline passes none. */
export function RecordFilters({ value, onChange, kind }: { value: RecordFilterValue; onChange: (v: RecordFilterValue) => void; kind?: "lead" | "partner" }) {
  const { stages } = useStages();
  const categories = useCategoryOptions();
  const owners = useOwnerOptions();
  const defs = useApi("GET /api/v1/partnerships/fields", { query: { applies_to: kind ?? "lead", active: "true" }, enabled: Boolean(kind) });
  const filterable = kind ? (defs.data?.data ?? []).filter((d) => d.filterable && ["pick", "multi_pick", "yes_no"].includes(d.field_type)) : [];
  const set = (k: Exclude<keyof RecordFilterValue, "custom">) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <DesktopOnly>
      <Grid cols={4} className="mb-3">
        <FilterSelect label="Stage" value={value.stage} onChange={set("stage")} options={[["", "Every Stage"], ...stages.map((s) => [s.code, s.label] as [string, string])]} />
        <FilterSelect label="Category" value={value.partner_category_id} onChange={set("partner_category_id")} options={[["", "Every Category"], ...categories.options]} more={categories.more} onMore={categories.onMore} />
        <FilterSelect label="Region" value={value.region_scope} onChange={set("region_scope")} options={[["", "Every Region"], ...SCOPES]} />
        <FilterSelect label="Owner" value={value.owner_id} onChange={set("owner_id")} options={[["", "Every Owner"], ...owners.options]} more={owners.more} onMore={owners.onMore} />
        <FilterSelect
          label="Health"
          value={value.health}
          onChange={set("health")}
          options={[
            ["", "Any Health"],
            ["on_track", "On Track"],
            ["follow_up_required", "Follow-Up Required"],
            ["stalled", "Stalled"],
          ]}
        />
        {filterable.map((d) => (
          <FilterSelect
            key={d.key}
            label={d.label}
            value={value.custom[d.key] ?? ""}
            onChange={(v) => onChange({ ...value, custom: { ...value.custom, [d.key]: v } })}
            options={[["", "Any"], ...(d.field_type === "yes_no" ? ([["yes", "Yes"], ["no", "No"]] as Array<[string, string]>) : ((d.options as string[] | null) ?? []).map((o) => [o, o] as [string, string]))]}
          />
        ))}
      </Grid>
    </DesktopOnly>
  );
}

import type { ListValue } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { Button, Card, CardHeader, EmptyState, HelpTerm, IconButton, Menu, Pill, Skeleton, toast, useIsPhone, useModal } from "@mycity/ui";
import { ListValueForm } from "./forms/ListValueForm";
import { MEANING_LABEL, refusal, useConfigure } from "./lib";

/** The four lists MyCity edits here: each one's name on screen, the noun its buttons use and whether its values count as something. */
const LISTS = [
  { list: "partnership_stage", title: "Stages", noun: "Stage", counts: true },
  { list: "partnership_impact", title: "Potential Impact", noun: "Impact", counts: false },
  { list: "lead_source", title: "Lead Sources", noun: "Source", counts: false },
  { list: "partner_document_kind", title: "Document Kinds", noun: "Kind", counts: false },
] as const;

/**
 * Partnerships · Categories · Pipeline Settings (docs/guides/partnerships.md §6.3, §10.1): MyCity's own lists,
 * entered here and nowhere in code (A26). Stages come in the order a deal travels, each with what it counts as;
 * the impacts, lead sources and document kinds are plain lists. Holders of `partnerships.configure` add,
 * rename, move, retire and restore; everyone who may open Partnerships reads.
 */
export function PipelineSettings() {
  return (
    <div className="grid gap-4 desk:grid-cols-2">
      {LISTS.map((l) => (
        <ListCard key={l.list} {...l} />
      ))}
    </div>
  );
}

function ListCard({ list, title, noun, counts }: { list: string; title: string; noun: string; counts: boolean }) {
  const configure = useConfigure();
  const phone = useIsPhone();
  const modal = useModal();
  const read = useApi("GET /api/v1/partnerships/lists/:list", { params: { list } as never });
  const change = useMutation("PATCH /api/v1/partnerships/lists/:list/:code");
  const values = read.data?.values ?? [];
  const live = values.filter((v) => v.active);

  const open = (value?: ListValue) =>
    modal.open({ title: value ? `Edit ${noun}` : `Add ${noun}`, body: (close) => <ListValueForm list={list} noun={noun} value={value} close={close} /> });
  const patch = async (code: string, body: { active?: boolean; position?: number }, done?: string) => {
    try {
      await change.run({ params: { list, code } as never, body });
      invalidate(`/api/v1/partnerships/lists/${list}`);
      if (done) toast(done);
    } catch (e) {
      toast(refusal(e, "Not saved. Try again."));
    }
  };
  /** Move a value one place: it takes the position of its neighbour, which the server orders by. */
  const move = async (v: ListValue, by: -1 | 1) => {
    const next = live[live.findIndex((x) => x.code === v.code) + by];
    if (next) await patch(v.code, { position: next.position + by });
  };

  return (
    <Card>
      <CardHeader
        title={title}
        actions={configure ? <Button size="sm" icon="plus" onClick={() => open()}>{`Add ${noun}`}</Button> : undefined}
      />
      {read.loading && !read.data ? (
        <Skeleton shape="block" className="h-24" />
      ) : values.length === 0 ? (
        <EmptyState bare title={`No ${title} Yet`} text={configure ? `Add the ${noun.toLowerCase()} MyCity uses.` : undefined} />
      ) : (
        <ul className="divide-y divide-border">
          {values.map((v) => {
            return (
              <li key={v.code} className="flex min-h-row items-center gap-2 py-1.5 phone:min-h-tap">
                <span className={v.active ? "min-w-0 flex-1 truncate text-sm" : "min-w-0 flex-1 truncate text-sm text-subtle-foreground"} data-copy="content">
                  {v.label}
                </span>
                {counts && v.meaning && (
                  <span className="shrink-0 text-xs text-subtle-foreground">
                    <HelpTerm help="What this stage counts as in totals and reports.">{MEANING_LABEL[v.meaning]}</HelpTerm>
                  </span>
                )}
                {!v.active && <Pill>Retired</Pill>}
                {configure && v.active && !phone && (
                  <>
                    <IconButton icon="up" label={`Move ${v.label} Up`} size="sm" onClick={() => move(v, -1)} />
                    <IconButton icon="down" label={`Move ${v.label} Down`} size="sm" onClick={() => move(v, 1)} />
                  </>
                )}
                {configure && (
                  <Menu
                    label={`${v.label} actions`}
                    trigger={(p) => <IconButton {...p} icon="dots" label={`More for ${v.label}`} size="sm" />}
                    items={[
                      { label: "Edit", icon: "edit", onSelect: () => open(v) },
                      ...(phone && v.active
                        ? ([{ label: "Move Up", icon: "up", onSelect: () => move(v, -1) }, { label: "Move Down", icon: "down", onSelect: () => move(v, 1) }] as const)
                        : []),
                      v.active
                        ? { label: "Retire", icon: "x", danger: true, onSelect: () => patch(v.code, { active: false }, `${noun} retired`) }
                        : { label: "Restore", icon: "refresh", onSelect: () => patch(v.code, { active: true }, `${noun} restored`) },
                    ]}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

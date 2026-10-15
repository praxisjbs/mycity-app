import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import type { OrgNode } from "@/api/types/organisation";
import { LoadingRows } from "@/components/ui/Table";
import { hrefFor, useRouter } from "@/lib/router";
import { Button, Icon, Card, PageHeader, ErrorState, toast, cn, initials, SearchInput } from "@mycity/ui";

/**
 * The live reporting tree (docs/guides/organogram.md). One render, two modes:
 *   builder  People · Organogram: HR-rich cards, drag a card onto a new manager
 *   viewer   ESS · Org Chart: read only, the standard card, for every employee
 * Salary, bank details and phone numbers are never on a card.
 */
export function OrgTree({ mode }: { mode: "builder" | "viewer" }) {
  const builder = mode === "builder";
  const { data, error, reload } = useApi("GET /api/v1/org-chart", { query: { view: mode } });
  const { navigate } = useRouter();
  const move = useMutation("PATCH /api/v1/employees/:id/line-manager");
  const [q, setQ] = useState("");
  const [dragging, setDragging] = useState<OrgNode | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null);

  const children = useMemo(() => {
    const m = new Map<string | null, OrgNode[]>();
    for (const n of data?.nodes ?? []) m.set(n.manager_seat_id, [...(m.get(n.manager_seat_id) ?? []), n]);
    return m;
  }, [data]);
  const roots = useMemo(() => children.get(null) ?? [], [children]);
  const scroller = useRef<HTMLDivElement>(null);
  /* A wide tree opens centred on its top. */
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [data]);
  /* Start with the top three levels open; deeper branches open on a tap. */
  const folded = useMemo(() => {
    if (collapsed) return collapsed;
    const out = new Set<string>();
    const walk = (n: OrgNode, depth: number) => {
      const kids = children.get(n.seat_id) ?? [];
      if (depth >= 2 && kids.length) out.add(n.seat_id);
      kids.forEach((k) => walk(k, depth + 1));
    };
    roots.forEach((r) => walk(r, 0));
    return out;
  }, [collapsed, children, roots]);
  const hit = (n: OrgNode) => !!q.trim() && `${n.display_name} ${n.job_title} ${n.department}`.toLowerCase().includes(q.trim().toLowerCase());

  const drop = async (target: OrgNode, e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const node = dragging;
    setDragging(null);
    if (!node?.employee_id || !target.employee_id || node.seat_id === target.seat_id) return;
    try {
      await move.run({ params: { id: node.employee_id }, body: { line_manager_id: target.employee_id, reason: "Moved on the organogram" } });
      invalidate("/api/v1/org-chart", "/api/v1/employees");
      toast(`${node.display_name} now reports to ${target.display_name}.`);
    } catch {
      toast(move.error?.fields.line_manager_id?.[0] ? `Not moved: ${move.error.fields.line_manager_id[0]}` : "Not moved");
    }
  };

  const card = (n: OrgNode) => {
    if (n.vacant)
      return (
        <div className="og-card relative w-[178px] rounded-[13px] border border-dashed border-input bg-transparent px-3 py-[11px] text-center">
          <span className="mx-auto mb-2 flex size-[42px] items-center justify-center rounded-full border border-dashed border-input bg-muted text-subtle-foreground">
            <Icon name="plus" />
          </span>
          <b className="block text-[13px] leading-tight font-[650]">{n.display_name}</b>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">Vacant · {n.department}</span>
          {builder ? (
            <button type="button" onClick={() => navigate(hrefFor("recruitment", "vacancies", { new: "1", title: n.display_name }))} className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-[3px] text-[10.5px] font-[650] text-primary-foreground">
              <Icon name="plus" className="size-3" />
              Create Vacancy
            </button>
          ) : (
            <span className="mt-2 inline-block rounded-full border border-dashed border-input px-[9px] py-0.5 text-[10px] font-[650] text-subtle-foreground">Open role</span>
          )}
        </div>
      );
    return (
      <div
        tabIndex={0}
        draggable={builder && !n.is_ceo}
        onDragStart={() => setDragging(n)}
        onDragEnd={() => (setDragging(null), setOver(null))}
        onClick={() => n.employee_id && navigate(builder ? hrefFor("people", "employees", { id: n.employee_id }) : hrefFor("ess", "org-chart", { id: n.employee_id }))}
        className={cn(
          "og-card relative w-[178px] cursor-pointer rounded-[13px] border bg-card px-3 py-[11px] text-center shadow-1 transition-[box-shadow,border-color] hover:border-input hover:shadow-2",
          n.is_ceo ? "border-primary shadow-[0_0_0_2px_var(--primary-tint),var(--shadow-1)]" : "border-border",
          hit(n) && "border-ring shadow-[0_0_0_3px_var(--accent)]",
          dragging?.seat_id === n.seat_id && "opacity-50",
        )}
      >
        <span className={cn("mx-auto mb-2 flex size-[42px] items-center justify-center rounded-full text-[13.5px] font-bold", n.is_ceo ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
          {initials(n.display_name)}
        </span>
        <b className="block text-[13px] leading-tight font-[650]">{n.display_name}</b>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{n.job_title}</span>
        <span className="mt-2 inline-block rounded-full border border-border bg-muted px-[9px] py-0.5 text-[10px] font-[650] text-subtle-foreground">{n.department}</span>
        {n.meta && <span className="mt-1.5 block text-[10px] text-subtle-foreground">{n.meta}</span>}
        {n.dotted_line_to && <span className="mt-[7px] inline-block rounded-full border border-dashed border-input px-2 py-px text-[9.5px] text-subtle-foreground">Dotted line · {n.dotted_line_to}</span>}
        {(children.get(n.seat_id)?.length ?? 0) > 0 && (
          <button
            type="button"
            aria-label={folded.has(n.seat_id) ? "Expand" : "Collapse"}
            onClick={(e) => (e.stopPropagation(), setCollapsed(() => { const x = new Set(folded); if (x.has(n.seat_id)) x.delete(n.seat_id); else x.add(n.seat_id); return x; }))}
            className="absolute -bottom-[11px] left-1/2 z-[1] flex h-[22px] min-w-[22px] -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card px-1.5 text-[10px] font-bold text-muted-foreground"
          >
            {folded.has(n.seat_id) ? `+${children.get(n.seat_id)!.length}` : "−"}
          </button>
        )}
      </div>
    );
  };

  const node = (n: OrgNode) => {
    const kids = folded.has(n.seat_id) ? [] : (children.get(n.seat_id) ?? []);
    return (
      <li
        key={n.seat_id}
        className={cn(over === n.seat_id && "drop-target")}
        onDragOver={builder && n.employee_id ? (e) => (e.preventDefault(), setOver(n.seat_id)) : undefined}
        onDragLeave={builder ? () => setOver((o) => (o === n.seat_id ? null : o)) : undefined}
        onDrop={builder ? (e) => drop(n, e) : undefined}
      >
        {card(n)}
        {kids.length > 0 && <ul>{kids.map(node)}</ul>}
      </li>
    );
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader
        title={builder ? "Organogram" : "Org Chart"}
        sub={data ? (builder ? `Reporting lines · ${data.seats} seats · ${data.filled} filled · ${data.seats - data.filled} open` : `Reporting lines · ${data.seats} seats · ${data.filled} filled`) : " "}
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Search the chart" className="w-[200px]" />
            {builder && <Button onClick={() => setCollapsed(new Set())}>Expand All</Button>}
            <Button icon="doc" onClick={() => toast("PDF queued. It arrives in your Mailbox.")}>Download PDF</Button>
          </>
        }
      />
      <div className="mt-0.5 mb-1 flex flex-wrap gap-4 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-[7px]"><i className="inline-block w-[22px] border-t-2 border-input" />Reporting line</span>
        <span className="inline-flex items-center gap-[7px]"><i className="inline-block w-[22px] border-t-2 border-dashed border-input" />Dotted line (matrix)</span>
        <span className="inline-flex items-center gap-[7px]"><i className="inline-block size-[13px] rounded bg-primary" />CEO</span>
        <span className="inline-flex items-center gap-[7px]"><i className="inline-block size-[13px] rounded border border-dashed border-input" />Vacant seat</span>
      </div>
      <Card className="p-1.5">
        {!data ? <LoadingRows count={5} /> : <div ref={scroller} className="ogt" data-copy="content"><ul>{roots.map(node)}</ul></div>}
      </Card>
    </>
  );
}

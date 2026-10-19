import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { api } from "@/api/client";
import { usePhoto, usePhotos } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { ManagerRef, OrgNode } from "@/api/types/organisation";
import type { PersonRef } from "@/api/types/common";
import { EmployeePicker } from "@/features/shared/pickers";
import { ReportingForm, type ReportingSubject } from "@/features/shared/ReportingForm";
import { useMe } from "@/auth/AuthProvider";
import { hrefFor, useRouter } from "@/lib/router";
import { visibleTabs } from "@/shell/access";
import { moduleByKey } from "@/shell/catalogue";
import { useScreenAction } from "@/shell/screen-action";
import {
  Avatar,
  Banner,
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  ExportButton,
  Field,
  FormFooter,
  HelpTerm,
  Icon,
  KeyValue,
  LoadingRows,
  ModalFooter,
  PageHeader,
  Pill,
  SearchInput,
  SegmentedControl,
  SelectField,
  TextField,
  toast,
  useIsPhone,
  useModal,
  Who,
} from "@mycity/ui";

/**
 * The live reporting tree (docs/guides/organogram.md). One read, two modes:
 *   builder  People · Organogram: HR-rich cards, drag a card onto a new manager
 *   viewer   ESS · Org Chart: read only, the standard card, for every employee
 *
 * A node is a person or a vacant seat, and the solid line above it is
 * `manager_node_id`; the dotted line is drawn beside it and changes nothing about who
 * approves what (§6). Salary, bank details and phone numbers are never on a card.
 *
 * A person's card opens their sheet on both shells: what the chart holds about them, with
 * Send Message, and Open Record and Change Manager for whoever may (§8).
 *
 * On a phone it is not the tree shrunk (§10.2) but two views of it. Everyone is the whole
 * company as one indented list that folds; Focus is one card and what is around it: the
 * path from the top, the manager, the reports, the dotted-line reports and the colleagues.
 */
const DOTTED_HELP = "A second manager for matrix work. It does not change who approves leave, expenses or tasks.";

/** Everyone's indent per level, held at the fifth so a deep branch never runs off a phone. */
const INDENT = ["pl-0", "pl-4", "pl-8", "pl-12", "pl-16"];

/** The line from the top down to a card, the card last. */
function pathTo(n: OrgNode, byId: Map<string, OrgNode>): OrgNode[] {
  const out = [n];
  const seen = new Set([n.node_id]);
  for (let up = n.manager_node_id ? byId.get(n.manager_node_id) : undefined; up && !seen.has(up.node_id); up = up.manager_node_id ? byId.get(up.manager_node_id) : undefined) {
    seen.add(up.node_id);
    out.unshift(up);
  }
  return out;
}

/**
 * `openId`: a node to open on (a search result for an open seat, `?id=` in the address):
 * the phone focuses it, the desktop tree marks it as the search box marks a match.
 */
export function OrgTree({ mode, openId = null }: { mode: "builder" | "viewer"; openId?: string | null }) {
  const builder = mode === "builder";
  const phone = useIsPhone();
  const me = useMe();
  const modal = useModal();
  const { data, error, reload } = useApi("GET /api/v1/org-chart", { query: { view: mode } });
  /* The desktop chart shows every face at once; a phone's tiles each ask for their own (NodeTile). */
  const photo = usePhotos(phone ? [] : (data?.nodes ?? []).map((n) => n.photo_url));
  const { navigate } = useRouter();
  const move = useMutation("PATCH /api/v1/employees/:id/line-manager");
  const [q, setQ] = useState("");
  const [dragging, setDragging] = useState<OrgNode | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null);
  const [expandedAll, setExpandedAll] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  /* People opens on the whole company, Org Chart on the person looking (§10.2). */
  const [view, setView] = useState<"focus" | "everyone">(builder ? "everyone" : "focus");
  const addRole = () => modal.open({ title: "Add Open Role", body: (close) => <SeatForm close={close} onSaved={reload} /> });
  const editRole = (n: OrgNode) =>
    modal.open({
      title: "Edit Open Role",
      body: (close) => <SeatForm close={close} onSaved={reload} seat={n} manager={n.manager_node_id ? byId.get(n.manager_node_id) : undefined} />,
    });
  useScreenAction(builder ? { label: "Add Role", onSelect: addRole } : null);

  const nodes = useMemo(() => data?.nodes ?? [], [data]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.node_id, n])), [nodes]);
  const opened = openId ? byId.get(openId) : undefined;
  useEffect(() => {
    if (!opened) return;
    setFocus(opened.node_id);
    setView("focus");
    /* The desktop tree marks it as a search would; a phone opens straight on it. */
    if (!phone) setQ(opened.display_name);
  }, [opened, phone]);
  const children = useMemo(() => {
    const m = new Map<string | null, OrgNode[]>();
    for (const n of nodes) m.set(n.manager_node_id, [...(m.get(n.manager_node_id) ?? []), n]);
    return m;
  }, [nodes]);
  const dottedReports = useMemo(() => {
    const m = new Map<string, OrgNode[]>();
    for (const n of nodes) if (n.dotted_manager_node_id) m.set(n.dotted_manager_node_id, [...(m.get(n.dotted_manager_node_id) ?? []), n]);
    return m;
  }, [nodes]);
  /* The CEO is the top whatever else sits there; the rest keep the server's order. */
  const roots = useMemo(
    () => [...(children.get(null) ?? [])].sort((a, b) => Number(b.is_ceo) - Number(a.is_ceo)),
    [children],
  );
  const top = roots[0]?.node_id ?? null;
  /* Every place below each card, people and open roles alike, as the tree draws them (§6). */
  const below = useMemo(() => {
    const out = new Map<string, number>();
    const count = (n: OrgNode): number => {
      const total = (children.get(n.node_id) ?? []).reduce((s, k) => s + 1 + count(k), 0);
      out.set(n.node_id, total);
      return total;
    };
    roots.forEach(count);
    return out;
  }, [children, roots]);
  const teamOf = (n: OrgNode) => {
    const direct = children.get(n.node_id)?.length ?? 0;
    const all = below.get(n.node_id) ?? direct;
    if (!direct) return null;
    return all > direct ? `${direct} direct · ${all} in all` : `${direct} direct`;
  };
  /* The person looking, on Org Chart: where its phone starts, and the branch it opens. */
  const mine = !builder && me.employee_id && byId.has(me.employee_id) ? me.employee_id : null;
  const scroller = useRef<HTMLDivElement>(null);

  /*
   * A wide tree opens centred on its top, the CEO's card, wherever the other roots fall,
   * and comes back to it after Expand All, which widens every branch at once.
   */
  useEffect(() => {
    const el = scroller.current;
    const card = el?.querySelector<HTMLElement>("[data-top]");
    if (!el || !card) return;
    const box = el.getBoundingClientRect();
    const at = card.getBoundingClientRect();
    el.scrollLeft += at.left + at.width / 2 - (box.left + box.width / 2);
  }, [data, expandedAll]);

  /* Start with the top three levels open, and on Org Chart the way down to the person looking. */
  const folded = useMemo(() => {
    if (collapsed) return collapsed;
    const out = new Set<string>();
    const walk = (n: OrgNode, depth: number) => {
      const kids = children.get(n.node_id) ?? [];
      if (depth >= 2 && kids.length) out.add(n.node_id);
      kids.forEach((k) => walk(k, depth + 1));
    };
    roots.forEach((r) => walk(r, 0));
    const self = mine ? byId.get(mine) : undefined;
    if (self) for (const up of pathTo(self, byId)) out.delete(up.node_id);
    return out;
  }, [collapsed, children, roots, mine, byId]);
  const fold = (id: string) =>
    setCollapsed(() => {
      const x = new Set(folded);
      if (x.has(id)) x.delete(id);
      else x.add(id);
      return x;
    });

  const term = q.trim().toLowerCase();
  const hit = (n: OrgNode) => !!term && `${n.display_name} ${n.job_title} ${n.department}`.toLowerCase().includes(term);

  const drop = async (target: OrgNode, e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const node = dragging;
    setDragging(null);
    if (!node?.employee_id || node.node_id === target.node_id) return;
    const body = target.employee_id
      ? { line_manager_id: target.employee_id, reason: "Moved on the organogram" }
      : { line_manager_seat_id: target.node_id, reason: "Moved on the organogram" };
    try {
      await move.run({ params: { id: node.employee_id }, body });
      invalidate("/api/v1/org-chart", "/api/v1/employees");
      reload();
      toast(`${node.display_name} now reports to ${target.display_name}`);
    } catch {
      toast(move.error?.message ?? "Not moved");
    }
  };

  /* What a person's sheet offers follows the grants, never a role's name (§8). */
  const people = moduleByKey("people");
  const canOpenRecords = Boolean(people && me.grants.people?.includes("view") && visibleTabs(me, people).some((t) => t.slug === "employees"));
  const canMove = Boolean(me.grants.people?.includes("edit"));
  const ref = (m: OrgNode | undefined): ManagerRef | null =>
    m ? { employee_id: m.employee_id, org_seat_id: m.org_seat_id, display_name: m.display_name, job_title: m.job_title, vacant: m.vacant } : null;

  const openPerson = (n: OrgNode) => {
    const employeeId = n.employee_id;
    if (!employeeId) return;
    const manager = n.manager_node_id ? byId.get(n.manager_node_id) : undefined;
    const subject: ReportingSubject = {
      employee_id: employeeId,
      display_name: n.display_name,
      line_manager: ref(manager),
      dotted_manager: ref(n.dotted_manager_node_id ? byId.get(n.dotted_manager_node_id) : undefined),
    };
    const go = (close: () => void, href: string) => (close(), navigate(href));
    modal.open({
      title: "Profile",
      body: (close) => (
        <PersonSheet
          n={n}
          manager={manager}
          team={teamOf(n)}
          self={employeeId === me.employee_id}
          canOpenRecord={canOpenRecords}
          canChangeManager={canMove && !n.is_ceo}
          onMessage={() => go(close, hrefFor("community", "direct-messages", { to: employeeId }))}
          onOpenRecord={() => go(close, hrefFor("people", "employees", { id: employeeId }))}
          onMyProfile={() => go(close, hrefFor("ess", "my-profile"))}
          onChangeManager={() =>
            modal.open({ title: "Change Reporting Line", body: (done) => <ReportingForm employee={subject} close={done} onSaved={reload} /> })
          }
        />
      ),
    });
  };

  /* A card with reports, a person's or an open seat's, folds and unfolds its branch. */
  const toggle = (n: OrgNode) =>
    (children.get(n.node_id)?.length ?? 0) > 0 && (
      <button
        type="button"
        aria-label={folded.has(n.node_id) ? "Expand" : "Collapse"}
        onClick={(e) => (e.stopPropagation(), fold(n.node_id))}
        className="absolute -bottom-2.5 left-1/2 z-1 flex h-5.5 min-w-5.5 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card px-1.5 text-2xs font-bold text-muted-foreground"
      >
        {folded.has(n.node_id) ? `+${children.get(n.node_id)!.length}` : "−"}
      </button>
    );

  const card = (n: OrgNode) => {
    if (n.vacant)
      return (
        <div
          data-top={n.node_id === top ? "" : undefined}
          className={cn("og-card relative w-44 rounded-card border border-dashed border-input bg-transparent px-3 py-2.5 text-center", hit(n) && "border-ring ring-2 ring-accent")}
        >
          <span className="mx-auto mb-2 flex size-10.5 items-center justify-center rounded-full border border-dashed border-input bg-muted text-subtle-foreground">
            <Icon name="plus" />
          </span>
          <b className="block text-sm leading-tight font-strong">{n.display_name}</b>
          <span className="mt-0.5 block text-2xs text-muted-foreground">{`Vacant · ${n.department}`}</span>
          {builder ? (
            <span className="mt-2 flex flex-wrap items-center justify-center gap-1">
              <button
                type="button"
                onClick={() => navigate(hrefFor("recruitment", "vacancies", { new: "1", title: n.display_name }))}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-2xs font-strong text-primary-foreground"
              >
                <Icon name="plus" className="size-3" />
                Create Vacancy
              </button>
              <button
                type="button"
                onClick={() => editRole(n)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-2xs font-strong text-subtle-foreground"
              >
                <Icon name="edit" className="size-3" />
                Edit Role
              </button>
            </span>
          ) : (
            <span className="mt-2 inline-block rounded-full border border-dashed border-input px-2 py-0.5 text-2xs font-strong text-subtle-foreground">Open role</span>
          )}
          {toggle(n)}
        </div>
      );
    return (
      <div
        tabIndex={0}
        data-top={n.node_id === top ? "" : undefined}
        draggable={builder && !n.is_ceo}
        onDragStart={() => setDragging(n)}
        onDragEnd={() => (setDragging(null), setOver(null))}
        onClick={() => openPerson(n)}
        onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && openPerson(n)}
        className={cn(
          "og-card relative w-44 cursor-pointer rounded-card border bg-card px-3 py-2.5 text-center shadow-1 transition hover:border-input hover:shadow-2",
          n.is_ceo ? "border-primary shadow-1 ring-2 ring-primary-tint" : "border-border",
          hit(n) && "border-ring ring-2 ring-accent",
          dragging?.node_id === n.node_id && "opacity-50",
        )}
      >
        <Avatar name={n.display_name} src={photo(n.photo_url)} size="lg" tone={n.is_ceo ? "brand" : "soft"} className="mx-auto mb-2" />
        <b className="block text-sm leading-tight font-strong">{n.display_name}</b>
        <span className="mt-0.5 block text-2xs text-muted-foreground">{n.job_title}</span>
        <span className="mt-2 inline-block rounded-full border border-border bg-muted px-2 py-0.5 text-2xs font-strong text-subtle-foreground">{n.department}</span>
        {n.meta && <span className="mt-1.5 block text-2xs text-subtle-foreground">{n.meta}</span>}
        {n.dotted_line_to && <span className="mt-1.5 inline-block rounded-full border border-dashed border-input px-2 py-px text-2xs text-subtle-foreground">{`Dotted line · ${n.dotted_line_to}`}</span>}
        {toggle(n)}
      </div>
    );
  };

  const node = (n: OrgNode) => {
    const kids = folded.has(n.node_id) ? [] : (children.get(n.node_id) ?? []);
    return (
      <li
        key={n.node_id}
        className={cn(over === n.node_id && "drop-target")}
        onDragOver={builder ? (e) => (e.preventDefault(), setOver(n.node_id)) : undefined}
        onDragLeave={builder ? () => setOver((o) => (o === n.node_id ? null : o)) : undefined}
        onDrop={builder ? (e) => drop(n, e) : undefined}
      >
        {card(n)}
        {kids.length > 0 && <ul>{kids.map(node)}</ul>}
      </li>
    );
  };

  /*
   * The phone's focus: the signed-in person on the viewer, or the top when they are not
   * on the chart; the top on the builder. Anyone else at the top is listed beside a root,
   * so every card can be reached, and a search lists the cards that match instead.
   */
  const start = mine ?? top;
  const focused = (focus && byId.get(focus)) || (start ? byId.get(start) : undefined);
  const others = focused && !focused.manager_node_id ? roots.filter((r) => r.node_id !== focused.node_id) : [];
  const colleagues = focused?.manager_node_id ? (children.get(focused.manager_node_id) ?? []).filter((n) => n.node_id !== focused.node_id) : [];
  const matches = term ? nodes.filter(hit) : [];
  const focusOn = (id: string) => (setFocus(id), setQ(""), setView("focus"));
  const exportPdf = () => api.call("POST /api/v1/org-chart/exports", { body: { view: mode } });

  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader
        title={builder ? "Organogram" : "Org Chart"}
        sub={data ? `${data.seats} seats · ${data.filled} filled · ${data.open} open` : " "}
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Name or role" className="w-48 max-md:w-full" />
            {builder && !phone && <Button onClick={() => (setCollapsed(new Set()), setExpandedAll((n) => n + 1))}>Expand All</Button>}
            {builder && !phone && <Button icon="plus" onClick={addRole}>Add Role</Button>}
            <ExportButton onExport={exportPdf} message="PDF on its way to your email">
              Download PDF
            </ExportButton>
          </>
        }
      />
      {data && data.roots > 1 && (
        <Banner tone="warn" icon="alert">
          {`${data.roots} people and roles sit at the top. Give each one a line manager.`}
        </Banner>
      )}
      {!phone && (
        <div className="mt-0.5 mb-1 flex flex-wrap gap-4 text-2xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block w-5.5 border-t-2 border-input" />
            {builder ? <HelpTerm help="Drag a card onto a new manager to change its reporting line.">Reporting Line</HelpTerm> : "Reporting Line"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block w-5.5 border-t-2 border-dashed border-input" />
            <HelpTerm help={DOTTED_HELP}>Dotted Line</HelpTerm>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block size-3 rounded bg-primary" />
            CEO
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block size-3 rounded border border-dashed border-input" />
            Vacant Seat
          </span>
        </div>
      )}
      {!data ? (
        <Card className="p-1.5">
          <LoadingRows count={5} />
        </Card>
      ) : phone && term ? (
        <Matches nodes={matches} teamOf={teamOf} onPick={(n) => focusOn(n.node_id)} />
      ) : phone ? (
        <>
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[
              ["focus", "Focus"],
              ["everyone", "Everyone"],
            ]}
            className="mb-3"
          />
          {view === "everyone" ? (
            <Everyone roots={roots} childrenOf={(id) => children.get(id) ?? []} folded={folded} onFold={fold} teamOf={teamOf} mine={mine} onPick={(n) => focusOn(n.node_id)} />
          ) : (
            <Focus
              focused={focused}
              path={focused ? pathTo(focused, byId) : []}
              manager={focused?.manager_node_id ? byId.get(focused.manager_node_id) : undefined}
              reports={children.get(focused?.node_id ?? "") ?? []}
              dotted={dottedReports.get(focused?.node_id ?? "") ?? []}
              colleagues={colleagues}
              others={others}
              teamOf={teamOf}
              onFocus={setFocus}
              onOpen={openPerson}
              onEditRole={editRole}
              builder={builder}
              atStart={!focus || focus === start}
              startLabel={mine ? "Show Me" : "Show Top"}
              onStart={() => setFocus(null)}
            />
          )}
        </>
      ) : (
        <Card className="p-1.5">
          <div ref={scroller} className="ogt" data-copy="content">
            <ul>{roots.map(node)}</ul>
          </div>
        </Card>
      )}
    </>
  );
}

/** One card of the phone's views: a tap moves the focus to it, or on the focused person opens their sheet. */
function NodeTile({
  n,
  large = false,
  team,
  you = false,
  dotted = true,
  onPick,
}: {
  n: OrgNode;
  large?: boolean;
  team: string | null;
  you?: boolean;
  /** The dotted-line tag; off where the section already says whose dotted line it is. */
  dotted?: boolean;
  onPick?: (n: OrgNode) => void;
}) {
  const photo = usePhoto(n.photo_url);
  const body = (
    <>
      {n.vacant ? (
        <span
          aria-hidden
          className={cn(
            "flex flex-none items-center justify-center rounded-full border border-dashed border-input bg-muted font-bold text-subtle-foreground",
            large ? "size-13 text-base" : "size-10.5 text-sm",
          )}
        >
          <Icon name="plus" />
        </span>
      ) : (
        <Avatar name={n.display_name} src={photo} size={large ? "xl" : "lg"} tone={n.is_ceo ? "brand" : "soft"} />
      )}
      <span className="min-w-0 flex-1" data-copy="content">
        <b className={cn("block truncate font-strong", large ? "text-base" : "text-sm")}>{n.display_name}</b>
        <span className="block truncate text-2xs text-muted-foreground">{n.vacant ? `Vacant · ${n.department}` : `${n.job_title} · ${n.department}`}</span>
        {large && n.meta && <span className="block truncate text-2xs text-subtle-foreground">{n.meta}</span>}
        {team && <span className="block truncate text-2xs text-subtle-foreground">{team}</span>}
        {dotted && n.dotted_line_to && <span className="block truncate text-2xs text-subtle-foreground">{`Dotted line · ${n.dotted_line_to}`}</span>}
      </span>
      {you && <Pill tone="neutral">You</Pill>}
      {onPick && <Icon name="right" className="flex-none text-subtle-foreground" />}
    </>
  );
  /* min-w-0: beside Everyone's fold arrow a tile is a flex item, and must shrink to truncate its text. */
  const box = cn(
    "flex min-h-tap w-full min-w-0 items-center gap-3 rounded-card border bg-card px-3 py-2.5 text-left",
    n.vacant ? "border-dashed border-input" : "border-border",
    large && "border-2 border-secondary py-3.5",
  );
  return onPick ? (
    <button type="button" onClick={() => onPick(n)} className={box}>
      {body}
    </button>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** A titled list of cards on a phone, "Direct Reports · 3"; nothing when it is empty. */
function Section({
  title,
  nodes,
  teamOf,
  onPick,
  dotted = true,
}: {
  title: string;
  nodes: OrgNode[];
  teamOf: (n: OrgNode) => string | null;
  onPick: (n: OrgNode) => void;
  dotted?: boolean;
}) {
  if (!nodes.length) return null;
  return (
    <section>
      <h2 className="mb-1.5 text-2xs font-strong text-subtle-foreground uppercase" data-ui="title">
        {`${title} · ${nodes.length}`}
      </h2>
      <div className="flex flex-col gap-2">
        {nodes.map((n) => (
          <NodeTile key={n.node_id} n={n} team={teamOf(n)} dotted={dotted} onPick={onPick} />
        ))}
      </div>
    </section>
  );
}

/** The phone's search: the people and open roles that match, each a tap from the focus. */
function Matches({ nodes, teamOf, onPick }: { nodes: OrgNode[]; teamOf: (n: OrgNode) => string | null; onPick: (n: OrgNode) => void }) {
  if (!nodes.length) return <EmptyState illustration="Search" title="No Match" text="Try another name or role." />;
  return <Section title="Matches" nodes={nodes} teamOf={teamOf} onPick={onPick} />;
}

/** The phone's whole company: one indented list, folding as the desktop tree does; a tap focuses a row. */
function Everyone({
  roots,
  childrenOf,
  folded,
  onFold,
  teamOf,
  mine,
  onPick,
}: {
  roots: OrgNode[];
  childrenOf: (id: string) => OrgNode[];
  folded: Set<string>;
  onFold: (id: string) => void;
  teamOf: (n: OrgNode) => string | null;
  mine: string | null;
  onPick: (n: OrgNode) => void;
}) {
  const rows: Array<{ n: OrgNode; depth: number }> = [];
  const walk = (n: OrgNode, depth: number) => {
    rows.push({ n, depth });
    if (!folded.has(n.node_id)) childrenOf(n.node_id).forEach((k) => walk(k, depth + 1));
  };
  roots.forEach((r) => walk(r, 0));
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map(({ n, depth }) => {
        const kids = childrenOf(n.node_id).length;
        const shut = folded.has(n.node_id);
        return (
          <li key={n.node_id} className={cn("flex items-center gap-1", INDENT[Math.min(depth, INDENT.length - 1)])}>
            {kids > 0 ? (
              <button
                type="button"
                aria-expanded={!shut}
                aria-label={`${shut ? "Expand" : "Collapse"} ${n.display_name}`}
                onClick={() => onFold(n.node_id)}
                className="flex size-tap flex-none items-center justify-center rounded-full text-muted-foreground"
              >
                <Icon name={shut ? "right" : "down"} />
              </button>
            ) : (
              <span className="size-tap flex-none" aria-hidden />
            )}
            <NodeTile n={n} team={teamOf(n)} you={n.node_id === mine} onPick={onPick} />
          </li>
        );
      })}
    </ul>
  );
}

/** The phone's focus view: the path from the top, the manager, the person, and the people around them. */
function Focus({
  focused,
  path,
  manager,
  reports,
  dotted,
  colleagues,
  others,
  teamOf,
  onFocus,
  onOpen,
  onEditRole,
  builder,
  atStart,
  startLabel,
  onStart,
}: {
  focused: OrgNode | undefined;
  path: OrgNode[];
  manager: OrgNode | undefined;
  reports: OrgNode[];
  dotted: OrgNode[];
  colleagues: OrgNode[];
  others: OrgNode[];
  teamOf: (n: OrgNode) => string | null;
  onFocus: (id: string) => void;
  onOpen: (n: OrgNode) => void;
  onEditRole: (n: OrgNode) => void;
  builder: boolean;
  atStart: boolean;
  startLabel: string;
  onStart: () => void;
}) {
  const { navigate } = useRouter();
  if (!focused) return null;
  const pick = (n: OrgNode) => onFocus(n.node_id);

  return (
    <div className="flex flex-col gap-3">
      {path.length > 1 && (
        <nav aria-label="Reporting line" data-copy="content">
          <ol className="flex flex-wrap items-center gap-1">
            {path.map((p, i) => (
              <li key={p.node_id} className="flex items-center gap-1">
                {i > 0 && <Icon name="right" className="text-subtle-foreground" />}
                {i < path.length - 1 ? (
                  <button type="button" onClick={() => pick(p)} className="inline-flex min-h-tap items-center rounded-full border border-border bg-card px-3 text-xs font-strong">
                    {p.display_name}
                  </button>
                ) : (
                  <span aria-current="true" className="inline-flex min-h-tap items-center rounded-full border border-secondary bg-accent px-3 text-xs font-strong text-accent-foreground">
                    {p.display_name}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      {manager && (
        <section>
          <h2 className="mb-1.5 text-2xs font-strong text-subtle-foreground uppercase" data-ui="title">
            Reports To
          </h2>
          <NodeTile n={manager} team={teamOf(manager)} onPick={pick} />
        </section>
      )}
      <section>
        <NodeTile n={focused} large team={teamOf(focused)} onPick={focused.vacant ? undefined : onOpen} />
      </section>
      {focused.vacant && builder && (
        <>
          <Button variant="primary" className="w-full" icon="plus" onClick={() => navigate(hrefFor("recruitment", "vacancies", { new: "1", title: focused.display_name }))}>
            Create Vacancy
          </Button>
          <Button className="w-full" icon="edit" onClick={() => onEditRole(focused)}>
            Edit Role
          </Button>
        </>
      )}
      <Section title="Direct Reports" nodes={reports} teamOf={teamOf} onPick={pick} />
      <Section title="Dotted Line" nodes={dotted} teamOf={teamOf} onPick={pick} dotted={false} />
      <Section title="Same Manager" nodes={colleagues} teamOf={teamOf} onPick={pick} />
      <Section title="Also At The Top" nodes={others} teamOf={teamOf} onPick={pick} />
      {!atStart && (
        <Button className="w-full" onClick={onStart}>
          {startLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * A person's sheet: what the chart holds about them, and what the person looking may do with
 * it (organogram.md §8). Send Message for everyone, My Profile on your own card, Open Record
 * and Change Manager by grant.
 */
function PersonSheet({
  n,
  manager,
  team,
  self,
  canOpenRecord,
  canChangeManager,
  onMessage,
  onOpenRecord,
  onMyProfile,
  onChangeManager,
}: {
  n: OrgNode;
  manager: OrgNode | undefined;
  team: string | null;
  self: boolean;
  canOpenRecord: boolean;
  canChangeManager: boolean;
  onMessage: () => void;
  onOpenRecord: () => void;
  onMyProfile: () => void;
  onChangeManager: () => void;
}) {
  const photo = usePhoto(n.photo_url);
  const items: Array<[ReactNode, ReactNode]> = [["Department", n.department]];
  if (manager) items.push(["Reports To", manager.vacant ? `${manager.display_name} (open role)` : manager.display_name]);
  if (n.dotted_line_to)
    items.push([
      <HelpTerm key="dotted" help={DOTTED_HELP}>
        Dotted Line
      </HelpTerm>,
      n.dotted_line_to,
    ]);
  if (team) items.push(["Team", team]);
  return (
    <>
      <div className="mb-3" data-copy="content">
        <Who name={n.display_name} role={n.job_title} size="lg" src={photo} />
      </div>
      <KeyValue items={items} />
      <ModalFooter>
        {self ? (
          <Button variant="primary" onClick={onMyProfile}>
            My Profile
          </Button>
        ) : (
          <>
            {canChangeManager && <Button onClick={onChangeManager}>Change Manager</Button>}
            {canOpenRecord && <Button onClick={onOpenRecord}>Open Record</Button>}
            <Button variant="primary" icon="msg" onClick={onMessage}>
              Send Message
            </Button>
          </>
        )}
      </ModalFooter>
    </>
  );
}

/**
 * An open role: a seat in the structure that carries reports until somebody fills it.
 * The same form adds one and corrects one, including who the seat itself reports to,
 * which is how a seat the sheet left at the top of the tree gets its line.
 */
function SeatForm({ close, onSaved, seat, manager }: { close: () => void; onSaved: () => void; seat?: OrgNode; manager?: OrgNode }) {
  const departments = usePaged("GET /api/v1/departments");
  const [title, setTitle] = useState(seat?.display_name ?? "");
  const [department, setDepartment] = useState("");
  const [reportsTo, setReportsTo] = useState<PersonRef[]>(
    manager && manager.employee_id
      ? [{ employee_id: manager.employee_id, display_name: manager.display_name, job_title: manager.job_title, department: manager.department }]
      : [],
  );
  const [tried, setTried] = useState(false);
  const add = useMutation("POST /api/v1/org-seats");
  const edit = useMutation("PATCH /api/v1/org-seats/:id");
  const save = seat ? edit : add;
  const chosen = department || departments.rows.find((d) => d.name === seat?.department)?.department_id || "";
  const bad = { title: title.trim().length < 2, department: !chosen };
  const submit = async () => {
    setTried(true);
    if (bad.title || bad.department) return;
    const body = {
      title: title.trim(),
      department_id: chosen,
      ...(seat ? { line_manager_id: reportsTo[0]?.employee_id ?? null } : reportsTo[0] ? { line_manager_id: reportsTo[0].employee_id } : {}),
    };
    try {
      if (seat) await edit.run({ params: { id: seat.node_id }, body });
      else await add.run({ body });
      invalidate("/api/v1/org-chart", "/api/v1/org-seats");
      onSaved();
      close();
      toast(seat ? `${title.trim()} saved` : `${title.trim()} added as an open role`);
    } catch {
      toast(save.error?.message ?? "Not saved");
    }
  };
  return (
    <>
      <Field label="Role Title" state={tried ? (bad.title ? "bad" : "good") : undefined} message="Name the role">
        <TextField value={title} onChange={setTitle} placeholder="Head of Sales" state={tried ? (bad.title ? "bad" : "good") : undefined} />
      </Field>
      <Field label="Department" state={tried && bad.department ? "bad" : undefined} message="Pick a department">
        <SelectField
          value={chosen}
          onChange={setDepartment}
          placeholder="Pick a department"
          options={departments.rows.map((d) => [d.department_id, d.name] as [string, string])}
        />
      </Field>
      <Field label="Reports To" optional>
        <EmployeePicker value={reportsTo} onChange={setReportsTo} placeholder="Manager's name" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => submit()}>
          {seat ? "Save Role" : "Add Role"}
        </Button>
      </FormFooter>
    </>
  );
}

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { OrgNode } from "@/api/types/organisation";
import type { PersonRef } from "@/api/types/common";
import { EmployeePicker } from "@/features/shared/pickers";
import { useMe } from "@/auth/AuthProvider";
import { hrefFor, useRouter } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import {
  Banner,
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  Field,
  FormFooter,
  HelpTerm,
  Icon,
  initials,
  LoadingRows,
  PageHeader,
  SearchInput,
  SelectField,
  TextField,
  toast,
  useIsPhone,
  useModal,
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
 * On a phone it is not the tree shrunk but a focus view (§10.2): who the focused person
 * reports to, the person, and their direct reports, each a tap away. The CEO is the top;
 * anyone else at the top is listed beside them, and a search lists the matching cards.
 */
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
  const { navigate } = useRouter();
  const move = useMutation("PATCH /api/v1/employees/:id/line-manager");
  const [q, setQ] = useState("");
  const [dragging, setDragging] = useState<OrgNode | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null);
  const [expandedAll, setExpandedAll] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
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
    /* The desktop tree marks it as a search would; a phone opens straight on it. */
    if (!phone) setQ(opened.display_name);
  }, [opened, phone]);
  const children = useMemo(() => {
    const m = new Map<string | null, OrgNode[]>();
    for (const n of nodes) m.set(n.manager_node_id, [...(m.get(n.manager_node_id) ?? []), n]);
    return m;
  }, [nodes]);
  /* The CEO is the top whatever else sits there; the rest keep the server's order. */
  const roots = useMemo(
    () => [...(children.get(null) ?? [])].sort((a, b) => Number(b.is_ceo) - Number(a.is_ceo)),
    [children],
  );
  const top = roots[0]?.node_id ?? null;
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

  /* Start with the top three levels open; deeper branches open on a tap. */
  const folded = useMemo(() => {
    if (collapsed) return collapsed;
    const out = new Set<string>();
    const walk = (n: OrgNode, depth: number) => {
      const kids = children.get(n.node_id) ?? [];
      if (depth >= 2 && kids.length) out.add(n.node_id);
      kids.forEach((k) => walk(k, depth + 1));
    };
    roots.forEach((r) => walk(r, 0));
    return out;
  }, [collapsed, children, roots]);

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

  const openNode = (n: OrgNode) => {
    if (n.employee_id) navigate(hrefFor("people", "employees", { id: n.employee_id }));
  };

  /* A card with reports, a person's or an open seat's, folds and unfolds its branch. */
  const toggle = (n: OrgNode) =>
    (children.get(n.node_id)?.length ?? 0) > 0 && (
      <button
        type="button"
        aria-label={folded.has(n.node_id) ? "Expand" : "Collapse"}
        onClick={(e) => (
          e.stopPropagation(),
          setCollapsed(() => {
            const x = new Set(folded);
            if (x.has(n.node_id)) x.delete(n.node_id);
            else x.add(n.node_id);
            return x;
          })
        )}
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
        onClick={() => openNode(n)}
        className={cn(
          "og-card relative w-44 cursor-pointer rounded-card border bg-card px-3 py-2.5 text-center shadow-1 transition hover:border-input hover:shadow-2",
          n.is_ceo ? "border-primary shadow-1 ring-2 ring-primary-tint" : "border-border",
          hit(n) && "border-ring ring-2 ring-accent",
          dragging?.node_id === n.node_id && "opacity-50",
        )}
      >
        <span className={cn("mx-auto mb-2 flex size-10.5 items-center justify-center rounded-full text-sm font-bold", n.is_ceo ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
          {initials(n.display_name)}
        </span>
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
  const mine = !builder && me.employee_id && byId.has(me.employee_id) ? me.employee_id : null;
  const start = mine ?? top;
  const focused = (focus && byId.get(focus)) || (start ? byId.get(start) : undefined);
  const others = focused && !focused.manager_node_id ? roots.filter((r) => r.node_id !== focused.node_id) : [];
  const matches = term ? nodes.filter(hit) : [];

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
            {builder && <Button icon="plus" onClick={addRole}>Add Role</Button>}
            {!phone && (
              <Button icon="doc" onClick={() => toast("PDF queued, check your Mailbox")}>
                Download PDF
              </Button>
            )}
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
            <HelpTerm help="Drag a card onto a new manager to change its reporting line.">Reporting Line</HelpTerm>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block w-5.5 border-t-2 border-dashed border-input" />
            <HelpTerm help="A second manager for matrix work. It does not change who approves leave, expenses or tasks.">Dotted Line</HelpTerm>
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
        <Matches nodes={matches} childrenOf={(id) => (children.get(id) ?? []).length} onPick={(id) => (setFocus(id), setQ(""))} />
      ) : phone ? (
        <Focus
          focused={focused}
          manager={focused?.manager_node_id ? byId.get(focused.manager_node_id) : undefined}
          reports={children.get(focused?.node_id ?? "") ?? []}
          others={others}
          childrenOf={(id) => (children.get(id) ?? []).length}
          onFocus={setFocus}
          onOpen={openNode}
          onEditRole={editRole}
          builder={builder}
          atStart={!focus || focus === start}
          startLabel={mine ? "Show Me" : "Show Top"}
          onStart={() => setFocus(null)}
        />
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

/** One card of the phone's focus view or search: a tap moves the focus to it. */
function NodeTile({ n, large = false, reports, onPick }: { n: OrgNode; large?: boolean; reports: number; onPick: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(n.node_id)}
      data-copy="content"
      className={cn(
        "flex min-h-tap w-full items-center gap-3 rounded-card border bg-card px-3 py-2.5 text-left",
        n.vacant ? "border-dashed border-input" : "border-border",
        large && "border-2 border-secondary",
      )}
    >
      <span className={cn("flex size-10.5 flex-none items-center justify-center rounded-full text-sm font-bold", n.vacant ? "border border-dashed border-input bg-muted text-subtle-foreground" : "bg-accent text-accent-foreground")}>
        {n.vacant ? <Icon name="plus" /> : initials(n.display_name)}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-sm font-strong">{n.display_name}</b>
        <span className="block truncate text-2xs text-muted-foreground">{n.vacant ? `Vacant · ${n.department}` : n.job_title}</span>
        {n.dotted_line_to && <span className="block truncate text-2xs text-subtle-foreground">{`Dotted line · ${n.dotted_line_to}`}</span>}
      </span>
      {reports > 0 && <span className="flex-none rounded-full border border-border bg-muted px-2 py-0.5 text-2xs font-strong text-subtle-foreground">{reports}</span>}
    </button>
  );
}

/** The phone's search: the people and open roles that match, each a tap from the focus. */
function Matches({ nodes, childrenOf, onPick }: { nodes: OrgNode[]; childrenOf: (id: string) => number; onPick: (id: string) => void }) {
  if (!nodes.length) return <EmptyState illustration="Search" title="No Match" text="Try another name or role." />;
  return (
    <section>
      <h2 className="mb-1.5 text-2xs font-strong text-subtle-foreground uppercase" data-ui="title">
        {`Matches · ${nodes.length}`}
      </h2>
      <div className="flex flex-col gap-2">
        {nodes.map((n) => (
          <NodeTile key={n.node_id} n={n} reports={childrenOf(n.node_id)} onPick={onPick} />
        ))}
      </div>
    </section>
  );
}

/** The phone's focus view: the manager above, the person, the reports below, and anyone else at the top. */
function Focus({
  focused,
  manager,
  reports,
  others,
  childrenOf,
  onFocus,
  onOpen,
  onEditRole,
  builder,
  atStart,
  startLabel,
  onStart,
}: {
  focused: OrgNode | undefined;
  manager: OrgNode | undefined;
  reports: OrgNode[];
  others: OrgNode[];
  childrenOf: (id: string) => number;
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
  const tile = (n: OrgNode, size: "sm" | "lg") => <NodeTile key={n.node_id} n={n} large={size === "lg"} reports={childrenOf(n.node_id)} onPick={onFocus} />;

  return (
    <div className="flex flex-col gap-3">
      {manager && (
        <section>
          <h2 className="mb-1.5 text-2xs font-strong text-subtle-foreground uppercase" data-ui="title">
            Reports To
          </h2>
          {tile(manager, "sm")}
        </section>
      )}
      <section>{tile(focused, "lg")}</section>
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
      {!focused.vacant && (
        <Button className="w-full" onClick={() => onOpen(focused)}>
          Open Record
        </Button>
      )}
      <section>
        <h2 className="mb-1.5 text-2xs font-strong text-subtle-foreground uppercase" data-ui="title">
          {`Direct Reports · ${reports.length}`}
        </h2>
        <div className="flex flex-col gap-2">{reports.map((r) => tile(r, "sm"))}</div>
      </section>
      {others.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-2xs font-strong text-subtle-foreground uppercase" data-ui="title">
            {`Also At The Top · ${others.length}`}
          </h2>
          <div className="flex flex-col gap-2">{others.map((r) => tile(r, "sm"))}</div>
        </section>
      )}
      {!atStart && (
        <Button className="w-full" onClick={onStart}>
          {startLabel}
        </Button>
      )}
    </div>
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

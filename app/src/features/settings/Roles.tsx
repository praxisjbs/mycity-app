import { useEffect, useState } from "react";
import type { AccessCatalogue, RoleGrant, RoleMatrix, RoleOption, RoleRow, UserRow } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { usePhotos } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { hrefFor, useLeaveGuard, useRouter, useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import {
  ACTION_WORD,
  AREAS,
  atLevel,
  bodyOf,
  changesOf,
  coreOf,
  draftOf,
  grantWords,
  has,
  HOMES,
  KEY,
  KIND_TONE,
  LEVELS,
  lettersOf,
  levelOf,
  levelWord,
  rankOf,
  SCOPE_HELP,
  SCOPE_WORD,
  SCOPES,
  scopeOf,
  STEPS,
  summaryOf,
  toggled,
  usualScope,
  type Draft,
  type Level,
  type Module,
  type Scope,
} from "./levels";
import {
  BackButton,
  Banner,
  Button,
  CardHeader,
  CheckboxField,
  ChoiceField,
  cn,
  CountBadge,
  DataView,
  DesktopOnly,
  ErrorState,
  Field,
  FormFooter,
  HelpTerm,
  InfoButton,
  ItemChip,
  KeyValue,
  LevelMeter,
  LoadingRows,
  Modal,
  PageHeader,
  PhoneOnly,
  Pill,
  RadioCards,
  RecordPicker,
  SegmentedControl,
  SplitPanes,
  StepBar,
  Sub,
  Tabs,
  TextField,
  toast,
  useConfirm,
  useContractForm,
  useIsPhone,
  useModal,
  useSplitPanes,
  Who,
} from "@mycity/ui";

type Tab = "access" | "details" | "people";

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);
const modules = (n: number) => (n === 1 ? "1 module" : `${n} modules`);

/* ───────────── The screen ───────────── */

interface Edit {
  /** What the role was when editing began (a new role: blank, with its name). */
  base: Draft;
  draft: Draft;
  /** A role not created yet. */
  fresh: boolean;
}

/**
 * Settings · Roles & Permissions (docs/guides/foundation.md §6.10, §10): the
 * roles beside the role in view on desktop, a role's modules by level on a
 * phone, and the grants matrix as a second view. A role opens read first; Edit
 * Role makes it editable, and Save Role shows what changes before it saves.
 */
export function Roles() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const modal = useModal();
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const canCreate = can("settings", "create");
  const canEdit = can("settings", "edit");
  const canDelete = can("settings", "delete");
  const view = params.get("view") === "matrix" && !phone ? "matrix" : "roles";
  const list = usePaged("GET /api/v1/settings/roles");
  const cat = useApi("GET /api/v1/settings/roles/catalogue");
  const split = useSplitPanes("roles", 300);
  const [picked, setPicked] = useState<string | null>(params.get("id"));
  const [open, setOpen] = useState(Boolean(params.get("id")));
  const [tab, setTab] = useState<Tab>("access");
  const [edit, setEdit] = useState<Edit | null>(null);

  const rows = list.rows;
  const currentId = edit?.fresh ? null : (picked ?? (phone ? null : (rows[0]?.role_id ?? null)));
  const role = useApi("GET /api/v1/settings/roles/:id", { params: { id: currentId ?? "" }, enabled: Boolean(currentId) });
  const pending = edit && cat.data ? changesOf(cat.data, edit.base, edit.draft) : [];
  const dirty = Boolean(edit && (edit.fresh || pending.length));

  const askDiscard = () =>
    confirm({
      title: "Discard Changes",
      body: edit?.fresh ? `${edit.draft.name} is not created yet.` : `${edit?.draft.name ?? "This role"} has ${pending.length === 1 ? "1 change" : `${pending.length} changes`} not saved.`,
      confirmLabel: "Discard Changes",
      cancelLabel: "Keep Editing",
      destructive: true,
    });
  /** Unsaved edits ask once before they are dropped; true to go on. */
  const mayLeave = async () => !dirty || (await askDiscard());
  useLeaveGuard(dirty, askDiscard);

  const pick = async (id: string) => {
    if (id === currentId && !edit?.fresh) {
      setOpen(true);
      return;
    }
    if (!(await mayLeave())) return;
    setEdit(null);
    setPicked(id);
    setOpen(true);
    setTab("access");
    setParams({ id, view: null }, { replace: true });
  };

  const back = async () => {
    if (!(await mayLeave())) return;
    setEdit(null);
    setOpen(false);
  };

  const showView = async (v: "roles" | "matrix") => {
    if (v === view) return;
    if (!(await mayLeave())) return;
    setEdit(null);
    setParams({ view: v === "matrix" ? "matrix" : null }, { replace: true });
  };

  /** Step 1 done (New Role): the role opens here, editing, on Access. */
  const begin = async (name: string, from: string | null) => {
    if (!cat.data) return;
    const source = from ? await api.call("GET /api/v1/settings/roles/:id", { params: { id: from } }) : null;
    const base = { ...draftOf(cat.data, null), name };
    const draft = { ...draftOf(cat.data, source), role_id: null, code: null, name, description: "", is_system: false, users: 0 };
    setEdit({ base, draft, fresh: true });
    setTab("access");
    setOpen(true);
  };

  const newRole = async () => {
    if (!cat.data || !(await mayLeave())) return;
    setEdit(null);
    modal.open({ title: "New Role", body: (close) => <NewRoleStep close={close} onNext={begin} />, onClose: () => setParams({ new: null }, { replace: true }) });
  };
  useScreenAction(canCreate ? { label: "New Role", onSelect: () => void newRole() } : null);
  // The assistant's "create a role" opens this screen with ?new=1.
  useEffect(() => {
    if (params.get("new") === "1" && canCreate && cat.data) void newRole();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival, when the catalogue is in
  }, [params.get("new"), canCreate, Boolean(cat.data)]);

  const saved = (id: string | null) => {
    invalidate("/api/v1/settings/roles");
    invalidate("/api/v1/access/roles");
    invalidate("/api/v1/users");
    setEdit(null);
    if (id) {
      setPicked(id);
      setParams({ id }, { replace: true });
    }
  };

  const removed = () => {
    invalidate("/api/v1/settings/roles");
    invalidate("/api/v1/access/roles");
    setEdit(null);
    setPicked(null);
    setOpen(false);
    setParams({ id: null }, { replace: true });
  };

  const detail = cat.error ? (
    <ErrorState error={cat.error} onRetry={cat.reload} />
  ) : !cat.data ? (
    <LoadingRows count={8} />
  ) : edit ? (
    <RoleView
      cat={cat.data}
      d={edit.draft}
      base={edit.base}
      fresh={edit.fresh}
      editing
      tab={tab}
      setTab={setTab}
      onBack={() => void back()}
      onDraft={(draft) => setEdit((e) => (e ? { ...e, draft } : e))}
      onCancel={() => setEdit(null)}
      onSaved={saved}
      onRemoved={removed}
      canDelete={canDelete}
    />
  ) : currentId && role.error ? (
    <ErrorState error={role.error} onRetry={role.reload} />
  ) : currentId && role.data && role.data.role_id === currentId ? (
    <RoleView
      cat={cat.data}
      d={draftOf(cat.data, role.data)}
      base={null}
      fresh={false}
      editing={false}
      tab={tab}
      setTab={setTab}
      onBack={() => void back()}
      onEdit={canEdit ? () => cat.data && role.data && setEdit({ base: draftOf(cat.data, role.data), draft: draftOf(cat.data, role.data), fresh: false }) : undefined}
      canDelete={canDelete}
    />
  ) : currentId ? (
    <LoadingRows count={8} />
  ) : (
    <p className="m-auto p-6 text-xs text-subtle-foreground">{list.loading ? "" : "Pick a role to open it."}</p>
  );

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        sub="Who opens what, and how far"
        actions={
          canCreate ? (
            <DesktopOnly>
              <Button variant="primary" icon="plus" onClick={() => newRole()}>
                New Role
              </Button>
            </DesktopOnly>
          ) : undefined
        }
      >
        <DesktopOnly>
          <SegmentedControl label="View" small value={view} onChange={(v) => void showView(v)} options={[["roles", "Roles"], ["matrix", "Matrix"]]} />
        </DesktopOnly>
      </PageHeader>
      {view === "matrix" ? (
        <MatrixView cat={cat.data} onRole={(id) => (setPicked(id), setTab("access"), setParams({ view: null, id }, { replace: true }))} />
      ) : (
        <SplitPanes
          split={split}
          open={open || Boolean(edit?.fresh)}
          minHeight="md"
          list={
            <DataView
              bare
              list={list}
              search="Search Roles"
              rowKey={(r) => r.role_id}
              selectedKey={edit?.fresh ? null : currentId}
              noun="role"
              onRowClick={(r: RoleRow) => void pick(r.role_id)}
              columns={[
                {
                  key: "name",
                  label: "Role",
                  sortable: true,
                  render: (r) => (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <b>{r.name}</b>
                      {!r.is_system && <Pill tone="info">Custom</Pill>}
                    </span>
                  ),
                },
                { key: "users", label: "People", align: "n", render: (r) => r.users },
                { key: "modules", label: "Modules", align: "n", render: (r) => r.modules },
              ]}
            />
          }
          detail={detail}
        />
      )}
    </>
  );
}

/* ───────────── One role ───────────── */

interface RoleViewProps {
  cat: AccessCatalogue;
  d: Draft;
  /** The role before editing; null when reading. */
  base: Draft | null;
  fresh: boolean;
  editing: boolean;
  tab: Tab;
  setTab: (t: Tab) => void;
  onBack: () => void;
  onEdit?: () => void;
  onDraft?: (d: Draft) => void;
  onCancel?: () => void;
  onSaved?: (id: string | null) => void;
  onRemoved?: () => void;
  canDelete: boolean;
}

function RoleView({ cat, d, base, fresh, editing, tab, setTab, onBack, onEdit, onDraft, onCancel, onSaved, onRemoved, canDelete }: RoleViewProps) {
  const confirm = useConfirm();
  const [sheet, setSheet] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const create = useMutation("POST /api/v1/settings/roles");
  const update = useMutation("PUT /api/v1/settings/roles/:id");
  const remove = useMutation("DELETE /api/v1/settings/roles/:id");
  const granted = cat.modules.filter((m) => d.grants[m.key].actions.length).length;
  const pending = base ? changesOf(cat, base, d) : [];
  const setGrant = (key: string, g: RoleGrant) => onDraft?.({ ...d, grants: { ...d.grants, [key]: g } });
  const fallback = usualScope(cat, d);

  const nameProblem = (name: string) => (name.trim().length < 2 ? "At least 2 characters" : null);

  const review = () => {
    const bad = nameProblem(d.name);
    if (bad) {
      setNameError(bad);
      setTab("details");
      return;
    }
    if (!granted) {
      toast("Grant at least one module");
      setTab("access");
      return;
    }
    if (!fresh && !pending.length) {
      toast("No changes to save");
      return;
    }
    setReviewing(true);
  };

  const save = async () => {
    try {
      const r = fresh ? await create.run({ body: bodyOf(d) }) : await update.run({ params: { id: d.role_id! }, body: bodyOf(d) });
      setReviewing(false);
      onSaved?.(r.role_id);
      toast(fresh ? `${r.name} created` : `${r.name} saved`);
    } catch (e) {
      setReviewing(false);
      if (e instanceof ApiError && e.fields.name?.length) {
        setNameError(e.fields.name[0]);
        setTab("details");
      } else toast(e instanceof ApiError ? e.message : "Could not save the role");
    }
  };

  const del = async () => {
    if (!d.role_id || !(await confirm({ title: "Delete Role", body: `${d.name} goes for good.`, confirmLabel: "Delete Role", destructive: true }))) return;
    try {
      await remove.run({ params: { id: d.role_id } });
      onRemoved?.();
      toast(`${d.name} deleted`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not delete the role");
    }
  };

  const step = tab === "details" ? 2 : 1;
  const sheetModule = sheet ? cat.modules.find((m) => m.key === sheet) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none border-b border-border px-4 pt-3">
        <PhoneOnly>
          <BackButton label="Roles" onBack={onBack} />
        </PhoneOnly>
        <CardHeader
          record
          title={d.name || "New Role"}
          actions={
            !editing && onEdit ? (
              <DesktopOnly>
                <Button icon="edit" onClick={onEdit}>
                  Edit Role
                </Button>
              </DesktopOnly>
            ) : editing ? (
              <Pill tone="warn">Editing</Pill>
            ) : undefined
          }
        >
          {d.is_system ? <Pill>Built-In</Pill> : <Pill tone="info">Custom</Pill>}
          <InfoButton label="Role Summary" help={summaryOf(cat, d)} />
        </CardHeader>
        <Sub>
          {people(d.users)} · {modules(granted)} · Home: {HOMES.find(([v]) => v === d.home)?.[1]}
        </Sub>
        {fresh && <StepBar steps={STEPS} at={step} titled className="mt-3" />}
        <Tabs
          label="Role"
          className="mt-2"
          value={tab}
          onValueChange={(t) => setTab(t as Tab)}
          items={[
            { value: "access", label: "Access" },
            { value: "details", label: "Details" },
            { value: "people", label: "People", count: d.users },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "access" && <AccessPanel cat={cat} d={d} editing={editing} fallback={fallback} onGrant={setGrant} sheet={sheet} onSheet={setSheet} />}
        {tab === "details" && <DetailsPanel cat={cat} d={d} editing={editing} nameError={nameError} onName={(name) => (setNameError(null), onDraft?.({ ...d, name }))} onDraft={(next) => onDraft?.(next)} />}
        {tab === "people" && (d.code && !fresh ? <PeoplePanel code={d.code} /> : <p className="py-6 text-center text-xs text-subtle-foreground">Nobody holds it yet.</p>)}
      </div>

      {editing ? (
        <div className="flex-none border-t border-border px-4 pb-3">
          <FormFooter>
            {!fresh && !d.is_system && canDelete && (
              <Button className="desk:mr-auto" variant="danger" busy={remove.pending} onClick={() => del()}>
                Delete Role
              </Button>
            )}
            {fresh && tab === "details" ? <Button onClick={() => setTab("access")}>Back</Button> : <Button onClick={onCancel}>Cancel</Button>}
            {fresh && tab !== "details" ? (
              <Button variant="primary" onClick={() => setTab("details")}>
                Next
              </Button>
            ) : (
              <Button variant="primary" onClick={review}>
                {fresh ? "Review Role" : "Save Role"}
              </Button>
            )}
          </FormFooter>
        </div>
      ) : (
        onEdit && (
          <PhoneOnly className="flex-none border-t border-border px-4 pt-3 pb-3">
            <Button block variant="primary" icon="edit" onClick={onEdit}>
              Edit Role
            </Button>
          </PhoneOnly>
        )
      )}

      {sheetModule && (
        <ModuleSheet
          mod={sheetModule}
          g={d.grants[sheetModule.key]}
          roleName={d.name}
          fallback={fallback}
          onGrant={(g) => setGrant(sheetModule.key, g)}
          onClose={() => setSheet(null)}
        />
      )}

      <Modal
        open={reviewing}
        onClose={() => setReviewing(false)}
        title={fresh ? "Review New Role" : "Review Changes"}
        footer={
          <>
            <Button onClick={() => setReviewing(false)}>Back</Button>
            <Button variant="primary" busy={create.pending || update.pending} onClick={() => save()}>
              {fresh ? "Create Role" : "Save Role"}
            </Button>
          </>
        }
      >
        {fresh && <StepBar steps={STEPS} at={3} titled className="mb-3" />}
        <ul className="divide-y divide-border">
          {pending.map((c) => (
            <li key={`${c.kind}:${c.what}`} className="flex items-center gap-3 py-2">
              <Pill tone={KIND_TONE[c.kind]} className="w-20 flex-none justify-center">
                {c.kind}
              </Pill>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold" data-copy="content">
                  {c.what}
                </span>
                <Sub data-copy="content">
                  {c.from} → {c.to}
                </Sub>
              </span>
            </li>
          ))}
        </ul>
        <Banner tone="info" icon="users" className="mt-3">
          {d.users ? `Reaches ${people(d.users)}` : "Nobody holds it yet"}
        </Banner>
      </Modal>
    </div>
  );
}

/* ───────────── Access ───────────── */

interface AccessPanelProps {
  cat: AccessCatalogue;
  d: Draft;
  editing: boolean;
  fallback: Scope;
  onGrant: (key: string, g: RoleGrant) => void;
  sheet: string | null;
  onSheet: (key: string) => void;
}

function AccessPanel(props: AccessPanelProps) {
  return (
    <>
      <DesktopOnly>
        <AccessRows {...props} />
      </DesktopOnly>
      <PhoneOnly>
        <AccessByLevel {...props} />
      </PhoneOnly>
    </>
  );
}

/** Desktop: the modules by area, each a row; editing turns the row into its level, records and add-ons. */
function AccessRows({ cat, d, editing, fallback, onGrant }: AccessPanelProps) {
  return (
    <>
      {AREAS.map(([area, areaLabel]) => {
        const mods = cat.modules.filter((m) => m.area === area);
        if (!mods.length) return null;
        return (
          <section key={area} className="mb-3">
            <h3 data-ui="title" className="mb-1 text-xs font-strong tracking-caps text-subtle-foreground uppercase">
              {areaLabel}
            </h3>
            <div className="overflow-hidden rounded-card border border-border">
              {mods.map((m) => (
                <AccessRow key={m.key} mod={m} g={d.grants[m.key]} editing={editing} onChange={(g) => onGrant(m.key, g)} fallback={fallback} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function AccessRow({ mod, g, editing, onChange, fallback }: { mod: Module; g: RoleGrant; editing: boolean; onChange: (g: RoleGrant) => void; fallback: Scope }) {
  const on = g.actions.length > 0;
  const lv = levelOf(g);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-border px-3 py-2 last:border-b-0", !on && !editing && "bg-muted")}>
      <span data-copy="content" className={cn("w-36 flex-none text-sm font-semibold", !on && "text-muted-foreground")}>
        {mod.label}
      </span>
      {editing ? (
        <>
          <ChoiceField label={`${mod.label} Level`} value={lv == null ? "custom" : String(lv)} onChange={(v) => onChange(atLevel(g, Number(v) as Level, mod, fallback))} options={LEVELS.map((l, i) => [String(i), l] as [string, string])} />
          {on && !mod.own_only && <ChoiceField label={`${mod.label} Records`} value={g.scope} onChange={(v) => onChange({ ...g, scope: v })} options={SCOPES} />}
          {on && mod.own_only && <Sub>Own Records</Sub>}
          <span className="flex gap-3">
            <CheckboxField label="Approve" value={has(g, "approve")} disabled={!on} onChange={() => onChange(toggled(g, "approve"))} />
            <CheckboxField label="Export" value={has(g, "export")} disabled={!on} onChange={() => onChange(toggled(g, "export"))} />
          </span>
          {lv == null && <Sub className="w-full">Custom: {coreOf(g).map((a) => ACTION_WORD[a]).join(", ")}</Sub>}
        </>
      ) : (
        <>
          <LevelMeter value={rankOf(g)} label={levelWord(g)} decorative />
          <span className={cn("min-w-0 flex-1 text-sm", !on && "text-muted-foreground")}>
            {levelWord(g)}
            {on && <span className="text-subtle-foreground"> · {SCOPE_WORD[scopeOf(g, mod)]}</span>}
          </span>
          {has(g, "approve") && <Pill dot={false}>Approve</Pill>}
          {has(g, "export") && <Pill dot={false}>Export</Pill>}
        </>
      )}
    </div>
  );
}

/** Phone: the modules grouped by level, as chips; while editing a chip opens its sheet. */
function AccessByLevel({ cat, d, editing, sheet, onSheet }: AccessPanelProps) {
  const groups: Array<{ key: string; title: string; value: number; mods: Module[] }> = [];
  const bucket = (m: Module) => {
    const lv = levelOf(d.grants[m.key]);
    return lv == null ? "custom" : String(lv);
  };
  for (const lv of [4, 3, 2, 1] as Level[]) groups.push({ key: String(lv), title: LEVELS[lv], value: lv, mods: cat.modules.filter((m) => bucket(m) === String(lv)) });
  groups.push({ key: "custom", title: "Custom", value: 2, mods: cat.modules.filter((m) => bucket(m) === "custom") });
  groups.push({ key: "0", title: "No Access", value: 0, mods: cat.modules.filter((m) => bucket(m) === "0") });
  return (
    <>
      <p className="mb-2 text-2xs text-subtle-foreground">{KEY}</p>
      {groups
        .filter((grp) => grp.mods.length)
        .map((grp) => (
          <section key={grp.key} className="mb-3 rounded-card border border-border p-3">
            <h3 data-ui="title" className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <LevelMeter value={grp.value} label={grp.title} decorative />
              {grp.title}
              <CountBadge count={grp.mods.length} tone="neutral" label="modules" />
            </h3>
            <div className="flex flex-wrap gap-2">
              {grp.mods.map((m) => {
                const g = d.grants[m.key];
                const letters = lettersOf(g, m);
                return (
                  <ItemChip
                    key={m.key}
                    selected={sheet === m.key}
                    muted={!g.actions.length}
                    onSelect={editing ? () => onSheet(m.key) : undefined}
                    label={`${m.label}, ${grantWords(g, m)}`}
                    marks={
                      letters ? (
                        <HelpTerm title={m.label} help={letters.help}>
                          {letters.text}
                        </HelpTerm>
                      ) : undefined
                    }
                  >
                    {m.label}
                  </ItemChip>
                );
              })}
            </div>
          </section>
        ))}
    </>
  );
}

/** Phone: one module's access, moved to another level, its records and add-ons. Changes apply to the role being edited at once. */
function ModuleSheet({ mod, g, roleName, fallback, onGrant, onClose }: { mod: Module; g: RoleGrant; roleName: string; fallback: Scope; onGrant: (g: RoleGrant) => void; onClose: () => void }) {
  const on = g.actions.length > 0;
  const lv = levelOf(g);
  return (
    <Modal
      open
      onClose={onClose}
      title={mod.label}
      sub={roleName}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <Field label="Level">
        <RadioCards
          value={lv == null ? null : String(lv)}
          onChange={(v) => onGrant(atLevel(g, Number(v) as Level, mod, fallback))}
          options={[4, 3, 2, 1, 0].map((i) => ({ value: String(i), label: LEVELS[i], leading: <LevelMeter value={i} label={LEVELS[i]} decorative /> }))}
        />
      </Field>
      {on && !mod.own_only && (
        <Field label={<HelpTerm help={SCOPE_HELP}>Records</HelpTerm>}>
          <ChoiceField value={g.scope} onChange={(v) => onGrant({ ...g, scope: v })} options={SCOPES} />
        </Field>
      )}
      {on && mod.own_only && <Sub className="mb-3">Own Records</Sub>}
      <div className="flex flex-col gap-1">
        <CheckboxField label="Approve" value={has(g, "approve")} disabled={!on} onChange={() => onGrant(toggled(g, "approve"))} />
        <CheckboxField label="Export" value={has(g, "export")} disabled={!on} onChange={() => onGrant(toggled(g, "export"))} />
      </div>
    </Modal>
  );
}

/* ───────────── Details ───────────── */

function DetailsPanel({ cat, d, editing, nameError, onName, onDraft }: { cat: AccessCatalogue; d: Draft; editing: boolean; nameError: string | null; onName: (name: string) => void; onDraft: (d: Draft) => void }) {
  const flip = (list: string[], key: string, on: boolean) => (on ? [...list, key] : list.filter((k) => k !== key));
  const home = HOMES.find(([v]) => v === d.home)?.[1];
  return (
    <>
      {editing ? (
        <>
          <Field label="Role Name" state={nameError ? "bad" : undefined} message={nameError ?? undefined}>
            <TextField value={d.name} onChange={onName} disabled={d.is_system} placeholder="Studio Lead" maxLength={40} />
          </Field>
          <Field label="What It Is For" optional>
            <TextField value={d.description} onChange={(description) => onDraft({ ...d, description })} placeholder="Runs the studio" maxLength={200} />
          </Field>
          <Field label="Home">
            <ChoiceField value={d.home} onChange={(v) => onDraft({ ...d, home: v })} options={HOMES} />
          </Field>
        </>
      ) : (
        <KeyValue
          className="mb-4"
          items={[
            ["What It Is For", d.description || null],
            ["Home", home],
          ]}
        />
      )}
      <h3 data-ui="title" className="mt-2 mb-1 text-xs font-strong tracking-caps text-subtle-foreground uppercase">
        Sensitive Fields
      </h3>
      <div className="mb-4 overflow-hidden rounded-card border border-border">
        {cat.fields.map((f) => {
          const on = d.fields.includes(f.key);
          return (
            <div key={f.key} className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
              {editing ? (
                <CheckboxField label={f.label} value={on} onChange={(v) => onDraft({ ...d, fields: flip(d.fields, f.key, v) })} />
              ) : (
                <>
                  <span className="text-sm font-semibold">{f.label}</span>
                  <Pill tone={on ? "ok" : "neutral"}>{on ? "Visible" : "Masked"}</Pill>
                </>
              )}
            </div>
          );
        })}
      </div>
      <h3 data-ui="title" className="mb-1 text-xs font-strong tracking-caps text-subtle-foreground uppercase">
        Capabilities
      </h3>
      <div className="overflow-hidden rounded-card border border-border">
        {cat.capabilities.map((c) => {
          const on = d.caps.includes(c.code);
          return (
            <div key={c.code} className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
              {editing ? (
                <CheckboxField label={c.name} value={on} onChange={(v) => onDraft({ ...d, caps: flip(d.caps, c.code, v) })} />
              ) : (
                <>
                  <span className="text-sm font-semibold">{c.description ? <HelpTerm help={c.description}>{c.name}</HelpTerm> : c.name}</span>
                  <Pill tone={on ? "ok" : "neutral"}>{on ? "Held" : "Not Held"}</Pill>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ───────────── People ───────────── */

const USER_STATUS: Record<UserRow["status"], { tone: "ok" | "warn" | "err" | "neutral"; text: string }> = {
  active: { tone: "ok", text: "Active" },
  invited: { tone: "warn", text: "Invited" },
  suspended: { tone: "err", text: "Suspended" },
  left: { tone: "neutral", text: "Left" },
};

/** Who holds the role, 25 a page; a person opens their login on Settings · Users, where roles are given. */
function PeoplePanel({ code }: { code: string }) {
  const { navigate } = useRouter();
  const list = usePaged("GET /api/v1/users", { filters: { role: code } });
  const photo = usePhotos(list.rows.map((u) => u.photo_url));
  return (
    <DataView
      bare
      list={list}
      rowKey={(u) => u.user_id}
      noun="person"
      nounPlural="people"
      onRowClick={(u: UserRow) => navigate(hrefFor("settings", "users", { id: u.user_id }))}
      empty={{ title: "Nobody Holds It", text: "Roles are given on Users." }}
      columns={[
        { key: "u", label: "Person", render: (u) => <Who name={u.display_name} sub={u.email} src={photo(u.photo_url)} /> },
        { key: "s", label: "Status", render: (u) => <Pill tone={USER_STATUS[u.status].tone}>{USER_STATUS[u.status].text}</Pill> },
      ]}
    />
  );
}

/* ───────────── New Role, step 1 ───────────── */

/** Step 1 of New Role: its name and the role it starts from. The role then opens in place, editing. */
function NewRoleStep({ close, onNext }: { close: () => void; onNext: (name: string, from: string | null) => Promise<void> }) {
  const roles = usePaged("GET /api/v1/access/roles");
  const taken = new Set(roles.rows.map((r) => r.name.trim().toLowerCase()));
  const f = useContractForm({ name: "" }, { name: (v) => (String(v ?? "").trim().length < 2 ? "At least 2 characters" : taken.has(String(v).trim().toLowerCase()) ? "Name already used" : null) });
  const [from, setFrom] = useState<RoleOption[]>([]);
  const [busy, setBusy] = useState(false);
  const next = async () => {
    if (!f.check()) return;
    setBusy(true);
    try {
      await onNext(f.values.name.trim(), from[0]?.role_id ?? null);
      close();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not open the role");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <StepBar steps={STEPS} at={0} titled className="mb-3" />
      <Field label="Role Name" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Studio Lead" maxLength={40} />
      </Field>
      <Field label="Start From" optional>
        <RecordPicker list={roles} value={from} onChange={setFrom} id={(r) => r.role_id} title={(r) => r.name} sub={(r) => people(r.users)} placeholder="Line Manager" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => next()}>
          Next
        </Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Matrix ───────────── */

/** Every role against every module: a level meter, the short level and the letters, help on the letters. */
function MatrixView({ cat, onRole }: { cat?: AccessCatalogue; onRole: (id: string) => void }) {
  const matrix = useApi("GET /api/v1/settings/roles/matrix");
  const roles = matrix.data?.roles ?? [];
  const modOf = (key: string): Module => cat?.modules.find((m) => m.key === key) ?? { key: key as Module["key"], label: key, area: "", description: "", own_only: false };
  return (
    <DataView
      title="Permission Matrix"
      actions={<span className="text-2xs text-subtle-foreground">{KEY}</span>}
      rows={matrix.data?.rows ?? []}
      loading={matrix.loading}
      error={matrix.error}
      onReload={matrix.reload}
      rowKey={(r) => r.module_key}
      wide
      columns={[
        { key: "module", label: "Module", render: (r) => <b>{r.label}</b> },
        ...roles.map((role, i) => ({
          key: role.role_id,
          label: (
            <button type="button" onClick={() => onRole(role.role_id)} className="text-left whitespace-normal uppercase hover:text-foreground">
              {role.name}
            </button>
          ),
          render: (r: RoleMatrix["rows"][number]) => <MatrixCell mod={modOf(r.module_key)} cell={r.cells[i]} />,
        })),
      ]}
    />
  );
}

function MatrixCell({ mod, cell }: { mod: Module; cell?: RoleMatrix["rows"][number]["cells"][number] }) {
  const g: RoleGrant = { module_key: mod.key, actions: cell?.actions ?? [], scope: cell?.scope ?? "own" };
  const letters = lettersOf(g, mod);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <LevelMeter value={rankOf(g)} label={levelWord(g)} decorative />
      <span className={cn(!g.actions.length && "text-subtle-foreground")}>{levelWord(g)}</span>
      {letters && (
        <HelpTerm title={mod.label} help={letters.help}>
          {letters.text}
        </HelpTerm>
      )}
    </span>
  );
}

import { useEffect, useState } from "react";
import type { AccessCatalogue, RoleDetail, RoleGrant, RoleMatrix, RoleRow, RoleSave } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import {
  Banner,
  Button,
  ChoiceField,
  cn,
  DataView,
  DesktopOnly,
  ErrorState,
  Field,
  FormFooter,
  Grid,
  HelpTerm,
  LoadingRows,
  PageHeader,
  Pill,
  Switch,
  TextField,
  toast,
  useConfirm,
  useModal,
} from "@mycity/ui";

type Action = RoleGrant["actions"][number];
type Scope = RoleGrant["scope"];
type HomeView = NonNullable<RoleSave["home_view"]>;

const ACTION_LABEL: Record<Action, string> = { view: "View", create: "Create", edit: "Edit", delete: "Delete", approve: "Approve", export: "Export" };
const SCOPE_LABEL: Record<Scope, string> = { all: "All", team: "Team", own: "Own" };
const SCOPES: Array<[Scope, string]> = [["all", "All"], ["team", "Team"], ["own", "Own"]];
const HOMES: Array<[HomeView, string]> = [["staff", "Staff"], ["operations", "Operations"], ["partnerships", "Partnerships"]];
const AREAS: Array<[string, string]> = [["top", "Everyone"], ["work", "Work"], ["people", "People"], ["business", "Business"], ["system", "System"]];
const SCOPE_HELP = "All: every record. Team: the person's own and those of everyone who reports to them. Own: only their own.";

/** "View, Edit · Team" for a grant, as the matrix shows it. */
const cellText = (actions: Action[], scope: Scope | null) =>
  actions.length ? `${actions.map((a) => ACTION_LABEL[a]).join(", ")}${scope && scope !== "all" ? ` · ${SCOPE_LABEL[scope]}` : ""}` : "None";

/**
 * Settings · Roles & Permissions (MILESTONES §14, docs/guides/foundation.md §10):
 * the roles, the grants matrix, and each role's grants, field visibility and
 * capabilities, editable. Four layers: module, action, record scope, field. The
 * API enforces every layer; a change reaches the next request.
 */
export function Roles() {
  const { can } = useAuth();
  const modal = useModal();
  const [params, setParams] = useSearchParams();
  const canCreate = can("settings", "create");
  const canEdit = can("settings", "edit");
  const list = usePaged("GET /api/v1/settings/roles");
  const matrix = useApi("GET /api/v1/settings/roles/matrix");
  const open = (roleId: string | null, title: string) =>
    modal.open({ title, wide: true, full: true, body: (close) => <RoleEditor roleId={roleId} canEdit={roleId ? canEdit : canCreate} close={close} />, onClose: () => setParams({ new: null }) });
  const newRole = () => open(null, "New Role");
  useScreenAction(canCreate ? { label: "New Role", onSelect: newRole } : null);
  // The assistant's "create a role" opens this screen with ?new=1.
  useEffect(() => {
    if (params.get("new") === "1" && canCreate) newRole();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival
  }, [params.get("new"), canCreate]);

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        sub="Module, action, record scope and field"
        actions={
          canCreate ? (
            <DesktopOnly>
              <Button variant="primary" icon="plus" onClick={newRole}>
                New Role
              </Button>
            </DesktopOnly>
          ) : undefined
        }
      />
      <DataView
        title="Roles"
        list={list}
        search="Search Roles"
        rowKey={(r) => r.role_id}
        noun="role"
        onRowClick={(r: RoleRow) => open(r.role_id, r.name)}
        columns={[
          {
            key: "name",
            label: "Role",
            sortable: true,
            render: (r) => (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <b>{r.name}</b>
                {!r.is_system && <Pill tone="info">Custom</Pill>}
                {r.two_step_required && <Pill tone="ok">Two-Step</Pill>}
              </span>
            ),
          },
          { key: "users", label: "People", align: "n", render: (r) => r.users },
          { key: "modules", label: "Modules", align: "n", render: (r) => r.modules },
          { key: "scope", label: <HelpTerm help={SCOPE_HELP}>Record Scope</HelpTerm>, desktop: true, render: (r) => (r.scope === "none" ? "None" : SCOPE_LABEL[r.scope]) },
          { key: "fields", label: "Sensitive Fields", render: (r) => `${r.fields_visible} of 4` },
        ]}
      />
      <DesktopOnly>
        <Matrix matrix={matrix.data} loading={matrix.loading} error={matrix.error} onReload={matrix.reload} onRole={(id, name) => open(id, name)} />
      </DesktopOnly>
    </>
  );
}

function Matrix({ matrix, loading, error, onReload, onRole }: { matrix?: RoleMatrix; loading: boolean; error: ApiError | null; onReload: () => void; onRole: (id: string, name: string) => void }) {
  const roles = matrix?.roles ?? [];
  return (
    <DataView
      className="mt-3"
      title="Permission Matrix"
      rows={matrix?.rows ?? []}
      loading={loading}
      error={error}
      onReload={onReload}
      rowKey={(r) => r.module_key}
      wide
      columns={[
        { key: "module", label: "Module", render: (r) => <b>{r.label}</b> },
        ...roles.map((role, i) => ({
          key: role.role_id,
          label: (
            <Button size="sm" variant="ghost" onClick={() => onRole(role.role_id, role.name)}>
              {role.name}
            </Button>
          ),
          render: (r: RoleMatrix["rows"][number]) => <span className={cn(!r.cells[i]?.actions.length && "text-subtle-foreground")}>{cellText(r.cells[i]?.actions ?? [], r.cells[i]?.scope ?? null)}</span>,
        })),
      ]}
    />
  );
}

/* ───────────── The role editor ───────────── */

function RoleEditor({ roleId, canEdit, close }: { roleId: string | null; canEdit: boolean; close: () => void }) {
  const cat = useApi("GET /api/v1/settings/roles/catalogue");
  const role = useApi("GET /api/v1/settings/roles/:id", { params: { id: roleId ?? "" }, enabled: !!roleId });
  if (cat.error) return <ErrorState error={cat.error} onRetry={cat.reload} />;
  if (roleId && role.error) return <ErrorState error={role.error} onRetry={role.reload} />;
  if (!cat.data || (roleId && !role.data)) return <LoadingRows count={8} />;
  return <RoleForm cat={cat.data} role={roleId ? role.data! : null} canEdit={canEdit} close={close} />;
}

function RoleForm({ cat, role, canEdit, close }: { cat: AccessCatalogue; role: RoleDetail | null; canEdit: boolean; close: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const readOnly = !canEdit;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [home, setHome] = useState<HomeView>(() => HOMES.find(([v]) => v === role?.home_view)?.[0] ?? "staff");
  const [grants, setGrants] = useState<Record<string, RoleGrant>>(() =>
    Object.fromEntries(cat.modules.map((m) => [m.key, role?.grants.find((g) => g.module_key === m.key) ?? { module_key: m.key, actions: [], scope: "own" }])),
  );
  const [fields, setFields] = useState<string[]>(role?.visible_fields ?? []);
  const [caps, setCaps] = useState<string[]>(role?.capabilities ?? []);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [tried, setTried] = useState(false);
  const create = useMutation("POST /api/v1/settings/roles");
  const update = useMutation("PUT /api/v1/settings/roles/:id");
  const remove = useMutation("DELETE /api/v1/settings/roles/:id");

  const toggle = (mod: string, act: Action) =>
    setGrants((all) => {
      const g = all[mod];
      const has = g.actions.includes(act);
      const actions: Action[] = act === "view" ? (has ? [] : ["view"]) : has ? g.actions.filter((a) => a !== act) : [...new Set<Action>(["view", ...g.actions, act])];
      return { ...all, [mod]: { ...g, actions } };
    });
  const granted = Object.values(grants).filter((g) => g.actions.includes("view")).length;
  const nameBad = name.trim().length < 2 ? "At least 2 characters" : null;

  const save = async () => {
    setTried(true);
    if (nameBad || !granted) return;
    const body: RoleSave = {
      name: name.trim(),
      description: description.trim() || null,
      home_view: home,
      grants: Object.values(grants).filter((g) => g.actions.length),
      visible_fields: fields as RoleSave["visible_fields"],
      capabilities: caps,
    };
    try {
      const r = role ? await update.run({ params: { id: role.role_id }, body }) : await create.run({ body });
      invalidate("/api/v1/settings/roles");
      invalidate("/api/v1/access/roles");
      close();
      toast(role ? `${r.name} saved` : `${r.name} created`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Could not save the role");
    }
  };
  const del = async () => {
    if (!role || !(await confirm({ title: "Delete Role", body: `${role.name} goes for good.`, confirmLabel: "Delete Role", destructive: true }))) return;
    try {
      await remove.run({ params: { id: role.role_id } });
      invalidate("/api/v1/settings/roles");
      invalidate("/api/v1/access/roles");
      close();
      toast(`${role.name} deleted`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not delete the role");
    }
  };

  return (
    <>
      {readOnly && <Banner tone="info" icon="lock">View only</Banner>}
      <Grid cols={2}>
        <Field label="Role Name" state={(tried && nameBad) || errors.name ? "bad" : undefined} message={errors.name?.[0] ?? nameBad ?? undefined}>
          <TextField value={name} onChange={(v) => (setName(v), setErrors((x) => ({ ...x, name: [] })))} disabled={readOnly || role?.is_system} placeholder="Studio Lead" maxLength={40} />
        </Field>
        <Field label="What It Is For" optional>
          <TextField value={description} onChange={setDescription} disabled={readOnly} placeholder="Runs the studio" maxLength={200} />
        </Field>
      </Grid>
      <Field label="Home">
        <ChoiceField value={home} onChange={(v) => setHome(v)} options={HOMES} disabled={readOnly ? HOMES.map(([v]) => v) : []} />
      </Field>
      {role && <p className="-mt-1 mb-3 text-2xs text-subtle-foreground">{role.users === 1 ? "1 person holds this role" : `${role.users} people hold this role`}</p>}

      {AREAS.map(([area, areaLabel]) => {
        const mods = cat.modules.filter((m) => m.area === area);
        if (!mods.length) return null;
        return (
          <section key={area} className="mb-3">
            <h3 data-ui="title" className="mb-1 text-xs font-strong tracking-caps text-subtle-foreground uppercase">
              {areaLabel}
            </h3>
            <div className="overflow-hidden rounded-card border border-border">
              {mods.map((m) => {
                const g = grants[m.key];
                const on = g.actions.includes("view");
                return (
                  <div key={m.key} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2.5 last:border-b-0", !on && "bg-muted/40")}>
                    <b className={cn("w-44 flex-none text-xs font-semibold max-md:w-full", !on && "text-muted-foreground")}>{m.label}</b>
                    <div className="flex min-w-0 flex-1 flex-wrap gap-1.5" role="group" aria-label={`${m.label} actions`}>
                      {cat.actions.map((a) => {
                        const pressed = g.actions.includes(a);
                        return (
                          <button
                            key={a}
                            type="button"
                            aria-pressed={pressed}
                            disabled={readOnly}
                            onClick={() => toggle(m.key, a)}
                            className={cn(
                              "h-7 rounded-full border px-2.5 text-2xs font-semibold transition-colors disabled:cursor-default max-md:h-11 max-md:px-3.5",
                              pressed ? "border-secondary bg-secondary text-secondary-foreground" : "border-border bg-card text-muted-foreground enabled:hover:border-subtle-foreground enabled:hover:text-foreground",
                            )}
                          >
                            {ACTION_LABEL[a]}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex-none">
                      {!on ? (
                        <span className="text-2xs text-subtle-foreground">No access</span>
                      ) : m.own_only ? (
                        <Pill>Own records</Pill>
                      ) : readOnly ? (
                        <Pill>{SCOPE_LABEL[g.scope]} records</Pill>
                      ) : (
                        <ChoiceField label={`${m.label} records`} value={g.scope} onChange={(v) => setGrants((all) => ({ ...all, [m.key]: { ...all[m.key], scope: v } }))} options={SCOPES} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {(errors.grants?.[0] || (tried && !granted)) && <p role="alert" className="mb-2 text-xs text-destructive">{errors.grants?.[0] ?? "Grant at least one module"}</p>}

      <Grid cols={2}>
        <section>
          <h3 data-ui="title" className="mb-1 text-xs font-strong tracking-caps text-subtle-foreground uppercase">
            Sensitive Fields
          </h3>
          <div className="overflow-hidden rounded-card border border-border">
            {cat.fields.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
                <span className="text-xs font-semibold">{f.label}</span>
                <Switch checked={fields.includes(f.key)} disabled={readOnly} label={`${f.label} visible`} onChange={(v) => setFields((x) => (v ? [...x, f.key] : x.filter((k) => k !== f.key)))} />
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3 data-ui="title" className="mb-1 text-xs font-strong tracking-caps text-subtle-foreground uppercase">
            Capabilities
          </h3>
          <div className="overflow-hidden rounded-card border border-border">
            {cat.capabilities.map((c) => (
              <div key={c.code} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
                <span className="text-xs font-semibold">{c.description ? <HelpTerm help={c.description}>{c.name}</HelpTerm> : c.name}</span>
                <Switch checked={caps.includes(c.code)} disabled={readOnly} label={`${c.name} held`} onChange={(v) => setCaps((x) => (v ? [...x, c.code] : x.filter((k) => k !== c.code)))} />
              </div>
            ))}
          </div>
        </section>
      </Grid>

      <FormFooter>
        {role && !role.is_system && can("settings", "delete") && (
          <Button className="mr-auto" variant="danger" busy={remove.pending} onClick={() => void del()}>
            Delete Role
          </Button>
        )}
        <Button onClick={close}>{readOnly ? "Close" : "Cancel"}</Button>
        {!readOnly && (
          <Button variant="primary" busy={create.pending || update.pending} onClick={() => void save()}>
            {role ? "Save Role" : "Create Role"}
          </Button>
        )}
      </FormFooter>
    </>
  );
}

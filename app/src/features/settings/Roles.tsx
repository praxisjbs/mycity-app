import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/settings";
import type { AccessCatalogue, RecordScope, Role, RoleAction, RoleBody, RoleDetail, RoleGrant } from "@/api/types/settings";
import { useMe } from "@/auth/AuthProvider";
import { Button, cn } from "@mycity/ui";
import { Banner, Pill } from "@/components/ui/data";
import { Card, CardHeader, Grid, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { ErrorBlock, LoadingRows, Table } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { KvCard, ModalFoot, PagedTable } from "@/features/shared/sections";
import { Field, Input, Seg, Switch } from "@/components/form";

const ACTIONS: Array<[RoleAction, string]> = [["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"], ["approve", "Approve"], ["export", "Export"]];
const SCOPES: Array<[RecordScope, string]> = [["all", "All"], ["team", "Team"], ["own", "Own"]];

/** The role names a user can be given, from the roles the API holds (not a fixed list). */
export function useRoleOptions(): Array<[string, string]> {
  const list = usePaged("GET /api/v1/settings/roles");
  return list.rows.map((r) => [r.name, r.name]);
}

/**
 * Settings · Roles & Permissions (MILESTONES §14). Four layers: module, action,
 * record scope, field. There is no entity layer: one company (A2). A custom
 * role is created here, granted modules and actions with a scope, and its
 * holders see exactly that. The API enforces every layer.
 */
export function Roles() {
  const modal = useModal();
  const me = useMe();
  const canManage = !!me.grants.settings?.includes("edit");
  const list = usePaged("GET /api/v1/settings/roles");
  const m = useApi("GET /api/v1/settings/roles/matrix");
  const open = (r: Role | null) =>
    modal.open({ title: r ? r.name : "New Role", wide: true, full: true, body: (close) => <RoleEditor roleId={r?.role_id ?? null} canManage={canManage} close={close} /> });
  return (
    <>
      <PageHead
        title="Roles & Permissions"
        sub="Four layers: module, action, record scope, field"
        actions={canManage ? <Button variant="primary" icon="plus" onClick={() => open(null)}>New Role</Button> : undefined}
      />
      <PagedTable<Role>
        title="Roles"
        list={list}
        rowKey={(r) => r.role_id}
        noun="role"
        onRowClick={open}
        columns={[
          { key: "n", label: "Role", render: (r) => <span className="inline-flex items-center gap-1.5"><b>{r.name}</b>{!r.system && <Pill tone="info">Custom</Pill>}</span> },
          { key: "u", label: "Users", align: "n", render: (r) => r.users },
          { key: "m", label: "Modules", align: "n", render: (r) => r.modules },
          { key: "s", label: "Record Scope", render: (r) => r.scope, desktop: true },
          { key: "f", label: "Sensitive Fields", render: (r) => <Pill tone={r.sensitive === "Masked" ? "neutral" : "info"}>{r.sensitive}</Pill> },
        ]}
      />
      <div className="mt-3">
        <Table
          title="Permission Matrix"
          rows={m.data?.rows ?? []}
          rowKey={(r) => r.module}
          loading={m.loading}
          error={m.error}
          wide
          columns={[{ key: "m", label: "Module", render: (r) => <b>{r.module}</b> }, ...(m.data?.roles ?? []).map((role, i) => ({ key: role, label: role, render: (r: { cells: string[] }) => <span className={cn(r.cells[i] === "None" && "text-subtle-foreground")}>{r.cells[i]}</span> }))]}
        />
      </div>
      <Grid cols={2} className="mt-3">
        <Card>
          <CardHeader title="The Four Layers" />
          {[["Module", "Can they see Payroll at all"], ["Action", "View, create, edit, delete, approve, export"], ["Record scope", "All records, their team’s, or only their own"], ["Field", "Salary, bank details and query history masked unless granted"]].map(([t, x], i) => (
            <div key={t} className="flex items-start gap-[11px] border-b border-border py-2 last:border-b-0">
              <b className="w-[18px] flex-none text-[12px] text-accent-foreground">{i + 1}</b>
              <span className="min-w-0 flex-1"><div className="text-[12.5px] font-semibold">{t}</div><div className="text-[11.5px] text-subtle-foreground">{x}</div></span>
              <Pill tone="ok">In use</Pill>
            </div>
          ))}
          <p className="mt-[11px] text-[11.5px] text-subtle-foreground">Every layer is enforced by the API. The screens hide what you cannot use, but hiding is not the control. There is no entity layer: MyCity is one company.</p>
        </Card>
        <KvCard
          title="Field Security in Practice"
          items={[
            ["Who sees salary", "CEO, Operations, Finance. Nobody else"],
            ["A Manager viewing their team", "Sees the person, the KPIs, the attendance. Not the pay"],
            ["Masked, not absent", "The field is replaced, so the screen does not change shape"],
            ["Praxis AI", "Inherits the same mask. It cannot read what you cannot"],
            ["Reports", "Generated as the recipient, so a report cannot leak a field"],
            ["Audit", "A masked field read is still logged"],
          ]}
        />
      </Grid>
    </>
  );
}

function RoleEditor({ roleId, canManage, close }: { roleId: string | null; canManage: boolean; close: () => void }) {
  const cat = useApi("GET /api/v1/settings/roles/catalogue");
  const role = useApi("GET /api/v1/settings/roles/:id", { params: { id: roleId ?? "" }, enabled: !!roleId });
  if (cat.error) return <ErrorBlock error={cat.error} />;
  if (roleId && role.error) return <ErrorBlock error={role.error} />;
  if (!cat.data || (roleId && !role.data)) return <LoadingRows count={8} />;
  return <RoleForm cat={cat.data} role={roleId ? role.data! : null} canManage={canManage} close={close} />;
}

function RoleForm({ cat, role, canManage, close }: { cat: AccessCatalogue; role: RoleDetail | null; canManage: boolean; close: () => void }) {
  const readOnly = !canManage || !!role?.locked;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [grants, setGrants] = useState<Record<string, RoleGrant>>(() =>
    Object.fromEntries(cat.modules.map((m) => [m.key, role?.grants.find((x) => x.module === m.key) ?? { module: m.key, actions: [], scope: "own" as RecordScope }])),
  );
  const [fields, setFields] = useState<string[]>(role?.visible_fields ?? []);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const create = useMutation("POST /api/v1/settings/roles");
  const update = useMutation("PUT /api/v1/settings/roles/:id");
  const remove = useMutation("DELETE /api/v1/settings/roles/:id");
  const busy = create.pending || update.pending || remove.pending;

  const toggle = (mod: string, act: RoleAction) =>
    setGrants((all) => {
      const g = all[mod];
      const has = g.actions.includes(act);
      let actions: RoleAction[];
      if (act === "view") actions = has ? [] : ["view"];
      else actions = has ? g.actions.filter((a) => a !== act) : [...new Set<RoleAction>(["view", ...g.actions, act])];
      return { ...all, [mod]: { ...g, actions } };
    });
  const setScope = (mod: string, scope: RecordScope) => setGrants((all) => ({ ...all, [mod]: { ...all[mod], scope } }));
  const granted = Object.values(grants).filter((g) => g.actions.includes("view")).length;
  const nameBad = name.trim().length > 0 && (name.trim().length < 2 || name.trim().length > 40);

  const save = async () => {
    const body: RoleBody = { name: name.trim(), description: description.trim(), grants: Object.values(grants).filter((g) => g.actions.length), visible_fields: fields };
    try {
      const r = role ? await update.run({ params: { id: role.role_id }, body }) : await create.run({ body });
      invalidate("/api/v1/settings/roles");
      invalidate("/api/v1/settings/users");
      close();
      toast(role ? `${r.name} saved. Its holders get the change at their next request` : `${r.name} created. Give it to a user from Users`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Could not save the role");
    }
  };
  const del = async () => {
    try {
      await remove.run({ params: { id: role!.role_id } });
      invalidate("/api/v1/settings/roles");
      close();
      toast(`${role!.name} deleted`);
    } catch (e) {
      setConfirmDelete(false);
      toast(e instanceof ApiError ? e.message : "Could not delete the role");
    }
  };

  return (
    <>
      {role?.locked && <Banner tone="info" icon="lock">The CEO role holds every permission and cannot be changed.</Banner>}
      {!canManage && !role?.locked && <Banner tone="info" icon="lock">Operations and the CEO change roles. You can see this one.</Banner>}
      <Grid cols={2}>
        <Field label="Role Name" state={errors.name || nameBad ? "bad" : undefined} message={errors.name?.[0] ?? (nameBad ? "Between 2 and 40 characters" : role?.system && !readOnly ? "A built-in role keeps its name" : undefined)}>
          <Input value={name} onChange={(v) => (setName(v), setErrors((x) => ({ ...x, name: [] })))} disabled={readOnly || role?.system} placeholder="e.g. Studio Lead" maxLength={40} />
        </Field>
        <Field label="What It Is For">
          <Input value={description} onChange={setDescription} disabled={readOnly} placeholder="Runs payroll" maxLength={140} />
        </Field>
      </Grid>
      {role && <p className="-mt-1.5 mb-3 text-[11.5px] text-subtle-foreground">{role.users} {role.users === 1 ? "user holds" : "users hold"} this role.</p>}

      <h4 className="mb-1 text-[12px] font-[650] tracking-[.06em] text-subtle-foreground uppercase">Modules, Actions and Record Scope</h4>
      <p className="mb-2 text-[11.5px] text-subtle-foreground">Every other action needs View. Record scope limits which records the actions reach.</p>
      {errors.grants?.[0] && <p className="mb-2 text-[11.5px] text-destructive">{errors.grants[0]}</p>}
      <div className="mb-4 overflow-hidden rounded-card border border-border">
        {cat.modules.map((m) => {
          const g = grants[m.key];
          const on = g.actions.includes("view");
          return (
            <div key={m.key} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2.5 last:border-b-0", !on && "bg-muted/40")}>
              <b className={cn("w-[170px] flex-none text-[12.5px] font-semibold max-md:w-full", !on && "text-muted-foreground")}>{m.label}</b>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5" role="group" aria-label={`${m.label} actions`}>
                {ACTIONS.filter(([a]) => m.actions.includes(a)).map(([a, l]) => {
                  const pressed = g.actions.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={pressed}
                      disabled={readOnly}
                      onClick={() => toggle(m.key, a)}
                      className={cn(
                        "h-7 rounded-full border px-2.5 text-[11.5px] font-semibold transition-colors disabled:cursor-default",
                        pressed ? "border-secondary bg-secondary text-secondary-foreground" : "border-border bg-card text-muted-foreground enabled:hover:border-subtle-foreground enabled:hover:text-foreground",
                      )}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
              <div className="flex-none">
                {!on ? (
                  <span className="text-[11.5px] text-subtle-foreground">No access</span>
                ) : m.scoped ? (
                  readOnly ? <Pill>{SCOPES.find(([v]) => v === g.scope)![1]} records</Pill> : <Seg value={g.scope} onChange={(v) => setScope(m.key, v)} options={SCOPES} />
                ) : (
                  <span className="text-[11.5px] text-subtle-foreground">Not record scoped</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <h4 className="mb-1 text-[12px] font-[650] tracking-[.06em] text-subtle-foreground uppercase">Sensitive Fields</h4>
      <p className="mb-2 text-[11.5px] text-subtle-foreground">Masked unless switched on. A masked field shows as hidden, so the screen keeps its shape.</p>
      <div className="mb-1 overflow-hidden rounded-card border border-border">
        {cat.fields.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
            <span className="min-w-0">
              <div className="text-[12.5px] font-semibold">{f.label}</div>
              <div className="text-[11.5px] text-subtle-foreground">{f.help}</div>
            </span>
            <Switch checked={fields.includes(f.key)} disabled={readOnly} label={`${f.label} visible`} onChange={(v) => setFields((x) => (v ? [...x, f.key] : x.filter((k) => k !== f.key)))} />
          </div>
        ))}
      </div>

      <ModalFoot>
        {role && !role.system && canManage && (confirmDelete ? (
          <Button className="mr-auto" variant="primary" disabled={busy} onClick={del}>Confirm Delete</Button>
        ) : (
          <Button className="mr-auto" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete Role</Button>
        ))}
        <Button onClick={close}>{readOnly ? "Close" : "Cancel"}</Button>
        {!readOnly && (
          <Button variant="primary" disabled={busy || name.trim().length < 2 || nameBad || !granted} onClick={save}>
            {role ? "Save Role" : "Create Role"}
          </Button>
        )}
      </ModalFoot>
    </>
  );
}

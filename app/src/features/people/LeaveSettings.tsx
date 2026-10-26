import { useState } from "react";
import type { LeaveBalance, LeaveType } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useMe } from "@/auth/AuthProvider";
import { EmployeePicker } from "@/features/shared/pickers";
import { Button, CheckboxField, DataView, Field, FormFooter, Grow, NumberField, Pager, Pill, rules, SegmentedControl, TapList, TextField, toast, todayIso, useConfirm, useContractForm, useModal } from "@mycity/ui";

/**
 * People · Leave settings (docs/guides/ess.md §6, §10): the leave types People offer
 * (add, change, retire, delete one nobody has used) and one person's allowance for a
 * year in place of the type's days. Every change is audited by the leave module.
 */

const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Not saved. Try again.");

/**
 * The code a type is stored under, from the name People type: "Study Leave" → "study_leave". A
 * name too short for a code of two characters (or not starting with a letter) gets `type_` before it.
 */
export const codeOf = (name: string) => {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z][a-z0-9_]/.test(slug) ? slug : `type_${slug}`.slice(0, 40);
};

const daysText = (n: number | null) => (n === null ? "No set allowance" : `${n} ${n === 1 ? "day" : "days"} a year`);

/** The leave types, with Add Type and each type's form. */
export function LeaveTypes() {
  const me = useMe();
  const modal = useModal();
  const list = usePaged("GET /api/v1/leave/types", { sort: "name" });
  const grants = me.grants.people ?? [];
  const open = (t: LeaveType | null) =>
    modal.open({ title: t ? t.name : "Add Leave Type", body: (close) => <TypeForm type={t} close={close} /> });
  return (
    <>
      {grants.includes("create") && (
        <div className="mb-3 flex">
          <Grow />
          <Button variant="primary" icon="plus" onClick={() => open(null)}>Add Type</Button>
        </div>
      )}
      <DataView
        title="Leave Types"
        rows={list.rows}
        rowKey={(t) => t.leave_type_id}
        loading={list.loading}
        error={list.error}
        onRowClick={grants.includes("edit") ? (t: LeaveType) => open(t) : undefined}
        empty={{ title: "No Leave Types", text: "Add the first type." }}
        columns={[
          { key: "n", label: "Type", render: (t) => t.name },
          { key: "d", label: "Allowance", render: (t) => daysText(t.days_per_year) },
          { key: "s", label: "Status", render: (t) => <Pill tone={t.active ? "ok" : "neutral"}>{t.active ? "Offered" : "Retired"}</Pill> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="type" />}
      />
    </>
  );
}

function TypeForm({ type, close }: { type: LeaveType | null; close: () => void }) {
  const me = useMe();
  const confirm = useConfirm();
  const f = useContractForm(
    { name: type?.name ?? "", days: type?.days_per_year === null || type?.days_per_year === undefined ? "" : String(type.days_per_year), active: type?.active ?? true },
    {
      name: (v) => rules.required("Name the type")(v) ?? (String(v).trim().length > 80 ? "At most 80 characters" : null),
      days: (v) => (v === "" || (Number(v) >= 0 && Number(v) <= 366) ? null : "0 to 366 days"),
    },
  );
  const add = useMutation("POST /api/v1/leave/types");
  const change = useMutation("PATCH /api/v1/leave/types/:id");
  const remove = useMutation("DELETE /api/v1/leave/types/:id");
  const days = f.values.days === "" ? null : Number(f.values.days);
  const done = (text: string) => {
    invalidate("/api/v1/leave/types");
    invalidate("/api/v1/ess/leave");
    close();
    toast(text);
  };
  const save = async () => {
    if (!f.check()) return;
    try {
      if (type) {
        await change.run({ params: { id: type.leave_type_id }, body: { name: f.values.name.trim(), days_per_year: days, active: f.values.active } });
        done(`${f.values.name.trim()} saved`);
      } else {
        await add.run({ body: { code: codeOf(f.values.name), name: f.values.name.trim(), days_per_year: days } });
        done(`${f.values.name.trim()} added`);
      }
    } catch (e) {
      // The code is made from the name, so its marks go on Name; only a duplicate reads Already a Type.
      if (e instanceof ApiError && e.fields.code) f.setServerErrors({ name: [e.code === "LEAVE_TYPE_EXISTS" ? "Already a type" : (e.fields.code[0] ?? "Check the name")] });
      else if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  const drop = async () => {
    if (!type || !(await confirm({ title: "Delete Type", body: `${type.name} is removed for good.`, confirmLabel: "Delete Type", destructive: true }))) return;
    try {
      await remove.run({ params: { id: type.leave_type_id } });
      done(`${type.name} deleted`);
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <Field label="Name" {...f.field("name")}>
        <TextField {...f.field("name")} placeholder="Study" />
      </Field>
      <Field label="Days a Year" optional info="Working days each person gets a year. Leave empty for a type with no limit, such as unpaid leave." {...f.field("days")}>
        <NumberField {...f.field("days")} placeholder="20" />
      </Field>
      {type && (
        <Field label="Offered" {...f.field("active")}>
          <CheckboxField {...f.field("active")} label="Offered on new requests" />
        </Field>
      )}
      <FormFooter>
        {type && (me.grants.people ?? []).includes("delete") && (
          <Button busy={remove.pending} onClick={drop}>Delete Type</Button>
        )}
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={add.pending || change.pending} onClick={save}>{type ? "Save Type" : "Add Type"}</Button>
      </FormFooter>
    </>
  );
}

/** One person's year: pick them, see each type, set an allowance. */
export function LeaveAllowances() {
  const me = useMe();
  const modal = useModal();
  const [who, setWho] = useState<PersonRef[]>([]);
  const thisYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(String(thisYear));
  const person = who[0] ?? null;
  const year_ = useApi("GET /api/v1/leave/balances", {
    query: { employee_id: person?.employee_id ?? "", year: Number(year) },
    enabled: Boolean(person),
  });
  const canEdit = (me.grants.people ?? []).includes("edit");
  const set = (b: LeaveBalance) =>
    person &&
    modal.open({
      title: `${b.name}, ${year}`,
      body: (close) => <AllowanceForm employeeId={person.employee_id} name={person.display_name} balance={b} year={Number(year)} close={close} onDone={year_.reload} />,
    });
  return (
    <>
      <Field label="Employee">
        <EmployeePicker value={who} onChange={setWho} />
      </Field>
      <SegmentedControl label="Year" value={year} onChange={setYear} options={[[String(thisYear), String(thisYear)], [String(thisYear + 1), String(thisYear + 1)]]} />
      {person && year_.data && (
        <div className="mt-3">
          <TapList
            items={year_.data.balances.map((b) => ({
              key: b.leave_type_id,
              title: b.name,
              sub: `${b.entitled === null ? "No set allowance" : `${b.entitled} entitled`}, ${b.taken} taken, ${b.booked} booked${b.remaining === null ? "" : `, ${b.remaining} left`}`,
              right: canEdit ? <Pill tone="neutral">Set</Pill> : undefined,
              onClick: canEdit ? () => set(b) : undefined,
            }))}
          />
        </div>
      )}
    </>
  );
}

function AllowanceForm({ employeeId, name, balance, year, close, onDone }: { employeeId: string; name: string; balance: LeaveBalance; year: number; close: () => void; onDone: () => void }) {
  const f = useContractForm({ days: balance.entitled === null ? "" : String(balance.entitled) }, { days: (v) => (v === "" || (Number(v) >= 0 && Number(v) <= 366) ? null : "0 to 366 days") });
  const save = useMutation("PUT /api/v1/leave/balances");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { employee_id: employeeId, leave_type_id: balance.leave_type_id, year, days: f.values.days === "" ? null : Number(f.values.days) } });
      invalidate("/api/v1/leave");
      onDone();
      close();
      toast(`Allowance saved for ${name}`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Days" optional info="Leave empty to use the type's usual allowance." {...f.field("days")}>
        <NumberField {...f.field("days")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Save Allowance</Button>
      </FormFooter>
    </>
  );
}

import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useMutation } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { Button, Field, FormFooter, toast } from "@mycity/ui";
import { LoginCandidatePicker, RolePicker, type RoleRef } from "./pickers";

/**
 * Give an employee a login (docs/guides/identity.md §10): pick them (or start
 * from their record) and their roles; they get an email with a link to choose
 * their own password. Settings · Users and People · Employees both open it.
 */
export function InviteToSignIn({ close, person }: { close: () => void; person?: PersonRef }) {
  const [who, setWho] = useState<PersonRef[]>(person ? [person] : []);
  const [roles, setRoles] = useState<RoleRef[]>([{ code: "employee", name: "Staff" }]);
  const [tried, setTried] = useState(false);
  const inv = useMutation("POST /api/v1/users");
  const send = async () => {
    setTried(true);
    if (!who.length || !roles.length) return;
    try {
      await inv.run({ body: { employee_id: who[0].employee_id, role_codes: roles.map((r) => r.code) } });
      invalidate("/api/v1/users", "/api/v1/employees");
      close();
      toast(`Invitation sent to ${who[0].display_name}`);
    } catch (e) {
      // A refusal on a field this form shows is marked there; any other is said in a toast, never lost.
      const shown = e instanceof ApiError && (e.fields.employee_id || e.fields.role_codes);
      if (!shown) toast(e instanceof ApiError ? e.message : "Something went wrong");
    }
  };
  return (
    <>
      <Field label="Employee" state={(tried && !who.length) || inv.fields.employee_id ? "bad" : undefined} message={inv.fields.employee_id?.[0] ?? "Pick the employee"}>
        <LoginCandidatePicker value={who} onChange={setWho} />
      </Field>
      <Field label="Roles" state={(tried && !roles.length) || inv.fields.role_codes ? "bad" : undefined} message={inv.fields.role_codes?.[0] ?? "Pick a role"}>
        <RolePicker value={roles} onChange={setRoles} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="send" busy={inv.pending} onClick={() => send()}>
          Send Invitation
        </Button>
      </FormFooter>
    </>
  );
}

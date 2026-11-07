import type { Contact } from "@mycity/contract/contract.gen.ts";
import partners from "@mycity/contract/schemas/partners.js";
import { invalidate, useMutation } from "@/api/hooks";
import { Button, CheckboxField, FormFooter, toast, useContractForm } from "@mycity/ui";
import { failed } from "../lib";
import { ContactPart, contactStart, type Bound } from "./parts";

/**
 * Add Contact and Edit Contact on a lead or a partner (docs/guides/partnerships.md §6.2): a person, their
 * position, email and numbers, and whether they sign. Add Contact is checked by ContactCreate, the
 * request Praxis AI's card sends; Edit Contact by ContactInput, an emptied field cleared.
 */
export function ContactForm({ record, contact, close }: { record: { type: "lead" | "partner"; id: string }; contact?: Contact; close: () => void }) {
  const add = useContractForm(
    { ...contactStart(), ...(record.type === "partner" ? { partner_id: record.id } : { lead_id: record.id }), signatory: false, primary_contact: false },
    partners.ContactCreate,
  );
  const edit = useContractForm(
    contact
      ? { first_name: contact.first_name, last_name: contact.last_name, job_title: contact.job_title ?? "", email: contact.email ?? "", phones: contact.phones, signatory: contact.signatory }
      : { ...contactStart(), signatory: false },
    partners.ContactInput,
  );
  const f = contact ? edit : add;
  const create = useMutation("POST /api/v1/partnerships/contacts");
  const update = useMutation("PATCH /api/v1/partnerships/contacts/:id");
  const save = async () => {
    if (!f.check()) return;
    try {
      if (contact) {
        const v = edit.values;
        await update.run({ params: { id: contact.partner_contact_id }, body: { first_name: v.first_name, last_name: v.last_name, job_title: v.job_title || null, email: v.email || null, phones: v.phones, signatory: v.signatory } });
        toast("Contact saved");
      } else {
        const { job_title, email, ...rest } = add.values;
        await create.run({ body: { ...rest, ...(job_title && { job_title }), ...(email && { email }) } as never });
        toast("Contact added");
      }
      invalidate("/api/v1/partnerships");
      close();
    } catch (e) {
      failed(f)(e);
    }
  };
  const x = f as unknown as { values: { signatory: boolean }; set: (k: "signatory", v: boolean) => void };
  return (
    <>
      <ContactPart f={f as unknown as Bound} />
      <CheckboxField value={x.values.signatory} onChange={(v: boolean) => x.set("signatory", v)} label="Signs Agreements" />
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>{contact ? "Save Contact" : "Add Contact"}</Button>
      </FormFooter>
    </>
  );
}

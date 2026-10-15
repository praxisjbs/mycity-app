import { useState } from "react";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import type { MyProfile, ProfilePatch } from "@/api/types/ess";
import "@/api/types/ess";
import { Button } from "@/components/ui/Button";
import { KV, Pill, Timeline } from "@/components/ui/data";
import { Field, FormRow, Input, rules, useForm } from "@/components/ui/form";
import { Icon } from "@/components/ui/Icon";
import { Card, CardHeader, DesktopOnly, Grid, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { ErrorBlock, LoadingRows } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { Upload } from "@/components/ui/Upload";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { formatDate, initials } from "@/lib/format";
import { hrefFor, useRouter } from "@/lib/router";

export function MyProfilePage() {
  const { data: p, error, reload } = useApi("GET /api/v1/ess/profile");
  const modal = useModal();
  const { navigate } = useRouter();
  if (error) return <ErrorBlock error={error} onRetry={reload} />;
  if (!p) return <LoadingRows count={8} />;
  const edit = () => modal.open({ title: "Edit My Details", body: (close) => <EditProfile p={p} close={close} /> });
  const photo = () => modal.open({ title: "Profile Photo", body: (close) => <PhotoForm close={close} /> });

  const personal = <Card><CardHeader title="Personal" /><KV items={[["Full name", p.personal.full_name], ["Date of birth", formatDate(p.personal.date_of_birth)], ["Phone", p.personal.phone], ["Work email", p.personal.work_email], ["Address", p.personal.address]]} /></Card>;
  const schedule = (
    <div className="mt-[14px] border-t border-border pt-3">
      <CardHeader title="Work Schedule" right={<Pill>Set by People</Pill>} className="mb-1" />
      {p.schedule.map((s) => (
        <div key={s.day} className="flex flex-wrap items-center gap-2.5 border-b border-border py-2 last:border-b-0">
          <b className="w-[84px] text-[12.5px]">{s.day}</b>
          <Pill tone={s.mode === "Office" ? "ok" : s.mode === "Off" ? "err" : "neutral"}>{s.mode}</Pill>
          <span className="ml-auto text-[11.5px] text-subtle-foreground">{s.mode === "Off" ? "Not working" : `${s.hours} · ${s.where}`}</span>
        </div>
      ))}
    </div>
  );
  const employment = (
    <Card>
      <CardHeader title="Employment" />
      <KV items={[["Job title", p.employment.job_title], ["Department", p.employment.department], ["Line manager", p.employment.line_manager], ["Start date", formatDate(p.employment.start_date)], ["Employment type", p.employment.employment_type], ["Work arrangement", p.employment.arrangement], ["Status", <Pill tone={p.employment.status.tone}>{p.employment.status.text}</Pill>]]} />
      {schedule}
    </Card>
  );
  const bank = <Card><CardHeader title="Bank, Used for Expense Disbursement" /><KV items={[["Bank", p.bank.bank_name], ["Account name", p.bank.account_name], ["Account number", `•••• ${p.bank.account_last4}`]]} /></Card>;
  const nok = <Card><CardHeader title="Next of Kin" /><KV items={[["Name", p.next_of_kin.name], ["Relationship", p.next_of_kin.relationship], ["Phone", p.next_of_kin.phone]]} /></Card>;
  const can = (
    <Card>
      <CardHeader title="What You Can Change" />
      {p.can_change.map((c) => (
        <div key={c.field} className="flex items-center gap-2.5 border-b border-border py-2">
          <span className="flex-1 text-[12.5px] font-[550]">{c.field}</span>
          <Pill tone={c.how.tone}>{c.how.text}</Pill>
        </div>
      ))}
      <p className="mt-[11px] text-[11.5px] text-subtle-foreground">Every change to this record is written to the audit log with who made it.</p>
    </Card>
  );
  const history = <Card><CardHeader title="My Record History" /><Timeline items={p.history} /></Card>;

  return (
    <>
      <PageHead title="My Profile" sub="What People see, and what you can change yourself" actions={<Button variant="primary" icon="plus" onClick={edit}>Edit</Button>} />
      <div className="mb-3 flex flex-wrap items-start gap-4 rounded-card border border-border bg-card p-4 shadow-1 max-md:p-[14px]">
        <button type="button" onClick={photo} title={p.photo_url ? "Change photo" : "Upload a photo"} className="relative flex size-[62px] flex-none items-center justify-center rounded-sheet bg-secondary text-[21px] font-bold tracking-[-.02em] text-secondary-foreground max-md:size-[52px] max-md:text-[18px]">
          {initials(p.display_name)}
          <span className="absolute -right-[7px] -bottom-[7px] flex size-[26px] items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-2">
            <Icon name="plus" className="size-[13px]" />
          </span>
        </button>
        <span className="min-w-0 flex-1 max-md:basis-[180px]">
          <h2 className="text-[19px] tracking-[-.02em]">{p.display_name}</h2>
          <div className="mt-0.5 text-[13px] text-muted-foreground">{p.job_title} · {p.department}</div>
          <div className="mt-[9px] flex flex-wrap gap-1.5">{p.chips.map((c) => <Pill key={c.text} tone={c.tone}>{c.text}</Pill>)}</div>
        </span>
        <span className="flex flex-wrap gap-[7px] max-md:w-full">
          <Button onClick={() => toast("Your data export is being prepared. It arrives in your Mailbox.")}>Download My Data</Button>
          <Button icon="shield" onClick={() => navigate(hrefFor("ess", "my-security"))}>Security</Button>
        </span>
      </div>
      <PhoneCards
        items={[
          { icon: "user", title: "Personal", sub: "Phone, email, address", body: personal },
          { icon: "brief", title: "Employment", sub: "Role, manager and your work schedule", body: employment },
          { icon: "wallet", title: "Bank", sub: `${p.bank.bank_name} · ${p.bank.account_last4}`, body: bank },
          { icon: "users", title: "Next of Kin", sub: p.next_of_kin.name, body: nok },
          { icon: "check", title: "What You Can Change", sub: `${p.can_change.filter((c) => c.how.tone !== "neutral").length} things you can change yourself`, body: can },
          { icon: "doc", title: "Record History", sub: `${p.history.length} changes`, body: history },
        ]}
      />
      <DesktopOnly>
        <Grid cols={2}>{personal}{employment}</Grid>
        <Grid cols={2}>{bank}{nok}</Grid>
        <Grid cols={2}>{can}{history}</Grid>
      </DesktopOnly>
    </>
  );
}

function EditProfile({ p, close }: { p: MyProfile; close: () => void }) {
  const f = useForm(
    { phone: p.personal.phone, address: p.personal.address, next_of_kin_name: p.next_of_kin.name, next_of_kin_relationship: p.next_of_kin.relationship, next_of_kin_phone: p.next_of_kin.phone, bank_name: p.bank.bank_name, account_number: "" },
    { phone: (v) => (/^(\+?234|0)\d{10}$/.test(v.replace(/[\s\-().]/g, "")) ? null : "A Nigerian number"), address: rules.min(5, "Enter the address"), account_number: (v) => (!v || /^\d{10}$/.test(v) ? null : "10 digits") },
  );
  const save = useMutation("PATCH /api/v1/ess/profile");
  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    const body: ProfilePatch = {};
    if (v.phone !== p.personal.phone) body.phone = v.phone;
    if (v.address !== p.personal.address) body.address = v.address;
    if (v.next_of_kin_name !== p.next_of_kin.name) body.next_of_kin_name = v.next_of_kin_name;
    if (v.next_of_kin_relationship !== p.next_of_kin.relationship) body.next_of_kin_relationship = v.next_of_kin_relationship;
    if (v.next_of_kin_phone !== p.next_of_kin.phone) body.next_of_kin_phone = v.next_of_kin_phone;
    if (v.bank_name !== p.bank.bank_name) body.bank_name = v.bank_name;
    if (v.account_number) body.account_number = v.account_number;
    if (!Object.keys(body).length) return close();
    try {
      await save.run({ body });
      invalidate("/api/v1/ess/profile");
      close();
      toast(body.bank_name || body.account_number ? "Saved. People have been notified of the bank change." : "Saved");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <FormRow>
        <Field label="Phone" {...f.field("phone")}><Input inputMode="tel" {...f.field("phone")} /></Field>
        <Field label="Address" {...f.field("address")}><Input {...f.field("address")} /></Field>
      </FormRow>
      <FormRow>
        <Field label="Next of Kin"><Input {...f.field("next_of_kin_name")} /></Field>
        <Field label="Relationship"><Input {...f.field("next_of_kin_relationship")} /></Field>
      </FormRow>
      <Field label="Next of Kin Phone"><Input inputMode="tel" {...f.field("next_of_kin_phone")} /></Field>
      <FormRow>
        <Field label="Bank" info="A bank change is logged and People are notified the same day, because expenses are paid into it.">
          <Input {...f.field("bank_name")} />
        </Field>
        <Field label="New Account Number" {...f.field("account_number")}><Input inputMode="numeric" maxLength={10} {...f.field("account_number")} placeholder="Leave empty to keep" /></Field>
      </FormRow>
      <div className="-mx-[18px] mt-2 -mb-4 flex justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Save</Button>
      </div>
    </>
  );
}

function PhotoForm({ close }: { close: () => void }) {
  const save = useMutation("PATCH /api/v1/ess/profile");
  const [done, setDone] = useState(false);
  return (
    <>
      <p className="mb-3 text-[12.5px] text-muted-foreground">A clear, recent photo. It shows on your profile, in Staff Community and on the org chart.</p>
      <Upload
        purpose="avatar"
        accept="image/*"
        multiple={false}
        maxBytes={8 * 1024 * 1024}
        label="Drop a photo here, or browse"
        onUploaded={async ([doc]) => {
          await save.run({ body: { photo_document_id: doc.document_id } });
          invalidate("/api/v1/ess/profile");
          setDone(true);
          toast("Photo updated");
        }}
      />
      <div className="-mx-[18px] mt-4 -mb-4 flex justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button variant={done ? "primary" : "default"} onClick={close}>{done ? "Done" : "Cancel"}</Button>
      </div>
    </>
  );
}

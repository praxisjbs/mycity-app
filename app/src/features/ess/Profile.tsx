import ess from "@mycity/contract/schemas/ess.js";
import type { EssProfile } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { employmentType, workPattern } from "@/features/people/status";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { hrefFor, useRouter } from "@/lib/router";
import { Banner, Button, Card, CardHeader, DesktopOnly, ErrorState, Field, formatDate, Grid, initials, KeyValue, LoadingRows, PageHeader, Pager, Pill, TextField, Timeline, toast, useContractForm, useModal, Wizard } from "@mycity/ui";

/**
 * ESS · My Profile (#8, `my-profile`): the caller's own record (docs/guides/ess.md §10).
 * People set the job, the manager and the schedule; the employee changes their
 * contact, next-of-kin and bank details with Edit Profile.
 */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const or = (v: string | null | undefined) => v || "Not given";

export function MyProfilePage() {
  const { data: p, error, reload } = useApi("GET /api/v1/ess/profile");
  const history = usePaged("GET /api/v1/ess/profile/history");
  const modal = useModal();
  const { navigate } = useRouter();
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!p) return <LoadingRows count={8} />;
  const edit = () => modal.open({ title: "Edit Profile", body: (close) => <EditProfile p={p} close={close} /> });
  const manager = p.line_manager ? p.line_manager.display_name : null;

  const personal = (
    <Card>
      <CardHeader title="Personal" />
      <KeyValue items={[["Full Name", p.display_name], ["Date of Birth", p.date_of_birth ? formatDate(p.date_of_birth) : "Not given"], ["Phone", or(p.phone)], ["Work Email", p.work_email], ["Address", or(p.home_address)]]} />
    </Card>
  );
  const schedule = (
    <div className="mt-3.5 border-t border-border pt-3">
      <CardHeader title="Work Schedule" help="Lateness is measured against these hours." right={<Pill>Set by People</Pill>} className="mb-1" />
      {p.working_week.map((d) => (
        <div key={d.weekday} className="flex flex-wrap items-center gap-2.5 border-b border-border py-2 last:border-b-0">
          <b className="w-20 text-xs">{DAYS[d.weekday - 1]}</b>
          <Pill tone={d.is_working_day ? "ok" : "neutral"}>{d.is_working_day ? "Working" : "Off"}</Pill>
          <span className="ml-auto text-2xs text-subtle-foreground">{d.is_working_day ? `${d.starts_at} to ${d.ends_at}` : "Not working"}</span>
        </div>
      ))}
    </div>
  );
  const employment = (
    <Card>
      <CardHeader title="Employment" help="Only People can change these, including your work schedule." />
      <KeyValue
        items={[
          ["Job Title", p.job_title],
          ["Department", or(p.department)],
          ["Line Manager", manager ?? "None"],
          ["Start Date", p.start_date ? formatDate(p.start_date) : "Not given"],
          ["Employment Type", employmentType(p.employment_type)],
          ["Work Arrangement", workPattern(p.work_pattern)],
          ["Status", <Pill tone={p.confirmed ? "ok" : "warn"}>{p.confirmed ? "Confirmed" : "On Probation"}</Pill>],
        ]}
      />
      {schedule}
    </Card>
  );
  const bank = (
    <Card>
      <CardHeader title="Bank Details" help="Expense refunds are paid into this account. A change is logged and People are notified." />
      <KeyValue items={[["Bank", or(p.bank_name)], ["Account Name", p.display_name], ["Account Number", p.account_last4 ? `•••• ${p.account_last4}` : "Not given"]]} />
    </Card>
  );
  const nok = (
    <Card>
      <CardHeader title="Next of Kin" />
      <KeyValue items={[["Name", or(p.next_of_kin_name)], ["Relationship", or(p.next_of_kin_relationship)], ["Phone", or(p.next_of_kin_phone)]]} />
    </Card>
  );
  const trail = (
    <Card>
      <CardHeader title="Record History" />
      <Timeline items={history.rows.map((h) => ({ title: h.summary, when: formatDate(h.occurred_at.slice(0, 10)), text: h.actor_name ?? undefined }))} />
      <Pager page={history.page} onPage={history.setPage} noun="change" />
    </Card>
  );

  return (
    <>
      <PageHeader title="My Profile" actions={<Button variant="primary" icon="edit" onClick={edit}>Edit Profile</Button>} />
      <div className="mb-3 flex flex-wrap items-start gap-4 rounded-card border border-border bg-card p-4 shadow-1 max-md:p-3.5">
        <span className="flex size-15 flex-none items-center justify-center rounded-sheet bg-secondary text-2xl font-bold tracking-tight text-secondary-foreground max-md:size-13 max-md:text-xl">
          {initials(p.display_name)}
        </span>
        <span data-copy="content" className="min-w-0 flex-1 max-md:basis-44">
          <h2 data-copy="content" className="text-xl tracking-tight">{p.display_name}</h2>
          <div className="mt-0.5 text-sm text-muted-foreground">{p.job_title}{p.department ? ` · ${p.department}` : ""}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Pill tone={p.confirmed ? "ok" : "warn"}>{p.confirmed ? "Confirmed" : "On Probation"}</Pill>
            <Pill tone="neutral">{workPattern(p.work_pattern)}</Pill>
            {manager && <Pill tone="neutral">{`Reports to ${manager}`}</Pill>}
          </div>
        </span>
        <span className="flex flex-wrap gap-1.5 max-md:w-full">
          <Button icon="shield" onClick={() => navigate(`${hrefFor("ess", "my-security")}&action=password`)}>Change Password</Button>
        </span>
      </div>
      <PhoneCards
        items={[
          { icon: "user", title: "Personal", sub: or(p.phone), body: personal },
          { icon: "brief", title: "Employment", sub: `${p.job_title}${manager ? `, reports to ${manager}` : ""}`, body: employment },
          { icon: "wallet", title: "Bank Details", sub: p.bank_name ? `${p.bank_name}${p.account_last4 ? ` · ${p.account_last4}` : ""}` : "Not given", body: bank },
          { icon: "users", title: "Next of Kin", sub: or(p.next_of_kin_name), body: nok },
          { icon: "doc", title: "Record History", sub: `${history.page?.total ?? 0} changes`, body: trail },
        ]}
      />
      <DesktopOnly>
        <Grid cols={2}>{personal}{employment}</Grid>
        <Grid cols={2}>{bank}{nok}</Grid>
        {trail}
      </DesktopOnly>
    </>
  );
}

/** The fields an employee changes themselves (EssProfileUpdate). Only what changed is sent. */
function EditProfile({ p, close }: { p: EssProfile; close: () => void }) {
  const start: EditValues = {
    phone: p.phone ?? "",
    home_address: p.home_address ?? "",
    next_of_kin_name: p.next_of_kin_name ?? "",
    next_of_kin_relationship: p.next_of_kin_relationship ?? "",
    next_of_kin_phone: p.next_of_kin_phone ?? "",
    bank_name: p.bank_name ?? "",
    account_number: "",
  };
  const f = useContractForm(start, ess.EssProfileUpdate);
  const save = useMutation("PATCH /api/v1/ess/profile");
  const submit = async () => {
    if (!f.check()) return;
    const changed = Object.fromEntries(
      Object.entries(f.values).filter(([k, v]) => v.trim() !== "" && v !== start[k as keyof typeof start]),
    );
    if (!Object.keys(changed).length) return close();
    try {
      await save.run({ body: changed });
      invalidate("/api/v1/ess/profile");
      close();
      toast(changed.bank_name || changed.account_number ? "Saved. People are told of the bank change." : "Profile saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Not saved. Try again.");
    }
  };
  const changes = CHANGEABLE.flatMap(([key, label]) => {
    const v = f.values[key].trim();
    if (!v || v === start[key]) return [];
    const before = key === "account_number" ? (p.account_last4 ? `•••• ${p.account_last4}` : "Not given") : start[key] || "Not given";
    const after = key === "account_number" ? `•••• ${v.slice(-4)}` : v;
    return [[label, `${before} → ${after}`] as [string, string]];
  });
  const bankChanged = changes.some(([label]) => label === "Bank" || label === "Account Number");
  return (
    <Wizard
      finish={changes.length ? "Save Changes" : "Close"}
      busy={save.pending}
      onFinish={() => submit()}
      onCancel={close}
      steps={[
        {
          title: "Contact",
          check: () => f.check(["phone", "home_address"]),
          body: (
            <>
              <Field label="Phone" {...f.field("phone")}><TextField inputMode="tel" autoComplete="tel" {...f.field("phone")} placeholder="0803 123 4567" /></Field>
              <Field label="Home Address" {...f.field("home_address")}><TextField autoComplete="street-address" {...f.field("home_address")} /></Field>
            </>
          ),
        },
        {
          title: "Next of Kin",
          check: () => f.check(["next_of_kin_name", "next_of_kin_relationship", "next_of_kin_phone"]),
          body: (
            <>
              <Field label="Full Name" {...f.field("next_of_kin_name")}><TextField {...f.field("next_of_kin_name")} /></Field>
              <Field label="Relationship" optional {...f.field("next_of_kin_relationship")}><TextField {...f.field("next_of_kin_relationship")} placeholder="Sister" /></Field>
              <Field label="Phone" {...f.field("next_of_kin_phone")}><TextField inputMode="tel" {...f.field("next_of_kin_phone")} placeholder="0803 123 4567" /></Field>
            </>
          ),
        },
        {
          title: "Bank",
          check: () => f.check(["bank_name", "account_number"]),
          body: (
            <>
              <KeyValue
                className="mb-3"
                items={[
                  ["Bank on Record", p.bank_name || "Not given"],
                  ["Account", p.account_last4 ? `•••• ${p.account_last4}` : "Not given"],
                ]}
              />
              <Field label="Bank" {...f.field("bank_name")}><TextField {...f.field("bank_name")} /></Field>
              <Field label="New Account Number" optional info="Ten digits. Leave it empty to keep the account on record." {...f.field("account_number")}>
                <TextField inputMode="numeric" autoComplete="off" maxLength={10} {...f.field("account_number")} />
              </Field>
            </>
          ),
        },
        {
          title: "Review",
          body: changes.length ? (
            <>
              <KeyValue items={changes} />
              {bankChanged && <Banner tone="info" className="mt-3">A bank change is logged and People are told.</Banner>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing has changed yet. Go back to change a detail, or close.</p>
          ),
        },
      ]}
    />
  );
}

/** What the employee may change, in the order the review lists it (docs/guides/ess.md §6). */
const CHANGEABLE: Array<[keyof EditValues, string]> = [
  ["phone", "Phone"],
  ["home_address", "Home Address"],
  ["next_of_kin_name", "Next of Kin"],
  ["next_of_kin_relationship", "Relationship"],
  ["next_of_kin_phone", "Next of Kin Phone"],
  ["bank_name", "Bank"],
  ["account_number", "Account Number"],
];
type EditValues = { phone: string; home_address: string; next_of_kin_name: string; next_of_kin_relationship: string; next_of_kin_phone: string; bank_name: string; account_number: string };

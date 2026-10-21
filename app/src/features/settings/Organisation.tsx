import { useEffect, useState } from "react";
import settings from "@mycity/contract/schemas/settings.js";
import type { Holiday, Organisation, WorkingDay } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { useFileUrl } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { upload } from "@/api/upload";
import { useAuth } from "@/auth/AuthProvider";
import { places, placeValue } from "@/features/shared/places";
import { useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import {
  AddressField,
  Button,
  Card,
  CardHeader,
  Chips,
  cn,
  DataView,
  DateField,
  DesktopOnly,
  ErrorState,
  Field,
  formatDate,
  Form,
  FormError,
  FormFooter,
  Grid,
  Icon,
  IconButton,
  KeyValue,
  LoadingRows,
  PageHeader,
  PhoneField,
  PhoneOnly,
  Pill,
  Stack,
  Switch,
  TextField,
  TimeField,
  toast,
  useConfirm,
  UploadField,
  useContractForm,
  useModal,
} from "@mycity/ui";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");

/**
 * Settings · Organisation (docs/guides/foundation.md §10): the company's own
 * profile, the working week by day (A22), and the public holidays: Nigeria's are
 * seeded, the moon-dated and weekend ones Expected until someone confirms or moves
 * them here, and any other is added here. Attendance, leave and every deadline
 * read the week and the holidays.
 */
export function OrganisationTab() {
  const { can } = useAuth();
  const modal = useModal();
  const [params, setParams] = useSearchParams();
  const org = useApi("GET /api/v1/settings/organisation");
  const canEdit = can("settings", "edit");
  const canAdd = can("settings", "create");

  const newHoliday = () =>
    modal.open({ title: "New Holiday", body: (close) => <HolidayForm holiday={null} close={close} />, onClose: () => setParams({ new: null }) });
  useScreenAction(canAdd ? { label: "New Holiday", onSelect: newHoliday } : null);
  // The assistant's "add a public holiday" opens this screen with ?new=1.
  useEffect(() => {
    if (params.get("new") === "1" && canAdd) newHoliday();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival
  }, [params.get("new"), canAdd]);

  const o = org.data;
  return (
    <>
      <PageHeader
        title="Organisation"
        sub={o?.legal_name ?? undefined}
        actions={
          <>
            {canEdit && o && (
              <Button icon="edit" onClick={() => modal.open({ title: "Edit Profile", body: (close) => <ProfileForm org={o} close={close} /> })}>
                Edit Profile
              </Button>
            )}
            {canAdd && (
              <DesktopOnly>
                <Button variant="primary" icon="plus" onClick={newHoliday}>
                  New Holiday
                </Button>
              </DesktopOnly>
            )}
          </>
        }
      />
      <Grid cols={2}>
        <Stack gap={3}>
          <Card>
            <CardHeader title="Company" />
            {org.error ? (
              <ErrorState error={org.error} onRetry={org.reload} />
            ) : !o ? (
              <LoadingRows count={6} />
            ) : (
              <KeyValue
                items={[
                  ["Legal Name", o.legal_name],
                  ["Trading Name", o.trading_name],
                  ["RC Number", o.registration_number],
                  ["Tax ID", o.tax_id],
                  ["Address", o.address],
                  ["Phone", o.phone],
                  ["Email", o.email],
                  ["Website", o.website],
                  ["Currency", "Naira (NGN)"],
                  ["Time Zone", "Africa/Lagos"],
                ]}
              />
            )}
          </Card>
          {o && <BrandFiles org={o} canEdit={canEdit} />}
        </Stack>
        <Holidays canEdit={canEdit} />
      </Grid>
      <WorkingWeek canEdit={canEdit} />
    </>
  );
}

/* ───────────── Brand files (foundation.md §6.11) ───────────── */

type BrandSlot = "logo" | "logo_white" | "icon";
const BRAND: Array<{ slot: BrandSlot; label: string; upload: string; said: string; dark: boolean }> = [
  { slot: "logo", label: "Logo", upload: "Upload Logo", said: "Logo", dark: false },
  { slot: "logo_white", label: "White Logo", upload: "Upload White Logo", said: "White logo", dark: true },
  { slot: "icon", label: "Icon", upload: "Upload Icon", said: "Icon", dark: true },
];
const BRAND_MAX_BYTES = 5 * 1024 * 1024;

/** The three brand files, each one upload that applies at once; letters, system mail and signatures use them. */
function BrandFiles({ org, canEdit }: { org: Organisation; canEdit: boolean }) {
  return (
    <Card>
      <CardHeader title="Brand" help="PNG or WebP with a clear background. Signatures, letters and system mail use them at once." />
      <div className="grid grid-cols-3 gap-3 max-md:gap-2">
        {BRAND.map((b) => (
          <BrandFile key={b.slot} {...b} doc={org[b.slot]} canEdit={canEdit} />
        ))}
      </div>
    </Card>
  );
}

function BrandFile({ slot, label, upload: uploadLabel, said, dark, doc, canEdit }: (typeof BRAND)[number] & { doc: Organisation["logo"]; canEdit: boolean }) {
  const href = useFileUrl(doc ? `/api/v1/documents/${doc.document_id}/content` : null);
  const remove = async () => {
    try {
      await api.call("DELETE /api/v1/settings/organisation/brand/:slot", { params: { slot } });
      invalidate("/api/v1/settings/organisation");
      toast(`${said} removed`);
    } catch (e) {
      say(e);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className={cn("flex h-20 items-center justify-center rounded-box border border-border p-3", dark ? "bg-deep" : "bg-paper")}>
        {href ? (
          <img src={href} alt={label} className="max-h-full max-w-full object-contain" />
        ) : (
          <Icon name="image" size="l" className={dark ? "text-on-deep-muted" : "text-paper-faint"} label={doc ? label : `No ${label}`} />
        )}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        {doc && (
          <div data-copy="content" className="truncate text-2xs text-subtle-foreground">
            {doc.file_name}
          </div>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          <UploadField
            upload={upload}
            purpose="brand"
            endpoint={`/api/v1/settings/organisation/brand/${slot}`}
            multiple={false}
            accept=".png,.webp"
            maxBytes={BRAND_MAX_BYTES}
            handOff
            onUploaded={() => {
              invalidate("/api/v1/settings/organisation");
              toast(`${said} updated`);
            }}
            trigger={(open) => (
              <>
                <DesktopOnly as="span">
                  <Button size="sm" icon="plus" onClick={open}>
                    {uploadLabel}
                  </Button>
                </DesktopOnly>
                <PhoneOnly as="span">
                  <IconButton icon="plus" label={uploadLabel} onClick={open} />
                </PhoneOnly>
              </>
            )}
          />
          {doc && (
            <Button size="sm" variant="ghost" onClick={remove}>
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────── Profile ───────────── */

function ProfileForm({ org, close }: { org: Organisation; close: () => void }) {
  const save = useMutation("PATCH /api/v1/settings/organisation");
  const f = useContractForm(
    {
      legal_name: org.legal_name ?? "",
      trading_name: org.trading_name ?? "",
      registration_number: org.registration_number ?? "",
      tax_id: org.tax_id ?? "",
      address: placeValue(org.address_place),
      phone: org.phone ?? "",
      email: org.email ?? "",
      website: org.website ?? "",
    },
    settings.OrganisationPatch,
  );
  const submit = async () => {
    try {
      await save.run({ body: f.values });
      invalidate("/api/v1/settings/organisation");
      close();
      toast("Profile saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <Form onSubmit={f.submit(submit)}>
      <Field label="Legal Name" optional {...f.status("legal_name")}>
        <TextField {...f.field("legal_name")} placeholder="MyCity App Ltd" />
      </Field>
      <Field label="Trading Name" optional {...f.status("trading_name")}>
        <TextField {...f.field("trading_name")} />
      </Field>
      <Grid cols={2}>
        <Field label="RC Number" optional {...f.status("registration_number")}>
          <TextField {...f.field("registration_number")} placeholder="RC 1234567" />
        </Field>
        <Field label="Tax ID" optional {...f.status("tax_id")}>
          <TextField {...f.field("tax_id")} />
        </Field>
      </Grid>
      <Field label="Address" optional {...f.status("address")}>
        <AddressField {...f.field("address")} places={places} />
      </Field>
      <Grid cols={2}>
        <Field label="Phone" optional {...f.status("phone")}>
          <PhoneField {...f.field("phone")} />
        </Field>
        <Field label="Email" optional {...f.status("email")}>
          <TextField type="email" {...f.field("email")} placeholder="hello@mycityapp.io" />
        </Field>
      </Grid>
      <Field label="Website" optional {...f.status("website")}>
        <TextField type="url" {...f.field("website")} placeholder="https://mycityapp.io" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" busy={save.pending}>
          Save Profile
        </Button>
      </FormFooter>
    </Form>
  );
}

/* ───────────── Working week ───────────── */

const sameWeek = (a: WorkingDay[], b: WorkingDay[]) => JSON.stringify(a) === JSON.stringify(b);
const dayProblem = (d: WorkingDay) => (!d.is_working_day ? null : !d.starts_at || !d.ends_at ? "Enter both times" : d.ends_at <= d.starts_at ? "After the start" : null);

function WorkingWeek({ canEdit }: { canEdit: boolean }) {
  const modal = useModal();
  const week = useApi("GET /api/v1/settings/working-week");
  const days = week.data?.days ?? [];
  return (
    <DataView
      className="mt-3"
      title="Working Week"
      help="The days and hours the organisation works. Attendance, leave and every deadline count working days from here."
      actions={
        canEdit && week.data ? (
          <Button size="sm" icon="edit" onClick={() => modal.open({ title: "Edit Week", body: (close) => <WeekForm days={week.data!.days} close={close} /> })}>
            Edit Week
          </Button>
        ) : undefined
      }
      rows={days}
      loading={week.loading}
      error={week.error}
      onReload={week.reload}
      rowKey={(d) => String(d.weekday)}
      columns={[
        { key: "day", label: "Day", render: (d) => <b>{DAYS[d.weekday - 1]}</b> },
        { key: "hours", label: "Hours", render: (d) => (d.is_working_day ? `${d.starts_at} to ${d.ends_at}` : "Not worked") },
        { key: "on", label: "Status", render: (d) => <Pill tone={d.is_working_day ? "ok" : "neutral"}>{d.is_working_day ? "Worked" : "Off"}</Pill> },
      ]}
    />
  );
}

/** All seven days at once; a worked day needs an end after its start. */
function WeekForm({ days: initial, close }: { days: WorkingDay[]; close: () => void }) {
  const save = useMutation("PUT /api/v1/settings/working-week");
  const [days, setDays] = useState(initial);
  const [tried, setTried] = useState(false);
  const edit = (weekday: number, patch: Partial<WorkingDay>) =>
    setDays((all) =>
      all.map((d) => {
        if (d.weekday !== weekday) return d;
        if (patch.is_working_day === true) return { ...d, is_working_day: true, starts_at: d.starts_at ?? "09:00", ends_at: d.ends_at ?? "17:00" };
        if (patch.is_working_day === false) return { ...d, is_working_day: false, starts_at: null, ends_at: null };
        return { ...d, ...patch };
      }),
    );
  const none = !days.some((d) => d.is_working_day);
  const submit = async () => {
    setTried(true);
    if (none || days.some(dayProblem)) return;
    try {
      if (!sameWeek(days, initial)) await save.run({ body: { days } });
      invalidate("/api/v1/settings/working-week");
      close();
      toast("Working week saved");
    } catch (e) {
      say(e);
    }
  };
  return (
    <Form onSubmit={() => submit()}>
      {days.map((d) => (
        <div key={d.weekday} className="border-b border-border py-2 last:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <b className="text-sm">{DAYS[d.weekday - 1]}</b>
            <Switch checked={d.is_working_day} label={`${DAYS[d.weekday - 1]} is worked`} onChange={(v) => edit(d.weekday, { is_working_day: v })} />
          </div>
          {d.is_working_day && (
            <Grid cols={2} className="mt-2">
              <Field label="Start">
                <TimeField value={d.starts_at ?? ""} onChange={(v) => edit(d.weekday, { starts_at: v || null })} />
              </Field>
              <Field label="End" state={tried && dayProblem(d) ? "bad" : undefined} message={dayProblem(d) ?? undefined}>
                <TimeField value={d.ends_at ?? ""} onChange={(v) => edit(d.weekday, { ends_at: v || null })} />
              </Field>
            </Grid>
          )}
        </div>
      ))}
      {tried && none && <FormError>Work at least one day</FormError>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" busy={save.pending}>
          Save Week
        </Button>
      </FormFooter>
    </Form>
  );
}

/* ───────────── Public holidays ───────────── */

function Holidays({ canEdit }: { canEdit: boolean }) {
  const modal = useModal();
  const year = new Date().getFullYear();
  const [y, setY] = useState(String(year));
  const list = usePaged("GET /api/v1/settings/holidays", { filters: y ? { year: Number(y) } : {} });
  return (
    <DataView
      title="Public Holidays"
      actions={<Chips label="Year" value={y} onChange={setY} options={[[String(year), String(year)], [String(year + 1), String(year + 1)], ["", "All"]]} />}
      list={list}
      rowKey={(h) => h.public_holiday_id}
      noun="holiday"
      onRowClick={canEdit ? (h) => modal.open({ title: h.name, body: (close) => <HolidayForm holiday={h} close={close} /> }) : undefined}
      empty={{ title: "No Holidays Yet", text: "Add each public holiday as it is declared.", icon: "calendar" }}
      columns={[
        { key: "holiday_date", label: "Date", sortable: true, render: (h) => formatDate(h.holiday_date) },
        { key: "name", label: "Holiday", sortable: true, render: (h) => h.name },
        { key: "expected", label: "Status", render: (h) => <Pill tone={h.expected ? "warn" : "ok"}>{h.expected ? "Expected" : "Declared"}</Pill> },
      ]}
    />
  );
}

function HolidayForm({ holiday, close }: { holiday: Holiday | null; close: () => void }) {
  const confirm = useConfirm();
  const add = useMutation("POST /api/v1/settings/holidays");
  const update = useMutation("PATCH /api/v1/settings/holidays/:id");
  const remove = useMutation("DELETE /api/v1/settings/holidays/:id");
  const f = useContractForm({ holiday_date: holiday?.holiday_date ?? "", name: holiday?.name ?? "" }, settings.HolidaySave);
  const done = (msg: string) => {
    invalidate("/api/v1/settings/holidays");
    close();
    toast(msg);
  };
  const submit = async () => {
    try {
      if (holiday) await update.run({ params: { id: holiday.public_holiday_id }, body: f.values });
      else await add.run({ body: f.values });
      done(holiday?.expected ? "Holiday confirmed" : holiday ? "Holiday saved" : "Holiday added");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  const del = async () => {
    if (!holiday || !(await confirm({ title: "Delete Holiday", body: `${holiday.name} becomes a normal day.`, confirmLabel: "Delete Holiday", destructive: true }))) return;
    try {
      await remove.run({ params: { id: holiday.public_holiday_id } });
      done("Holiday deleted");
    } catch (e) {
      say(e);
    }
  };
  return (
    <Form onSubmit={f.submit(submit)}>
      <Field label="Date" {...f.status("holiday_date")}>
        <DateField {...f.field("holiday_date")} />
      </Field>
      <Field label="Name" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Independence Day" maxLength={80} />
      </Field>
      <FormFooter>
        {holiday && (
          <Button variant="danger" className="mr-auto" busy={remove.pending} onClick={() => del()}>
            Delete Holiday
          </Button>
        )}
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" busy={add.pending || update.pending}>
          {holiday?.expected ? "Confirm Holiday" : holiday ? "Save Holiday" : "Add Holiday"}
        </Button>
      </FormFooter>
    </Form>
  );
}

/**
 * My Workspace · Calendar (docs/guides/workspace.md §10.1): the month, the week or the day, and
 * what is coming up in the next 30 days. Events, task deadlines and approved leave, Africa/Lagos.
 */
import { useEffect, useState } from "react";
import type { CalendarEvent, CalendarItem } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useInfinite, useMutation } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { ColleaguePicker } from "@/features/shared/pickers";
import { useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import {
  Button,
  Calendar,
  Card,
  CardHeader,
  DateField,
  Field,
  formatDate,
  formatDateTime,
  formatTime,
  FormFooter,
  Grid,
  KeyValue,
  LoadingRows,
  monthName,
  PageHeader,
  Pill,
  SegmentedControl,
  SelectField,
  TapList,
  TextField,
  TimeField,
  toast,
  todayIso,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { say } from "./shared";
import { useTaskPanel } from "./TaskPanel";

type View = "month" | "week" | "day";

/** The Lagos calendar day an instant falls on. */
const lagosDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
/** The Lagos wall clock of an instant, HH:MM. */
const lagosClock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false });
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addMonths = (month: string, n: number) => {
  const d = new Date(`${month}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
/** The Monday of a day's week. */
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const short = (day: string, i?: number) => `${WEEKDAY[i ?? (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]} ${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** Every item of one month, page after page (a month holds a few pages at most). */
function useMonth(month: string) {
  const list = useInfinite("GET /api/v1/calendar", { filters: { month } });
  const { more, page, loading } = list;
  useEffect(() => {
    if (page?.has_next && !loading && page.number < 8) more();
  }, [page, loading, more]);
  return list;
}

const REMIND: Array<[string, string]> = [["", "None"], ["0", "At Start"], ["15", "15 Minutes Before"], ["60", "1 Hour Before"], ["1440", "1 Day Before"]];
const remindText = (m: number) => (REMIND.find(([v]) => v === String(m))?.[1] ?? `${m} minutes before`);

const KIND: Record<string, string> = { meeting: "Meeting", deadline: "Deadline", campaign: "Campaign", event: "Event", interview: "Interview" };
const kindOf = (i: CalendarItem) => (i.item_kind === "task" ? "Deadline" : i.item_kind === "leave" ? "Leave" : i.item_kind === "performance" ? "Review" : KIND[i.event_type ?? ""] ?? "Event");

/** One line of a day: the time, the title and place, and what it is. */
function Line({ i, onOpen }: { i: CalendarItem; onOpen: (i: CalendarItem) => void }) {
  return (
    <button type="button" onClick={() => onOpen(i)} className="flex min-h-tap w-full items-start gap-2.5 border-b border-border py-2 text-left last:border-b-0">
      <b className="w-11.5 flex-none text-xs font-bold">{i.all_day ? "All Day" : formatTime(i.starts_at)}</b>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold" data-copy="content">{i.title}</span>
        {i.location && <span className="block text-2xs text-subtle-foreground">{i.location}</span>}
      </span>
      <Pill tone={i.item_kind === "task" ? "warn" : i.item_kind === "leave" ? "info" : "neutral"}>{kindOf(i)}</Pill>
    </button>
  );
}

export function CalendarTab() {
  const today = todayIso();
  const [anchor, setAnchor] = useState(today);
  const [view, setView] = useState<View>("month");
  const month = anchor.slice(0, 7);
  const prev = useMonth(addMonths(month, -1));
  const here = useMonth(month);
  const next = useMonth(addMonths(month, 1));
  const later = useMonth(today.slice(0, 7) === month ? addMonths(month, 1) : addMonths(today.slice(0, 7), 1));
  const now = useMonth(today.slice(0, 7));
  const modal = useModal();
  const panel = useTaskPanel();
  const add = () => modal.open({ title: "New Event", body: (close) => <EventForm close={close} day={view === "month" ? undefined : anchor} /> });
  useScreenAction({ label: "New Event", onSelect: add });
  /* A link to one event (the bell, ⌘K): /workspace?tab=calendar&id=… opens it. */
  const [params, setParams] = useSearchParams();
  const linked = params.get("id");
  useEffect(() => {
    if (!linked) return;
    modal.open({ title: "Event", body: (close) => <EventPanel id={linked} close={close} /> });
    setParams({ id: null }, { replace: true });
  }, [linked, modal, setParams]);

  const items = [...new Map([...prev.rows, ...here.rows, ...next.rows].map((i) => [i.item_kind + i.item_id + i.starts_at, i])).values()];
  const on = (day: string) => items.filter((i) => lagosDay(i.starts_at) === day).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const openItem = (i: CalendarItem) => {
    if (i.item_kind === "task") panel.open(i.item_id, i.title);
    else if (i.item_kind === "event") modal.open({ title: i.title, body: (close) => <EventPanel id={i.item_id} close={close} /> });
    else if (i.link) window.location.assign(i.link.path);
  };
  const step = (n: number) =>
    setAnchor((d) => (view === "day" ? addDays(d, n) : view === "week" ? addDays(d, 7 * n) : `${addMonths(d.slice(0, 7), n)}-01`));
  const horizon = addDays(today, 30);
  const upcoming = [...new Map([...now.rows, ...later.rows].map((i) => [i.item_kind + i.item_id + i.starts_at, i])).values()]
    .filter((i) => lagosDay(i.starts_at) >= today && lagosDay(i.starts_at) <= horizon)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const monday = mondayOf(anchor);
  const title = view === "month" ? `${monthName(Number(month.slice(5, 7)) - 1)} ${month.slice(0, 4)}` : view === "week" ? `Week of ${formatDate(monday)}` : formatDate(anchor);
  const loading = here.loading && !here.rows.length;

  return (
    <>
      <PageHeader
        title="Calendar"
        sub={title}
        actions={
          <>
            <SegmentedControl label="Calendar View" value={view} onChange={setView} options={[["month", "Month"], ["week", "Week"], ["day", "Day"]]} />
            <Button onClick={() => step(-1)} aria-label="Previous" icon="left" />
            <Button onClick={() => setAnchor(today)}>Today</Button>
            <Button onClick={() => step(1)} aria-label="Next" icon="right" />
            <Button variant="primary" icon="plus" onClick={add}>New Event</Button>
          </>
        }
      />
      <Grid cols="1.4/1">
        {loading ? (
          <Card><LoadingRows count={8} /></Card>
        ) : view === "month" ? (
          <Calendar
            year={Number(month.slice(0, 4))}
            month={Number(month.slice(5, 7)) - 1}
            events={here.rows.map((e) => ({ date: lagosDay(e.starts_at), label: e.title, highlight: e.item_kind === "task", onSelect: () => openItem(e) }))}
          />
        ) : view === "week" ? (
          <Card>
            <CardHeader title={`Week of ${formatDate(monday)}`} />
            {Array.from({ length: 7 }, (_, n) => addDays(monday, n)).map((day, n) => (
              <div key={day} className="border-b border-border py-1.5 last:border-b-0">
                <button type="button" onClick={() => (setAnchor(day), setView("day"))} className={day === today ? "text-2xs font-bold text-primary" : "text-2xs font-semibold text-muted-foreground"}>
                  {short(day, n)}
                </button>
                {on(day).map((i) => <Line key={i.item_kind + i.item_id} i={i} onOpen={openItem} />)}
                {!on(day).length && <p className="py-1 text-2xs text-subtle-foreground">Nothing booked.</p>}
              </div>
            ))}
          </Card>
        ) : (
          <Card>
            <CardHeader title={short(anchor)} right={<span className="text-2xs text-subtle-foreground">Africa/Lagos</span>} />
            {on(anchor).map((i) => <Line key={i.item_kind + i.item_id} i={i} onOpen={openItem} />)}
            {!on(anchor).length && <p className="text-2xs text-subtle-foreground">Nothing booked.</p>}
          </Card>
        )}
        <Card>
          <CardHeader title="Coming Up" />
          <TapList
            flat
            label="Coming Up"
            items={upcoming.map((e) => ({
              key: e.item_kind + e.item_id + e.starts_at,
              title: <span data-copy="content">{e.title}</span>,
              sub: short(lagosDay(e.starts_at)),
              end: kindOf(e),
              onSelect: () => openItem(e),
            }))}
          />
          {!upcoming.length && <p className="text-2xs text-subtle-foreground">Nothing in the next 30 days.</p>}
        </Card>
      </Grid>
      {panel.panel}
    </>
  );
}

function EventPanel({ id, close }: { id: string; close: () => void }) {
  const { data: e, reload } = useApi("GET /api/v1/calendar/:id", { params: { id } });
  const respond = useMutation("POST /api/v1/calendar/:id/respond");
  const cancel = useMutation("POST /api/v1/calendar/:id/cancel");
  const modal = useModal();
  if (!e) return <LoadingRows count={4} />;
  const answer = async (response: "accepted" | "declined") => {
    try {
      await respond.run({ params: { id }, body: { response } });
      reload();
      invalidate("/api/v1/calendar");
      toast(response === "accepted" ? "Accepted" : "Declined");
    } catch (err) {
      say(err);
    }
  };
  const callOff = async () => {
    try {
      await cancel.run({ params: { id }, body: {} });
      invalidate("/api/v1/calendar");
      close();
      toast("Event called off");
    } catch (err) {
      say(err);
    }
  };
  return (
    <>
      <KeyValue
        items={[
          ["When", e.all_day ? formatDate(e.starts_at) : `${formatDateTime(e.starts_at)} to ${formatTime(e.ends_at)}`],
          ["Kind", KIND[e.event_type] ?? "Event"],
          ["Organiser", e.owner?.display_name ?? ""],
          ...(e.reminder_minutes.length ? ([["Reminder", e.reminder_minutes.map(remindText).join(", ")]] as Array<[string, string]>) : []),
          ...(e.location ? ([["Where", e.location]] as Array<[string, string]>) : []),
          ["Attendees", e.attendees.map((a) => `${a.employee.display_name}${a.response === "accepted" ? "" : a.response === "declined" ? " (declined)" : " (pending)"}`).join(", ") || "Nobody invited"],
        ]}
      />
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {e.can_edit && <Button variant="danger" onClick={callOff}>Call Off</Button>}
        {e.can_edit && <Button onClick={() => modal.open({ title: "Edit Event", body: (done) => <EventForm close={done} event={e} /> })}>Edit Event</Button>}
        {e.my_response && e.my_response !== "declined" && <Button onClick={() => answer("declined")}>Decline</Button>}
        {e.my_response && e.my_response !== "accepted" && <Button variant="primary" onClick={() => answer("accepted")}>Accept</Button>}
      </FormFooter>
    </>
  );
}

/** Lagos wall clock on a day → the instant on the wire. */
const lagosInstant = (day: string, hm: string) => new Date(`${day}T${hm}:00+01:00`).toISOString();

function EventForm({ close, title = "", day = "", event }: { close: () => void; title?: string; day?: string; event?: CalendarEvent }) {
  const [who, setWho] = useState<PersonRef[]>(event ? event.attendees.map((a) => a.employee) : []);
  const f = useContractForm(
    {
      title: event?.title ?? title,
      day: event ? lagosDay(event.starts_at) : day,
      start: event ? lagosClock(event.starts_at) : "10:00",
      end: event ? lagosClock(event.ends_at) : "11:00",
      event_type: (event?.event_type ?? "meeting") as string,
      location: event?.location ?? "",
      visibility: (event?.visibility ?? "attendees") as string,
      remind: event ? (event.reminder_minutes[0] !== undefined ? String(event.reminder_minutes[0]) : "") : "15",
    },
    {
      title: (v: string) => (!v.trim() ? "Name the event" : null),
      day: (v: string) => (!v ? "Pick a date" : null),
      end: (v: string, all: Record<string, unknown>) => (v && all.start && v <= String(all.start) ? "Ends before it starts" : null),
    },
  );
  const create = useMutation("POST /api/v1/calendar");
  const edit = useMutation("PATCH /api/v1/calendar/:id");
  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    const body = {
      title: v.title.trim(),
      starts_at: lagosInstant(v.day, v.start),
      ends_at: lagosInstant(v.day, v.end),
      event_type: v.event_type as CalendarEvent["event_type"],
      visibility: v.visibility as CalendarEvent["visibility"],
      location: v.location.trim() || (event ? null : undefined),
      attendee_ids: who.map((p) => p.employee_id),
      // The form sets one; more set elsewhere are kept unless this one changes.
      reminder_minutes: v.remind === "" ? [] : event && event.reminder_minutes[0] === Number(v.remind) ? event.reminder_minutes : [Number(v.remind)],
    };
    try {
      if (event) await edit.run({ params: { id: event.calendar_event_id }, body: body as never });
      else await create.run({ body: body as never });
      invalidate("/api/v1/calendar");
      invalidate("/api/v1/workspace");
      close();
      toast(event ? "Event changed" : "Added to the calendar");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors({ ...e.fields, ...(e.fields.ends_at ? { end: e.fields.ends_at } : {}) });
      else say(e);
    }
  };
  return (
    <>
      <Field label="Event" {...f.field("title")}><TextField {...f.field("title")} /></Field>
      <Field label="Date" {...f.field("day")}><DateField {...f.field("day")} /></Field>
      <Grid cols={2}>
        <Field label="Start" {...f.field("start")}><TimeField {...f.field("start")} /></Field>
        <Field label="End" {...f.field("end")}><TimeField {...f.field("end")} /></Field>
      </Grid>
      <Field label="Kind"><SelectField options={[["meeting", "Meeting"], ["deadline", "Deadline"], ["campaign", "Campaign"], ["event", "Event"], ["interview", "Interview"]]} {...f.field("event_type")} /></Field>
      <Field label="Attendees" optional><ColleaguePicker value={who} onChange={setWho} multiple /></Field>
      {/* address:none a meeting's room or call link, not a street address */}
      <Field label="Location" optional><TextField {...f.field("location")} /></Field>
      <Field label="Who Can See"><SelectField options={[["attendees", "Attendees"], ["everyone", "Everyone"], ["private", "Only Me"]]} {...f.field("visibility")} /></Field>
      <Field label="Reminder" optional><SelectField options={REMIND} {...f.field("remind")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{event ? "Save Event" : "Add Event"}</Button>
      </FormFooter>
    </>
  );
}

export { EventForm };

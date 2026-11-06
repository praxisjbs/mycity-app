/**
 * Schedule Interview and Reschedule (docs/guides/recruitment.md §6.6): the candidate, how they are
 * met (in person at a worksite, by video with its link, or by phone), the day and its times in
 * Lagos, and the panel. Each panelist gets the calendar entry; the candidate gets the invitation with
 * its .ics. The panel picker offers only people who hold Recruitment (GET /interviews/panelists), and a
 * refusal names anyone who cannot sit. A person taken off the panel loses an unsent draft; a
 * submitted card stays.
 */
import { useState } from "react";
import interviewSchemas from "@mycity/contract/schemas/interviews.js";
import type { InterviewDetail } from "@mycity/contract/contract.gen.ts";
import type { PersonRef } from "@/api/types/common";
import { ApiError } from "@/api/client";
import { usePhotos } from "@/api/download";
import { invalidate, useInfinite, useMutation, usePaged } from "@/api/hooks";
import { paging } from "@/features/shared/wire";
import { Button, ChoiceField, DateField, Field, FormError, FormFooter, Grid, PersonPicker, RecordPicker, SelectField, TextField, TimeField, toast, todayIso, useContractForm } from "@mycity/ui";
import { bodySchema, INTERVIEW_TYPE, renamed, sayRefusal } from "./shared";

type Values = {
  application_id: string;
  title: string;
  interview_type: string;
  day: string;
  starts: string;
  ends: string;
  worksite_id: string;
  meeting_url: string;
  panel: PersonRef[];
};

const RENAME = { scheduled_start: "day", scheduled_end: "ends", panel_employee_ids: "panel" };
const TYPES = Object.entries(INTERVIEW_TYPE) as Array<[string, string]>;

/** A Lagos day and time as the instant the API keeps (Lagos keeps +01:00 all year). */
const instant = (day: string, time: string) => (day && /^\d{2}:\d{2}$/.test(time) ? new Date(`${day}T${time}:00+01:00`).toISOString() : "");
/** An instant as its Lagos day and time. */
const lagos = (iso: string) => {
  const t = new Date(Date.parse(iso) + 3600_000).toISOString();
  return { day: t.slice(0, 10), time: t.slice(11, 16) };
};

function bodyOf(v: Values, edit: boolean) {
  return {
    ...(edit ? {} : { application_id: v.application_id }),
    ...(v.title.trim() ? { title: v.title.trim() } : {}),
    interview_type: v.interview_type,
    scheduled_start: instant(v.day, v.starts),
    scheduled_end: instant(v.day, v.ends),
    ...(v.interview_type === "in_person" && v.worksite_id ? { worksite_id: v.worksite_id } : {}),
    ...(v.interview_type === "video" && v.meeting_url.trim() ? { meeting_url: v.meeting_url.trim() } : {}),
    panel_employee_ids: v.panel.map((p) => p.employee_id),
  };
}

/** Only the people who may sit on a panel (they hold Recruitment), 25 at a time, searched by the server. */
function PanelPicker({ value, onChange }: { value: PersonRef[]; onChange: (value: PersonRef[]) => void }) {
  const list = usePaged("GET /api/v1/recruitment/interviews/panelists");
  const photos = usePhotos(list.rows.map((row) => row.photo_url));
  return (
    <PersonPicker
      photo={(person) => photos(person.photo_url)}
      list={{ rows: list.rows, page: list.page, loading: list.loading, error: list.error, q: list.q, setQ: list.setQ }}
      value={value}
      onChange={onChange}
      multiple
    />
  );
}

export function ScheduleForm({ applicationId, interview, close, onSaved }: { applicationId?: string; interview?: InterviewDetail; close: () => void; onSaved?: (x: InterviewDetail) => void }) {
  const at = interview ? lagos(interview.scheduled_start) : null;
  const f = useContractForm<Values>(
    {
      application_id: interview?.application_id ?? applicationId ?? "",
      title: interview?.round.title ?? "",
      interview_type: interview?.interview_type ?? "video",
      day: at?.day ?? "",
      starts: at?.time ?? "10:00",
      ends: interview ? lagos(interview.scheduled_end).time : "11:00",
      worksite_id: interview?.worksite?.worksite_id ?? "",
      meeting_url: interview?.meeting_url ?? "",
      panel: interview ? interview.panel.map((s) => s.panelist) : [],
    },
    bodySchema<Values>(interview ? interviewSchemas.InterviewReschedule : interviewSchemas.InterviewSchedule, (v) => bodyOf(v, Boolean(interview)), RENAME),
  );
  // Searched on the server as the person types (25 at a time), so a candidate past the first page is found.
  const candidates = usePaged("GET /api/v1/recruitment/candidates", { filters: { status: "active" }, enabled: !applicationId && !interview });
  const [picked, setPicked] = useState<(typeof candidates.rows)[number][]>([]);
  const sites = useInfinite("GET /api/v1/worksites", { enabled: f.values.interview_type === "in_person" });
  const create = useMutation("POST /api/v1/recruitment/interviews");
  const patch = useMutation("PATCH /api/v1/recruitment/interviews/:id");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      const body = bodyOf(f.values, Boolean(interview));
      const saved = interview
        ? await patch.run({ params: { id: interview.interview_id }, body: body as never })
        : await create.run({ body: body as never });
      invalidate("/api/v1/recruitment/interviews");
      invalidate("/api/v1/recruitment/candidates");
      close();
      toast(interview ? "Interview moved. Everyone is told" : `Interview set with ${saved.candidate_name}`);
      onSaved?.(saved);
    } catch (e) {
      sayRefusal(e instanceof ApiError ? Object.assign(e, { fields: renamed(e.fields, RENAME) }) : e, f, setProblem);
      // Someone on the panel cannot sit on it: the line under the form says who.
      if (e instanceof ApiError && e.code === "NOT_PANELISTS") setProblem(e.message);
    }
  };
  const type = f.values.interview_type;
  return (
    <>
      {!applicationId && !interview && (
        <Field label="Candidate" {...f.status("application_id")}>
          <RecordPicker
            list={{ rows: candidates.rows, page: candidates.page, loading: candidates.loading, error: candidates.error, q: candidates.q, setQ: candidates.setQ }}
            value={picked}
            onChange={(rows) => {
              setPicked(rows);
              f.set("application_id", rows[0]?.application_id ?? "");
            }}
            id={(c) => c.application_id}
            title={(c) => c.name}
            sub={(c) => c.vacancy.title}
            placeholder="Search candidates"
          />
        </Field>
      )}
      <Grid cols={2}>
        <Field label="How" {...f.status("interview_type")}>
          <ChoiceField options={TYPES} {...f.field("interview_type")} />
        </Field>
        <Field label="Round Name" optional {...f.status("title")}>
          <TextField {...f.field("title")} placeholder="Interview 1" maxLength={120} />
        </Field>
      </Grid>
      {type === "in_person" && (
        <Field label="Worksite" {...f.status("worksite_id")}>
          <SelectField options={sites.rows.map((w) => [w.worksite_id, w.name] as [string, string])} placeholder="Pick the office" {...paging(sites)} {...f.field("worksite_id")} />
        </Field>
      )}
      {type === "video" && (
        <Field label="Meeting Link" {...f.status("meeting_url")}>
          <TextField {...f.field("meeting_url")} placeholder="https://meet.google.com/…" maxLength={500} />
        </Field>
      )}
      <Grid cols={3}>
        <Field label="Day" {...f.status("day")}>
          <DateField {...f.field("day")} min={todayIso()} />
        </Field>
        <Field label="Starts" {...f.status("starts")}>
          <TimeField {...f.field("starts")} />
        </Field>
        <Field label="Ends" {...f.status("ends")}>
          <TimeField {...f.field("ends")} />
        </Field>
      </Grid>
      <Field label="Panel" {...f.status("panel")}>
        <PanelPicker value={f.values.panel} onChange={(p) => f.set("panel", p)} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{interview ? "Reschedule" : "Schedule Interview"}</Button>
      </FormFooter>
    </>
  );
}

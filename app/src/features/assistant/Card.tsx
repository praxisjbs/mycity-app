import { useCallback, useState } from "react";
import { api, ApiError } from "@/api/client";
import { refresh } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useMe } from "@/auth/AuthProvider";
import { useFreshSignIn, type ConfirmedWay } from "@/auth/FreshSignIn";
import { createPasskey, passkeyCancelled, passkeyProblem, passkeysWork } from "@/auth/passkey";
import { schemas, type AiActionCard, type AiActionResult, type Department } from "@mycity/contract/contract.gen.ts";
import { LeaveTypeSelect } from "@/features/people/Leave";
import { ColleaguePicker, DepartmentPicker, EmployeePicker, PartnerDealPicker, PartnerRecordPicker, PolicyPicker, ProjectPicker, TaskPeoplePicker, TaskPicker, WorksitePicker, type PartnerDealChoice, type PartnerRecordChoice, type PolicyChoice, type ProjectChoice, type TaskChoice, type WorksiteChoice } from "@/features/shared/pickers";
import { places } from "@/features/shared/places";
import { hrefFor } from "@/lib/routes";
import { useRouter } from "@/lib/router";
import { ActionCard, AddressField, toast, todayIso, type CardField, type ActionCardPicker, type CardRecord, type ContractSchema } from "@mycity/ui";

/**
 * An answer's action card, wired to the API (docs/guides/praxis-ai.md §6.11): the card as the API
 * drew it, Edit re-validated with PUT /ai/cards/:id, the press through POST /ai/cards/:id/confirm
 * with an Idempotency-Key, Cancel, and Draw It Again (the question asked afresh). A sensitive
 * class (decision 11) is pressed through Confirm It's You: the API answers 403 REAUTH_REQUIRED,
 * the person confirms (a passkey first, else the PIN, else the password) and the press goes
 * again. A person who confirmed with the PIN or the password and has no passkey is offered Set
 * Passkey once on this device.
 */

/** The key under which this device remembers that Set Passkey was offered. */
export const PASSKEY_OFFERED = "praxis-ai:passkey-offered";

/** Refusals a screen answers: the press names the screen that makes it possible. */
const SCREEN_FOR: Record<string, { label: string; href: string }> = {
  NO_MAILBOX: { label: "Open Mailbox", href: hrefFor("mailbox", "inbox") },
  MAIL_AUTH_FAILED: { label: "Open Mailbox", href: hrefFor("mailbox", "inbox") },
  // A query's letter is signed with the signature the person draws by hand: Letter Templates opens Edit Signature.
  NO_SIGNATURE: { label: "Draw Signature", href: hrefFor("queries", "letter-templates", { action: "signature" }) },
};

/** The action's contract schema, by the name the card carries ("tasks.TaskCreate"); undefined when the build lacks it. */
export function schemaOf(name: string): ContractSchema | undefined {
  const [domain, schema] = name.split(".");
  const group = (schemas as Record<string, Record<string, unknown>>)[domain ?? ""];
  const found = group?.[schema ?? ""];
  return found && typeof (found as ContractSchema).safeParse === "function" ? (found as ContractSchema) : undefined;
}

const offered = () => {
  try {
    return localStorage.getItem(PASSKEY_OFFERED) === "1";
  } catch {
    return true;
  }
};
const remember = () => {
  try {
    localStorage.setItem(PASSKEY_OFFERED, "1");
  } catch {
    /* a browser with no storage: the offer is made again next time */
  }
};

/** Set Passkey, offered once to a person who confirmed another way and has none (decision 11). */
async function offerPasskey(way: ConfirmedWay) {
  if (way === "passkey" || offered() || !passkeysWork()) return;
  const methods = await api.call("GET /api/v1/security").catch(() => null);
  if (!methods || methods.passkeys > 0) return;
  remember();
  toast.info("Set a passkey for next time", {
    action: {
      label: "Set Passkey",
      onClick: () => void setPasskey(),
    },
  });
}

async function setPasskey() {
  try {
    const start = await api.call("POST /api/v1/security/passkeys/options", { body: {} });
    const credential = await createPasskey(start.options);
    await api.call("POST /api/v1/security/passkeys", { body: { challenge_token: start.challenge_token, credential } });
    toast("Passkey added");
  } catch (e) {
    if (passkeyCancelled(e)) return;
    toast.error(e instanceof ApiError ? e.message : passkeyProblem(e));
  }
}

/** A card's ids as the pickers take them: one, or the list. */
const idsIn = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : typeof v === "string" && v ? [v] : []);

/**
 * Edit's picker for one id field of a card (docs/guides/praxis-ai.md decision 31), bound as the
 * screen's own form binds it: whom a task may be set for or shared with (New Task's), anyone with a
 * login (New Event's and Add Watcher's), a department (for a reader who may view People, as New Task
 * offers it), an active project, a leave type with what is left of this year (Request Leave's own
 * list, decision 32), a task the person can see (Wait On Task's own list), someone on People's
 * register (the employee pickers of People's forms), a worksite in use, a policy a query or rule may
 * cite, a place picked as every address is (AddressField, F27: the card holds the place's token),
 * and the people Add Work Site may put on a site, the person included. What is already picked
 * reads by the name the card carries; a pick made here keeps its own, until Save Changes has the
 * server name it again.
 */
function CardPick({ field, value, onChange, names }: { field: CardField; value: unknown; onChange: (value: unknown) => void; names: CardRecord[] }) {
  const many = field.kind === "list";
  const ids = idsIn(value);
  const nameOf = (id: string) => names.find((n) => n.id === id)?.label ?? id;
  const [people, setPeople] = useState<PersonRef[]>(() => ids.map((id) => ({ employee_id: id, display_name: nameOf(id) })));
  const [departments, setDepartments] = useState<Department[]>(() => ids.map((id) => ({ department_id: id, name: nameOf(id) }) as unknown as Department));
  const [projects, setProjects] = useState<ProjectChoice[]>(() => ids.map((id) => ({ project_id: id, number: "", name: nameOf(id) })));
  const [tasks, setTasks] = useState<TaskChoice[]>(() => ids.map((id) => ({ task_id: id, number: "", title: nameOf(id) })));
  const [worksites, setWorksites] = useState<WorksiteChoice[]>(() => ids.map((id) => ({ worksite_id: id, name: nameOf(id), code: "" })));
  const [policies, setPolicies] = useState<PolicyChoice[]>(() => ids.map((id) => ({ policy_id: id, number: "", title: nameOf(id) })));
  const [records, setRecords] = useState<PartnerRecordChoice[]>(() => ids.map((id) => ({ id, number: "", name: nameOf(id) })));
  const [deals, setDeals] = useState<PartnerDealChoice[]>(() => ids.map((id) => ({ deal_id: id, number: "", title: nameOf(id) })));
  const set = (picked: string[]) => onChange(many ? picked : (picked[0] ?? null));
  const pickPeople = (p: PersonRef[]) => (setPeople(p), set(p.map((x) => x.employee_id)));
  switch (field.picks) {
    case "task_assignee":
      return <TaskPeoplePicker value={people} onChange={pickPeople} />;
    case "task_member":
      return <TaskPeoplePicker shared value={people} onChange={pickPeople} multiple />;
    case "colleague":
      return <ColleaguePicker value={people} onChange={pickPeople} multiple={many} placeholder="Search staff" />;
    case "department":
      return <DepartmentPicker value={departments} onChange={(d) => (setDepartments(d), set(d.map((x) => x.department_id)))} />;
    case "project":
      return <ProjectPicker value={projects} onChange={(p) => (setProjects(p), set(p.map((x) => x.project_id)))} />;
    case "leave_type":
      return <LeaveTypeSelect year={Number(todayIso().slice(0, 4))} value={ids[0] ?? ""} onChange={(v) => set(v ? [v] : [])} />;
    case "task":
      return <TaskPicker value={tasks} onChange={(t) => (setTasks(t), set(t.map((x) => x.task_id)))} />;
    case "employee":
      return <EmployeePicker value={people} onChange={pickPeople} multiple={many} filters={{ status: "active" }} placeholder="Search staff" />;
    case "site_member":
      return <ColleaguePicker value={people} onChange={pickPeople} multiple withSelf placeholder="Search people" />;
    case "worksite":
      return <WorksitePicker value={worksites} onChange={(w) => (setWorksites(w), set(w.map((x) => x.worksite_id)))} />;
    case "policy":
      return <PolicyPicker value={policies} onChange={(p) => (setPolicies(p), set(p.map((x) => x.policy_id)))} />;
    case "partner":
    case "lead":
      return <PartnerRecordPicker kind={field.picks} value={records} onChange={(r) => (setRecords(r), set(r.map((x) => x.id)))} />;
    case "partner_deal":
      return <PartnerDealPicker value={deals} onChange={(d) => (setDeals(d), set(d.map((x) => x.deal_id)))} />;
    case "place":
      // The card holds the place's token alone; a device location while search is down holds none, so the field asks again.
      return <AddressField value={ids[0] ? { token: ids[0] } : null} onChange={(v) => set(v?.token ? [v.token] : [])} places={places} />;
    default:
      return null;
  }
}

export function AnswerCard({ card: drawn, onRedraw }: { card: AiActionCard; onRedraw?: () => Promise<unknown> | undefined }) {
  const { navigate } = useRouter();
  const [card, setCard] = useState<AiActionCard>(drawn);
  const [problem, setProblem] = useState<{ message: string; code: string } | null>(null);
  const fresh = useFreshSignIn({ onConfirmed: (way) => void offerPasskey(way) });
  const id = card.ai_action_draft_id;
  const peopleView = Boolean(useMe().grants.people?.includes("view"));
  // A department is picked by a reader who may view People, as on New Task; for anyone else it stays as drawn.
  const picker: ActionCardPicker = ({ field, value, onChange, names }) =>
    !field.picks || (field.picks === "department" && !peopleView) ? null : <CardPick key={field.name} field={field} value={value} onChange={onChange} names={names} />;

  const refused = useCallback(
    (e: unknown) => {
      const err = e instanceof ApiError ? e : new ApiError(0, null);
      if (err.status === 409 && err.code === "CARD_EXPIRED") setCard((c) => ({ ...c, status: "expired" }));
      else if (err.status === 409 && (err.code === "CARD_DONE" || err.code === "CARD_RUNNING" || err.code === "CARD_CANCELLED")) void api.call("GET /api/v1/ai/cards/:id", { params: { id } }).then(setCard, () => undefined);
      if (Object.keys(err.fields).length) setCard((c) => ({ ...c, problems: Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v ?? []])) }));
      setProblem({ message: err.message || "Could not reach the server", code: err.code });
    },
    [id],
  );

  const save = async (values: Record<string, unknown>) => {
    setProblem(null);
    try {
      setCard(await api.call("PUT /api/v1/ai/cards/:id", { params: { id }, body: { values } }));
    } catch (e) {
      refused(e);
    }
  };

  const press = async () => {
    setProblem(null);
    const key = crypto.randomUUID();
    try {
      const result: AiActionResult | undefined = await fresh.guard(() => api.call("POST /api/v1/ai/cards/:id/confirm", { params: { id }, body: {}, idempotencyKey: key }));
      if (!result) return;
      setCard((c) => ({ ...c, status: result.status, result, problems: {} }));
      // The screen underneath (a board, a list) shows the change in place, quietly (F28).
      void refresh("/api/v1");
    } catch (e) {
      refused(e);
    }
  };

  const cancel = async () => {
    setProblem(null);
    try {
      setCard(await api.call("POST /api/v1/ai/cards/:id/cancel", { params: { id }, body: {} }));
    } catch (e) {
      refused(e);
    }
  };

  const screen = problem ? SCREEN_FOR[problem.code] : undefined;
  return (
    <ActionCard
      label={card.label}
      fields={card.fields}
      values={card.values}
      problems={card.problems}
      records={card.records}
      names={card.names}
      picker={picker}
      status={card.status}
      confirm={card.confirm}
      suggested={card.suggested}
      result={card.result}
      schema={schemaOf(card.schema)}
      onConfirm={press}
      onCancel={cancel}
      onSave={save}
      onRedraw={onRedraw}
      onOpen={navigate}
      problem={problem?.message ?? null}
      problemAction={screen ? { label: screen.label, onPress: () => navigate(screen.href) } : null}
    />
  );
}

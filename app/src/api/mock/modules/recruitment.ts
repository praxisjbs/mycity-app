import type { Assessment, Candidate, CandidateDetail, InterviewDetail, OfferRow, OnboardingDetail, PoolRow, Stage, Vacancy } from "@/api/types/recruitment";
import type { Status } from "@/api/types/performance";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid } from "../core";
import { byId, refKey } from "../data/people";

const S = (tone: Status["tone"], text: string): Status => ({ tone, text });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const VAC: Vacancy[] = [
  ["Content Producer", "Content", 1, "Lagos · Hybrid", 24, 23, false, "Offer, 2 days", "Chiamaka Eze to sign by the 22nd"],
  ["Partnerships Associate", "Marketing & Sales", 1, "Lagos · Hybrid", 19, 20, false, "Interview, 5 days", "Third panellist to submit"],
  ["Backend Engineer", "Engineering", 2, "Remote", 14, 17, false, "Assessment, 3 days", "Fatima Sani interview on Friday"],
  ["Customer Support Lead", "Support", 1, "Abuja · On site", 4, 10, true, "Paused", "Resume when the Abuja hub is staffed"],
].map((v, i) => ({ vacancy_id: sid(`vac:${i}`), title: v[0] as string, department: v[1] as string, openings: v[2] as number, location: v[3] as string, applicants: v[4] as number, published_on: isoDaysAgo(v[5] as number), paused: v[6] as boolean, status: v[6] ? S("warn", "Paused") : S("ok", "Open"), days_open: v[5] as number, stage_note: v[7] as string, next_step: v[8] as string, public_url: `go.mycityapp.io/jobs/${slug(v[0] as string)}` }));
const vref = (i: number) => ({ vacancy_id: VAC[i].vacancy_id, title: VAC[i].title });

type C = CandidateDetail;
const CHIP: Record<Stage, (c: C) => Status> = {
  applied: (c) => S("info", `${c.score}%`), shortlisted: (c) => (c.assessments ? S("ok", `Scored ${c.score}`) : S("warn", "In test")), interview: (c) => (c.weighted_total ? S("ok", "Panel done") : S("warn", "Panel 2 of 3")),
  offer: () => S("warn", "Offer sent"), hired: () => S("ok", "Hired"), rejected: () => S("neutral", "Not progressed"),
};
const NEXT: Record<Stage, Stage[]> = { applied: ["shortlisted", "rejected"], shortlisted: ["interview", "rejected"], interview: ["offer", "rejected"], offer: ["hired", "rejected"], hired: [], rejected: ["applied"] };
const CANDS: C[] = [
  ["Ifeanyi Madu", 0, "applied", 72, true, null, null, null, 9],
  ["Zainab Bello", 2, "applied", 68, true, null, null, null, 8],
  ["Kelechi Umeh", 1, "applied", 64, true, null, null, null, 6],
  ["Tola Bankole", 0, "applied", 59, true, null, null, null, 5],
  ["Ruth Danjuma", 3, "applied", 70, false, null, null, null, 4],
  ["Fatima Sani", 2, "shortlisted", 77, false, null, null, null, 14],
  ["Olumide Craig", 0, "shortlisted", 81, false, "Psychometric 79, case study 83", null, null, 18],
  ["Adaeze Nnamdi", 1, "interview", 78, true, "Psychometric 84, case study 88", "Monday at 11:00, three panellists", null, 19],
  ["Yusuf Garba", 3, "interview", 74, false, "Psychometric 71", "Last week, two panellists", 76, 10],
  ["Chiamaka Eze", 0, "offer", 83, false, "Psychometric 80, case study 86", "Done, three panellists", 84, 22],
  ["Obinna Chukwu", 0, "hired", 79, false, "Psychometric 77, case study 80", "Done", 80, 60],
  ["Rita Ademola", 1, "rejected", 66, false, "Psychometric 70", "Done", 68, 40],
].map((c, i) => {
  const x: C = { candidate_id: sid(`cand:${i}`), name: c[0] as string, vacancy: vref(c[1] as number), stage: c[2] as Stage, score: c[3] as number, score_provisional: c[4] as boolean, chip: S("neutral", ""), email: `${slug(c[0] as string).replace("-", ".")}@example.com`, applied_on: isoDaysAgo(c[8] as number), source: "Careers page", assessments: c[5] as string | null, interview: c[6] as string | null, weighted_total: c[7] as number | null, next_stages: [] };
  return x;
});
const out = (c: C): C => ({ ...c, chip: CHIP[c.stage](c), next_stages: NEXT[c.stage] });
const row = (c: C): Candidate => {
  const o = out(c);
  return { candidate_id: o.candidate_id, name: o.name, vacancy: o.vacancy, stage: o.stage, score: o.score, score_provisional: o.score_provisional, chip: o.chip };
};

route("GET /api/v1/recruitment/vacancies/summary", () =>
  ok({
    open: VAC.filter((v) => !v.paused).length, applicants: VAC.reduce((s, v) => s + v.applicants, 0), in_interview: CANDS.filter((c) => c.stage === "interview").length, offers_out: CANDS.filter((c) => c.stage === "offer").length,
    funnel: [{ label: "Applied", pct: 100, value: "61" }, { label: "Screened", pct: 72, value: "44" }, { label: "Assessed", pct: 51, value: "31" }, { label: "Shortlisted", pct: 21, value: "13" }, { label: "Interviewed", pct: 11, value: "7" }, { label: "Offered", pct: 3, value: "2", emphasis: "brand" }],
    funnel_note: "Thirty of sixty-one dropped at screening. The AI score ranks them; a person decides.",
  }),
);
route("GET /api/v1/recruitment/vacancies", (req) => paged(VAC, req, { search: (v) => [v.title, v.department, v.location], filters: { status: (v, s) => (s === "paused" ? v.paused : !v.paused) } }));
route("POST /api/v1/recruitment/vacancies", (req) => {
  const b = req.body as Record<string, string | number>;
  const f: Record<string, string[]> = {};
  if (!b.title || String(b.title).trim().length < 3) f.title = ["Name the role"];
  if (!b.department) f.department = ["Pick the department"];
  if (!(Number(b.openings) >= 1)) f.openings = ["At least one opening"];
  if (!b.location) f.location = ["Where is the role based"];
  if (!b.closes_on) f.closes_on = ["Pick the closing date"];
  if (!b.description || String(b.description).trim().length < 40) f.description = ["Describe the role (40 characters or more)"];
  if (Object.keys(f).length) return invalid(f);
  const arr = { on_site: "On Site", hybrid: "Hybrid", remote: "Remote" }[String(b.arrangement)] ?? "Hybrid";
  const v: Vacancy = { vacancy_id: sid(`vac:new:${VAC.length}`), title: String(b.title).trim(), department: String(b.department), openings: Number(b.openings), location: `${b.location} · ${arr}`, applicants: 0, published_on: isoDaysAgo(0), paused: false, status: S("ok", "Open"), days_open: 0, stage_note: "Published today", next_step: "Applications open on the careers page", public_url: `go.mycityapp.io/jobs/${slug(String(b.title))}` };
  VAC.unshift(v);
  return created(v);
});
const flip = (paused: boolean) => (req: { params: Record<string, string> }) => {
  const v = VAC.find((x) => x.vacancy_id === req.params.id);
  if (!v) return notFound();
  v.paused = paused;
  v.status = paused ? S("warn", "Paused") : S("ok", "Open");
  v.stage_note = paused ? "Paused" : "Open again";
  return ok(v);
};
route("POST /api/v1/recruitment/vacancies/:id/pause", flip(true));
route("POST /api/v1/recruitment/vacancies/:id/resume", flip(false));

route("GET /api/v1/recruitment/candidates/summary", () =>
  ok({
    candidates: 61, in_board: CANDS.filter((c) => ["applied", "shortlisted", "interview", "offer"].includes(c.stage)).length, awaiting_human: CANDS.filter((c) => c.score_provisional).length, average_score: 71,
    distribution: [{ label: "80 and Above", pct: 18, value: "11" }, { label: "70 to 79", pct: 31, value: "19" }, { label: "60 to 69", pct: 26, value: "16" }, { label: "50 to 59", pct: 16, value: "10" }, { label: "Below 50", pct: 8, value: "5", emphasis: "warn" }],
    distribution_note: "Screening reads the application form: years, location, salary expectation, must-have answers.",
  }),
);
route("GET /api/v1/recruitment/candidates", (req) => paged(CANDS.map(row), req, { search: (c) => [c.name, c.vacancy.title], filters: { stage: (c, v) => c.stage === v, vacancy_id: (c, v) => c.vacancy.vacancy_id === v } }));
route("GET /api/v1/recruitment/candidates/:id", (req) => {
  const c = CANDS.find((x) => x.candidate_id === req.params.id);
  if (!c) return notFound();
  c.score_provisional = false; /* opening the record counts as a person reading the CV */
  return ok(out(c));
});
route("POST /api/v1/recruitment/candidates", (req) => {
  const b = req.body as { name?: string; email?: string; vacancy_id?: string };
  const v = VAC.find((x) => x.vacancy_id === b.vacancy_id);
  const f: Record<string, string[]> = {};
  if (!b.name || b.name.trim().length < 3) f.name = ["Enter the full name"];
  if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email)) f.email = ["Enter a valid email"];
  if (!v) f.vacancy_id = ["Pick the vacancy"];
  if (Object.keys(f).length) return invalid(f);
  const c: C = { candidate_id: sid(`cand:new:${CANDS.length}`), name: b.name!.trim(), vacancy: { vacancy_id: v!.vacancy_id, title: v!.title }, stage: "applied", score: null, score_provisional: true, chip: S("neutral", ""), email: b.email!, applied_on: isoDaysAgo(0), source: "Added by a recruiter", assessments: null, interview: null, weighted_total: null, next_stages: [] };
  CANDS.unshift(c);
  v!.applicants += 1;
  return created({ ...out(c), chip: S("neutral", "Not scored") });
});
route("POST /api/v1/recruitment/candidates/:id/move", (req) => {
  const c = CANDS.find((x) => x.candidate_id === req.params.id);
  if (!c) return notFound();
  const to = String(req.body.stage) as Stage;
  if (!NEXT[c.stage].includes(to)) return fail(409, "STAGE_SKIPPED", `A candidate moves from ${c.stage} to ${NEXT[c.stage].join(" or ") || "nowhere"}, not to ${to}.`);
  if (to === "rejected" && !String(req.body.reason ?? "").trim()) return invalid({ reason: ["Say why, for the record and the candidate's email"] });
  c.stage = to;
  return ok(out(c));
});
route("POST /api/v1/recruitment/candidates/:id/pool", (req) => {
  const c = CANDS.find((x) => x.candidate_id === req.params.id);
  if (!c) return notFound();
  const p: PoolRow = { pool_id: sid(`pool:${c.candidate_id}`), name: c.name, applied_for: c.vacancy.title, score: c.score ?? 0, added_on: isoDaysAgo(0), reason: String(req.body.reason ?? "Strong, wrong moment"), invited: false };
  POOL.unshift(p);
  return created(p);
});

const ASSESS: Assessment[] = [
  ["Numerical reasoning", "All roles", "Psychometric", 25, 31, 68], ["Situational judgement", "All roles", "Psychometric", 20, 31, 74], ["Node and SQL", "Backend Engineer", "Technical", 60, 9, 61],
  ["Partnership brief", "Partnerships Associate", "Case study", 90, 7, 79], ["Content calendar", "Content Producer", "Case study", 60, 11, 72],
].map((a, i) => ({ assessment_id: sid(`asm:${i}`), name: a[0] as string, role: a[1] as string, kind: a[2] as Assessment["kind"], duration_min: a[3] as number, candidates: a[4] as number, average_score: a[5] as number, status: S("ok", "Active") }));
route("GET /api/v1/recruitment/assessments/summary", () => ok({ assessments: ASSESS.length, taken: 31, average_score: 71, abandoned: 2, by_assessment: [...ASSESS].sort((a, b) => (b.average_score ?? 0) - (a.average_score ?? 0)).map((a) => ({ label: a.name, pct: a.average_score ?? 0, value: String(a.average_score ?? "None"), ...(a.name === "Node and SQL" ? { emphasis: "warn" as const } : {}) })), by_assessment_note: "Node and SQL is the hardest and the most discriminating. That is by design, not a problem to fix." }));
route("GET /api/v1/recruitment/assessments", (req) => paged(ASSESS, req, { search: (a) => [a.name, a.role, a.kind] }));
route("POST /api/v1/recruitment/assessments", (req) => {
  const b = req.body as { name?: string; role?: string; kind?: string; duration_min?: number };
  const f: Record<string, string[]> = {};
  if (!b.name || b.name.trim().length < 3) f.name = ["Name the assessment"];
  if (!b.role) f.role = ["Which roles take it"];
  if (!(Number(b.duration_min) >= 5)) f.duration_min = ["At least 5 minutes"];
  if (Object.keys(f).length) return invalid(f);
  const a: Assessment = { assessment_id: sid(`asm:new:${ASSESS.length}`), name: b.name!.trim(), role: b.role!, kind: (b.kind as Assessment["kind"]) ?? "Psychometric", duration_min: Number(b.duration_min), candidates: 0, average_score: null, status: S("neutral", "Draft") };
  ASSESS.push(a);
  return created(a);
});

const INT: InterviewDetail[] = [
  { candidate: "Adaeze Nnamdi", role: "Partnerships Associate", at: at(-3, "11:00"), panel_size: 3, round: S("warn", "2 of 3 submitted"), panel: [{ panellist: refKey("cynthia"), submitted: true, score: 84, sealed: false }, { panellist: refKey("ngozi"), submitted: true, score: null, sealed: true }, { panellist: refKey("seyi"), submitted: false, score: null, sealed: false }] },
  { candidate: "Yusuf Garba", role: "Customer Support Lead", at: at(6, "14:00"), panel_size: 2, round: S("ok", "Closed"), panel: [{ panellist: refKey("cynthia"), submitted: true, score: 78, sealed: false }, { panellist: refKey("hauwa"), submitted: true, score: 74, sealed: false }] },
  { candidate: "Fatima Sani", role: "Backend Engineer", at: at(-2, "10:00"), panel_size: 3, round: S("neutral", "Scheduled"), panel: [{ panellist: refKey("seyi"), submitted: false, score: null, sealed: false }, { panellist: refKey("obinna"), submitted: false, score: null, sealed: false }, { panellist: refKey("cynthia"), submitted: false, score: null, sealed: false }] },
].map((x, i) => ({
  interview_id: sid(`int:${i}`), ...x,
  scorecard: [{ label: "Screening", pct: 78, value: "15%" }, { label: "Psychometric", pct: 84, value: "15%" }, { label: "Technical", pct: 69, value: "25%" }, { label: "Case Study", pct: 88, value: "20%" }, { label: "Interview", pct: 84, value: "25%", emphasis: "brand" as const }],
  activity: [
    { title: "Cynthia Osakunih submitted, 84", when: at(6, "16:40"), text: "Score sealed until the round closes.", tone: "ok" as const },
    { title: "Ngozi Eze submitted", when: at(6, "17:12"), text: "Score sealed.", tone: "ok" as const },
    { title: "Seyi Balogun reminded", when: at(5, "09:00"), text: "Five days at this stage. Recruitment SLA alert raised.", tone: "hi" as const },
    { title: "Panel scheduled", when: at(12, "10:00"), text: "Three panellists.", tone: null },
  ],
  can_consolidate: false,
}));
const intOut = (x: InterviewDetail): InterviewDetail => ({ ...x, can_consolidate: x.round.text !== "Closed" && x.panel.every((p) => p.submitted) });
route("GET /api/v1/recruitment/interviews", (req) => paged(INT.map(({ interview_id, candidate, role, at: when, panel_size, round }) => ({ interview_id, candidate, role, at: when, panel_size, round })), req, { search: (x) => [x.candidate, x.role] }));
route("GET /api/v1/recruitment/interviews/:id", (req) => {
  const x = INT.find((i) => i.interview_id === req.params.id);
  return x ? ok(intOut(x)) : notFound();
});
route("POST /api/v1/recruitment/interviews/:id/consolidate", (req) => {
  const x = INT.find((i) => i.interview_id === req.params.id);
  if (!x) return notFound();
  if (!x.panel.every((p) => p.submitted)) return fail(409, "PANEL_INCOMPLETE", `${x.panel.filter((p) => !p.submitted).map((p) => p.panellist.display_name).join(", ")} has not submitted. The round closes when every panellist has.`);
  x.round = S("ok", "Closed");
  x.panel = x.panel.map((p) => ({ ...p, sealed: false, score: p.score ?? 80 }));
  return ok(intOut(x));
});
route("POST /api/v1/recruitment/interviews", (req) => {
  const b = req.body as { candidate_id?: string; at?: string; panel_ids?: string[] };
  const c = CANDS.find((x) => x.candidate_id === b.candidate_id);
  const f: Record<string, string[]> = {};
  if (!c) f.candidate_id = ["Pick the candidate"];
  if (!b.at || new Date(b.at).getTime() < Date.now()) f.at = ["Pick a time in the future"];
  if (!b.panel_ids?.length) f.panel_ids = ["Add at least one panellist"];
  if (Object.keys(f).length) return invalid(f);
  const x: InterviewDetail = { ...INT[0], interview_id: sid(`int:new:${INT.length}`), candidate: c!.name, role: c!.vacancy.title, at: b.at!, panel_size: b.panel_ids!.length, round: S("neutral", "Scheduled"), panel: b.panel_ids!.map((id) => ({ panellist: refKey(byId(id)?.user_key ?? "cynthia"), submitted: false, score: null, sealed: false })), activity: [{ title: "Panel scheduled", when: new Date().toISOString(), text: `${b.panel_ids!.length} panellists.`, tone: null }] };
  INT.unshift(x);
  if (c!.stage === "shortlisted") c!.stage = "interview";
  return created(x);
});

const OFFERS: OfferRow[] = [
  ["OFF-0018", "Chiamaka Eze", "Content Producer", "480000.00", 8, -7, S("warn", "Awaiting signature")],
  ["OFF-0019", "Yusuf Garba", "Customer Support Lead", "520000.00", null, null, S("neutral", "Draft")],
  ["OFF-0016", "Obinna Chukwu", "Content Producer", "460000.00", 30, 15, S("ok", "Signed")],
  ["OFF-0015", "Rita Ademola", "Partnerships Associate", "440000.00", 38, 23, S("err", "Declined")],
].map((o, i) => ({ offer_id: sid(`off:${i}`), number: o[0] as string, candidate: o[1] as string, role: o[2] as string, salary: o[3] as string, issued_on: o[4] == null ? null : isoDaysAgo(o[4] as number), expires_on: o[5] == null ? null : isoDaysAgo(o[5] as number), status: o[6] as Status }));
route("GET /api/v1/recruitment/offers/summary", () => ok({ awaiting_signature: OFFERS.filter((o) => o.status.text === "Awaiting signature").length, signed_this_year: 11, declined: OFFERS.filter((o) => o.status.tone === "err").length, average_days_to_sign: "2.4 days" }));
route("GET /api/v1/recruitment/offers", (req) => paged(OFFERS, req, { search: (o) => [o.candidate, o.role, o.number] }));
route("GET /api/v1/recruitment/offers/:id/letter", (req) => {
  const o = OFFERS.find((x) => x.offer_id === req.params.id);
  if (!o) return notFound();
  const d = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "on sending");
  const first = o.candidate.split(" ")[0];
  const money = `₦${Number(o.salary).toLocaleString("en-NG")}`;
  return ok({
    reference: o.number, title: "Offer of Employment", date_line: `${o.candidate} · ${o.role} · Issued ${d(o.issued_on)} · Expires ${d(o.expires_on)}`,
    paragraphs: [
      [{ text: "Dear " }, { text: first, filled: true }, { text: "," }],
      [{ text: "We are pleased to offer you the position of " }, { text: o.role, filled: true }, { text: " at MyCity App Ltd, with a start date to be agreed with you." }],
      [{ text: "Your gross monthly salary will be " }, { text: money, filled: true }, { text: ", subject to a probationary period of three months. Working hours are 09:00 to 17:00 Monday to Friday and 09:00 to 15:00 on Saturday." }],
      [{ text: "This offer is conditional upon satisfactory documentation, and expires on " }, { text: d(o.expires_on), filled: true }, { text: "." }],
      [{ text: "Yours sincerely," }],
    ],
    signer: "C. Osakunih", signer_role: "For MyCity App Ltd", fields_note: o.status.text === "Signed" ? "Signed. Payload and stored bytes verified" : `Awaiting signature · go.mycityapp.io/sign/${o.number}`,
  });
});
route("POST /api/v1/recruitment/offers", (req) => {
  const b = req.body as { candidate_id?: string; salary?: string; start_date?: string; expires_on?: string };
  const c = CANDS.find((x) => x.candidate_id === b.candidate_id);
  const f: Record<string, string[]> = {};
  if (!c) f.candidate_id = ["Pick the candidate"];
  if (!(Number(b.salary) > 0)) f.salary = ["Enter the gross monthly salary"];
  if (!b.start_date) f.start_date = ["Pick the start date"];
  if (!b.expires_on) f.expires_on = ["Pick when the offer expires"];
  if (Object.keys(f).length) return invalid(f);
  const n = Math.max(...OFFERS.map((o) => Number(o.number.slice(4)))) + 1;
  const o: OfferRow = { offer_id: sid(`off:new:${n}`), number: `OFF-${String(n).padStart(4, "0")}`, candidate: c!.name, role: c!.vacancy.title, salary: b.salary!, issued_on: null, expires_on: b.expires_on!, status: S("neutral", "Draft") };
  OFFERS.unshift(o);
  return created(o);
});
route("POST /api/v1/recruitment/offers/:id/send", (req) => {
  const o = OFFERS.find((x) => x.offer_id === req.params.id);
  if (!o) return notFound();
  if (o.status.text !== "Draft") return fail(409, "NOT_DRAFT", "Only a draft offer can be sent.");
  o.issued_on = isoDaysAgo(0);
  o.status = S("warn", "Awaiting signature");
  return ok(o);
});

const DOCS = ["Signed offer letter", "Employment contract", "Valid ID", "Passport photograph", "Bank verification number", "Academic certificates", "Data privacy acknowledgement"];
const ONB: OnboardingDetail[] = [
  ["Chiamaka Eze", "Content Producer", isoDaysAhead(5), 4, S("warn", "Documentation")],
  ["Obinna Chukwu", "Content Producer", isoDaysAgo(14), 7, S("ok", "Onboarding")],
  ["Samuel Akpan", "Support Officer", isoDaysAgo(185), 7, S("ok", "Confirmed")],
].map((o, i) => {
  const done = o[3] as number;
  return {
    onboarding_id: sid(`onb:${i}`), name: o[0] as string, role: o[1] as string, start_date: o[2] as string, documents_done: done, documents_total: DOCS.length, stage: o[4] as Status,
    checklist: DOCS.map((d, j) => ({ name: d, status: j < done ? S("ok", "Received") : j < 6 ? S("warn", "Requested") : S("err", "Outstanding") })),
    plan: [["Day 0, pre-onboarding", "Account created, device issued, channels joined"], ["Day 1", "Welcome, handbook, NDPA acknowledgement, clock in set up"], ["Week 1", "Platform walkthrough, meet the six departments"], ["Week 2", "First KPIs assigned by the department manager"], ["Month 3", "Probation decision: confirm or extend"]].map(([title, text], k) => ({ title, text, done: done === DOCS.length ? k < (i === 2 ? 5 : 3) : k === 0 && false })),
  };
});
route("GET /api/v1/recruitment/onboarding/summary", () => ok({ in_progress: ONB.filter((o) => o.stage.text !== "Confirmed").length, blocked: ONB.filter((o) => o.documents_done < o.documents_total).length, starting_this_month: 2, confirmed_90d: 3, chain: [{ label: "Offer Accepted", state: "done" }, { label: "Documentation", state: "now" }, { label: "Pre-Onboarding", state: null }, { label: "Onboarding", state: null }, { label: "Confirmed", state: null }], focus_id: ONB[0].onboarding_id }));
route("GET /api/v1/recruitment/onboarding", (req) => paged(ONB.map(({ checklist, plan, ...r }) => (void checklist, void plan, r)), req, { search: (o) => [o.name, o.role] }));
route("GET /api/v1/recruitment/onboarding/:id", (req) => {
  const o = ONB.find((x) => x.onboarding_id === req.params.id);
  return o ? ok(o) : notFound();
});
route("POST /api/v1/recruitment/onboarding/:id/remind", (req) => {
  const o = ONB.find((x) => x.onboarding_id === req.params.id);
  return o ? ok(o) : notFound();
});

const POOL: PoolRow[] = [
  ["Ngozi Abiola", "Content Producer", 78, 30, "Strong, role filled"], ["Tunde Fashola", "Backend Engineer", 74, 42, "Senior for the level"], ["Blessing Okon", "Partnerships Associate", 71, 47, "Relocating next year"],
].map((p, i) => ({ pool_id: sid(`pool:${i}`), name: p[0] as string, applied_for: p[1] as string, score: p[2] as number, added_on: isoDaysAgo(p[3] as number), reason: p[4] as string, invited: false }));
route("GET /api/v1/recruitment/pool/summary", () => ok({ in_pool: POOL.length, invited_back: POOL.filter((p) => p.invited).length + 1, hired_from_pool: 1, average_score: Math.round(POOL.reduce((s, p) => s + p.score, 0) / Math.max(1, POOL.length)) }));
route("GET /api/v1/recruitment/pool", (req) => paged(POOL, req, { search: (p) => [p.name, p.applied_for, p.reason] }));
route("POST /api/v1/recruitment/pool/:id/invite", (req) => {
  const p = POOL.find((x) => x.pool_id === req.params.id);
  if (!p) return notFound();
  const v = VAC.find((x) => x.vacancy_id === req.body.vacancy_id);
  if (!v) return invalid({ vacancy_id: ["Pick the vacancy to invite them to"] });
  if (v.paused) return fail(409, "VACANCY_PAUSED", "That vacancy is paused. Resume it first.");
  p.invited = true;
  return ok(p);
});

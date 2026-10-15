import type { ApplicationBody, AssessmentQuestion, AssessmentSession, OfferToSign, Vacancy, VacancyCard, VerifyResult } from "@/api/types/public";
import { created, fail, inDays, inMinutes, invalid, ok, paged, route } from "./core";

/**
 * Fixtures for the public pages. The roles, people and offer numbers are the
 * staff app's own mock (app/src/api/mock/modules/recruitment.ts), so a demo can
 * follow one candidate from the careers page to a signed, verified offer.
 */

/* ── Vacancies ── */
const VACANCIES: Vacancy[] = [
  {
    slug: "content-producer", title: "Content Producer", department: "Content", location: "Lagos, Nigeria", work_pattern: "hybrid", work_pattern_note: "3 days on site",
    employment_type: "Full time", probation_months: 3, reports_to: "Head of Content", salary_min: "400000.00", salary_max: "520000.00",
    summary: "You will plan, shoot and publish the stories that show people what is on in their city this week. Video first, written second, always on time.",
    must_have: "Two years producing short-form video for a brand or a publisher. A portfolio we can watch. Comfortable on a set and in an edit.",
    nice_to_have: "Experience covering live events. Yoruba or Igbo for voice-overs.",
    how_we_hire: "Application, then a numerical reasoning test and a content calendar case study, then a panel of three. We will tell you where you are at each step.",
    applicants: 24, state: "open",
  },
  {
    slug: "partnerships-associate", title: "Partnerships Associate", department: "Marketing & Sales", location: "Lagos, Nigeria", work_pattern: "hybrid", work_pattern_note: "4 days on site",
    employment_type: "Full time", probation_months: 3, reports_to: "Operations", salary_min: "500000.00", salary_max: "700000.00",
    summary: "You will build and hold the relationships that put MyCityApp in front of millions of Nigerians. Working with brands, government and venues across Lagos and beyond.",
    must_have: "A degree in management, marketing or business. Fluent English. Four years in partnerships or business development. Comfortable in a room with a commissioner and a brand manager on the same afternoon.",
    nice_to_have: "Experience in telecoms, banking or hospitality partnerships. A network in Lagos State government.",
    how_we_hire: "Application, then two psychometric assessments and a case study, then a panel of three. We will tell you where you are at each step.",
    applicants: 19, state: "open",
  },
  {
    slug: "backend-engineer", title: "Backend Engineer", department: "Engineering", location: "Anywhere in Nigeria", work_pattern: "remote", work_pattern_note: null,
    employment_type: "Full time", probation_months: 3, reports_to: "Head of Engineering", salary_min: null, salary_max: null,
    summary: "You will build the services behind the app: listings, bookings, payments and the data that keeps them honest. Node, Postgres and a lot of care.",
    must_have: "Three years of Node.js in production. Real SQL, not only an ORM. You have been on call for something you built.",
    nice_to_have: "Payments in Nigeria. Redis and queues. Writing that other engineers enjoy reading.",
    how_we_hire: "Application, then a technical assessment in Node and SQL, then a panel of three. We will tell you where you are at each step.",
    applicants: 14, state: "open",
  },
  {
    slug: "studio-assistant", title: "Studio Assistant", department: "Studio", location: "Lagos, Nigeria", work_pattern: "on_site", work_pattern_note: null,
    employment_type: "Contract, 6 months", probation_months: null, reports_to: "Studio Manager", salary_min: "180000.00", salary_max: "220000.00",
    summary: "Keep the studio ready: kit, bookings, call sheets and the hundred small things that make a shoot day work.",
    must_have: "A year on sets or in a studio. Early starts. Careful with expensive equipment.",
    nice_to_have: null,
    how_we_hire: "Application, then a short conversation with the Studio Manager.",
    applicants: 31, state: "paused",
  },
  {
    slug: "customer-support-lead", title: "Customer Support Lead", department: "Support", location: "Abuja, Nigeria", work_pattern: "on_site", work_pattern_note: null,
    employment_type: "Full time", probation_months: 3, reports_to: "Operations", salary_min: "450000.00", salary_max: "560000.00",
    summary: "Lead the team that answers every message our users send, and turn what they tell us into fixes.",
    must_have: "Three years in customer support, one leading a team.",
    nice_to_have: null,
    how_we_hire: "Application, then a situational judgement test, then a panel of two.",
    applicants: 42, state: "filled",
  },
];
const card = (v: Vacancy): VacancyCard => ({ slug: v.slug, title: v.title, department: v.department, location: v.location, work_pattern: v.work_pattern });

/* A paused role leaves the list and keeps its link; a filled one leaves the list and says so. */
route("GET /api/public/v1/jobs", (req) => paged(VACANCIES.filter((v) => v.state === "open").map(card), req, (v) => [v.title, v.department, v.location]));
route("GET /api/public/v1/jobs/:slug", (req) => {
  const v = VACANCIES.find((x) => x.slug === req.params.slug);
  /* An unpublished or unknown slug gets the same 404 as nonsense: slugs cannot be walked. */
  return v ? ok(v) : fail(404, "NOT_FOUND", "There is no open role at this address.");
});

/* ── Apply: a one-time, write-only link ── */
type ApplyRow = { vacancy: string; expires_at: string; state: "open" | "submitted" };
const APPLY = new Map<string, ApplyRow>([
  ["k7Qm2TxV9pLa", { vacancy: "Partnerships Associate", expires_at: inDays(2), state: "open" }],
  ["Wn4cR8yHj2Zs", { vacancy: "Content Producer", expires_at: inDays(-3), state: "open" }],
]);
const opaque = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"[b % 56]).join("");

route("POST /api/public/v1/jobs/:slug/apply", (req) => {
  const v = VACANCIES.find((x) => x.slug === req.params.slug);
  if (!v) return fail(404, "NOT_FOUND", "There is no open role at this address.");
  if (v.state !== "open") return fail(409, v.state === "paused" ? "VACANCY_PAUSED" : "VACANCY_FILLED", v.state === "paused" ? "This role is not taking applications right now." : "This role has been filled.");
  const token = opaque();
  APPLY.set(token, { vacancy: v.title, expires_at: inDays(2), state: "open" });
  return created({ token });
});

function applyLink(token: string) {
  const a = APPLY.get(token);
  if (!a) return { err: fail(404, "TOKEN_INVALID", "This link is not valid. Check you opened the whole address from the email.") };
  if (a.state === "submitted") return { err: fail(409, "TOKEN_USED", "This application has already been sent. We will email you within five working days.") };
  if (new Date(a.expires_at).getTime() < Date.now()) return { err: fail(410, "TOKEN_EXPIRED", "This link has expired. Open the role again from the careers page to start a new application.") };
  return { a };
}
route("GET /api/public/v1/apply/:token", (req) => {
  const { a, err } = applyLink(req.params.token);
  return err ?? ok({ vacancy_title: a!.vacancy, expires_at: a!.expires_at, state: a!.state });
});
let applications = 0;
route("POST /api/public/v1/apply/:token", (req) => {
  const { a, err } = applyLink(req.params.token);
  if (err) return err;
  const b = req.body as Partial<ApplicationBody>;
  const e: Record<string, string[]> = {};
  if (String(b.full_name ?? "").trim().split(/\s+/).length < 2) e.full_name = ["Your first and last name"];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email ?? "").trim())) e.email = ["An email address we can reach you at"];
  if (String(b.phone ?? "").replace(/\D/g, "").length < 10) e.phone = ["A phone number with at least 10 digits"];
  if (!Number.isInteger(b.years_experience) || b.years_experience! < 0 || b.years_experience! > 50) e.years_experience = ["A whole number of years"];
  if (!b.cv_document_id) e.cv_document_id = ["Attach your CV"];
  if (String(b.why ?? "").trim().length < 20) e.why = ["A sentence or two, at least 20 characters"];
  if (Object.keys(e).length) return invalid(e);
  a!.state = "submitted";
  applications += 1;
  return created({ reference: `APP-${String(1040 + applications).padStart(4, "0")}`, submitted_at: new Date().toISOString() });
});

/* ── Assessment: the timer runs here, on the "server" ── */
type Sess = Omit<AssessmentSession, "server_now"> & { all: AssessmentQuestion[] };
const tq = (n: number, prompt: string, answer: string | null = null): AssessmentQuestion => ({ question_id: `q${n}`, n, kind: "text", prompt, options: null, answer });
const cq = (n: number, prompt: string, opts: string[]): AssessmentQuestion => ({ question_id: `q${n}`, n, kind: "choice", prompt, options: opts.map((text, i) => ({ id: String.fromCharCode(97 + i), text })), answer: null });
const ASSESS = new Map<string, Sess>([
  ["Hb6tZ3qNw8Rk", {
    candidate_first_name: "Adaeze", vacancy_title: "Partnerships Associate",
    assessment: { title: "Partnership brief", kind: "Case study", duration_min: 90, question_count: 6, instructions: "Six questions about one partnership. Write as you would to a colleague: plain, specific, with numbers where they help. A person reads every answer." },
    state: "in_progress", ends_at: inMinutes(42.3), current: 2, submitted_at: null, questions: null,
    all: [
      tq(1, "Name three kinds of partner that would bring MyCityApp the most new users in Lagos this year, and why each.", "Telcos for reach, banks for trust and payments, and event venues because they bring people who are already out in the city."),
      tq(2, "What would you want to know about a partner before the first meeting? List what you would find out and where.", "Their audience size and who it is, what they have tried with other apps, and who signs. Annual reports, LinkedIn, and anyone we know there."),
      tq(3, "A hotel group wants to list 40 properties on MyCityApp but will not pay a listing fee. Outline the partnership you would propose, and what MyCity gets.", "I would structure it as a revenue share on bookings driven through the app rather than a flat fee..."),
      tq(4, "The hotel group agrees in principle. Write the three terms you would insist on in the MOU."),
      tq(5, "Six months in, bookings are a third of the forecast. What do you look at first, and what do you say to the partner?"),
      tq(6, "Write the two-paragraph email that opens the conversation with the hotel group's commercial director."),
    ],
  }],
  ["Px2mL9vQe4Ty", {
    candidate_first_name: "Fatima", vacancy_title: "Backend Engineer",
    assessment: { title: "Numerical reasoning", kind: "Psychometric", duration_min: 25, question_count: 5, instructions: "Five questions. Pick one answer for each. You can go back and change an answer until you submit or the time runs out. A calculator is fine." },
    state: "not_started", ends_at: null, current: 0, submitted_at: null, questions: null,
    all: [
      cq(1, "A venue sold 1,200 tickets at ₦5,000 and 300 at ₦12,000. What was the total?", ["₦9,600,000", "₦8,400,000", "₦9,000,000", "₦10,200,000"]),
      cq(2, "Bookings rose from 800 to 1,000. By what percentage did they rise?", ["20%", "25%", "80%", "200%"]),
      cq(3, "A partner earns 15% of each ₦20,000 booking. How much do they earn on 40 bookings?", ["₦120,000", "₦80,000", "₦300,000", "₦12,000"]),
      cq(4, "Three staff share ₦450,000 in the ratio 2:3:4. How much is the largest share?", ["₦200,000", "₦150,000", "₦180,000", "₦225,000"]),
      cq(5, "A page loads in 1.6 seconds and must be 25% faster. What is the target?", ["1.2 seconds", "1.4 seconds", "1.0 seconds", "1.25 seconds"]),
    ],
  }],
  ["Jd5sF7aWc3Xe", {
    candidate_first_name: "Obinna", vacancy_title: "Content Producer",
    assessment: { title: "Content calendar", kind: "Case study", duration_min: 60, question_count: 3, instructions: "Three questions about a month of content." },
    state: "submitted", ends_at: null, current: 0, submitted_at: inDays(-6), questions: null, all: [],
  }],
]);
const view = (s: Sess): AssessmentSession => {
  if (s.state === "in_progress" && s.ends_at && new Date(s.ends_at).getTime() <= Date.now()) {
    /* Time is up: what was saved is submitted as it stands. */
    s.state = "timed_out";
    s.submitted_at = s.ends_at;
  }
  const { all, ...rest } = s;
  return { ...rest, server_now: new Date().toISOString(), questions: s.state === "in_progress" ? all : null };
};
const sess = (token: string) => ASSESS.get(token) ?? null;
const badAssess = () => fail(404, "TOKEN_INVALID", "This assessment link is not valid. Check you opened the whole address from the email.");

route("GET /api/public/v1/assess/:token", (req) => {
  const s = sess(req.params.token);
  return s ? ok(view(s)) : badAssess();
});
route("POST /api/public/v1/assess/:token/start", (req) => {
  const s = sess(req.params.token);
  if (!s) return badAssess();
  if (s.state === "not_started") {
    s.state = "in_progress";
    s.ends_at = inMinutes(s.assessment.duration_min);
  }
  return ok(view(s));
});
route("PUT /api/public/v1/assess/:token/answers/:question_id", (req) => {
  const s = sess(req.params.token);
  if (!s) return badAssess();
  const v = view(s);
  if (v.state === "timed_out") return fail(409, "TIME_UP", "The time is up. Your saved answers have been submitted.");
  if (v.state !== "in_progress") return fail(409, "NOT_IN_PROGRESS", "This assessment is not open.");
  const q = s.all.find((x) => x.question_id === req.params.question_id);
  if (!q) return fail(404, "NOT_FOUND", "No such question.");
  const answer = String(req.body.answer ?? "");
  if (q.kind === "choice" && answer && !q.options!.some((o) => o.id === answer)) return invalid({ answer: ["Pick one of the options"] });
  q.answer = answer || null;
  s.current = Math.max(0, Math.min(s.all.length - 1, Number(req.body.current) || 0));
  return ok({ saved_at: new Date().toISOString() });
});
route("POST /api/public/v1/assess/:token/submit", (req) => {
  const s = sess(req.params.token);
  if (!s) return badAssess();
  const v = view(s);
  if (v.state === "in_progress") {
    s.state = "submitted";
    s.submitted_at = new Date().toISOString();
  }
  return ok(view(s));
});

/* ── Offer signing ── */
type Offer = OfferToSign & { signature?: string };
const LETTER = (first: string, role: string, pay: string, start: string, manager: string) => [
  `Dear ${first},`,
  `We are pleased to offer you the position of ${role} at MyCity App Ltd, reporting to the ${manager}, with a start date of ${start}.`,
  `Your gross monthly salary will be ${pay}, subject to a probationary period of three months. Working hours are 09:00 to 17:00 Monday to Friday and 09:00 to 15:00 on Saturday.`,
  "This offer is conditional upon satisfactory documentation. Once you sign, we will send you a list of the documents to upload before your first day.",
  "We look forward to working with you.",
  "Cynthia Osakunih, Operations and People Lead, for MyCity App Ltd",
];
const OFFERS = new Map<string, Offer>([
  ["Rt8wN2kPz5Gb", { reference: "OFF-0018", candidate_name: "Chiamaka Eze", role: "Content Producer", company: "MyCity App Ltd", expires_at: inDays(7), state: "awaiting", letter: LETTER("Chiamaka", "Content Producer", "₦480,000", "20 October 2026", "Head of Content"), signed_at: null, verify_number: null }],
  ["Yc3vB6mQh9Ls", { reference: "OFF-0016", candidate_name: "Obinna Chukwu", role: "Content Producer", company: "MyCity App Ltd", expires_at: inDays(-15), state: "signed", letter: LETTER("Obinna", "Content Producer", "₦460,000", "1 October 2026", "Head of Content"), signed_at: inDays(-16), verify_number: "OFF-0016" }],
  ["Gz7kT4pXw2Nd", { reference: "OFF-0013", candidate_name: "Kemi Adebayo", role: "Studio Assistant", company: "MyCity App Ltd", expires_at: inDays(-2), state: "awaiting", letter: LETTER("Kemi", "Studio Assistant", "₦200,000", "1 October 2026", "Studio Manager"), signed_at: null, verify_number: null }],
]);
const offerView = (o: Offer): OfferToSign => {
  if (o.state === "awaiting" && new Date(o.expires_at).getTime() < Date.now()) o.state = "expired";
  const { signature: _s, ...rest } = o;
  return rest;
};
const badOffer = () => fail(404, "TOKEN_INVALID", "This link is not valid. Check you opened the whole address from the email.");
route("GET /api/public/v1/sign/:token", (req) => {
  const o = OFFERS.get(req.params.token);
  return o ? ok(offerView(o)) : badOffer();
});
route("POST /api/public/v1/sign/:token/sign", (req) => {
  const o = OFFERS.get(req.params.token);
  if (!o) return badOffer();
  const v = offerView(o);
  if (v.state !== "awaiting") return fail(409, "OFFER_CLOSED", v.state === "expired" ? "This offer expired before it was signed." : "This offer has already been answered.");
  const png = String(req.body.signature_png ?? "");
  if (!png.startsWith("data:image/png;base64,") || png.length < 300) return invalid({ signature_png: ["Sign in the box first"] });
  Object.assign(o, { state: "signed", signed_at: new Date().toISOString(), verify_number: o.reference, signature: png });
  VERIFY.set(o.reference, { number: o.reference, document_type: "Offer of employment", signed_by: o.candidate_name, signed_at: o.signed_at!, issued_by: o.company, content: "matches", artifact: "matches" });
  return ok(offerView(o));
});
route("POST /api/public/v1/sign/:token/decline", (req) => {
  const o = OFFERS.get(req.params.token);
  if (!o) return badOffer();
  const v = offerView(o);
  if (v.state !== "awaiting") return fail(409, "OFFER_CLOSED", "This offer has already been answered.");
  o.state = "declined";
  return ok(offerView(o));
});

/* ── Verification: two hashes, two verdicts ── */
const VERIFY = new Map<string, VerifyResult>(
  ([
    ["OFF-0016", "Obinna Chukwu", -16, "matches", "matches"],
    ["OFF-0012", "Ifeanyi Okafor", -40, "matches", "differs"],
    ["OFF-0011", "Halima Bello", -52, "differs", "matches"],
    ["OFF-0009", "Seun Ajayi", -70, "differs", "differs"],
  ] as const).map(([number, signed_by, d, content, artifact]) => [number, { number, document_type: "Offer of employment", signed_by, signed_at: inDays(d), issued_by: "MyCity App Ltd", content, artifact }]),
);
route("GET /api/public/v1/verify/:number", (req) => {
  const r = VERIFY.get(req.params.number.trim().toUpperCase());
  return r ? ok(r) : fail(404, "NOT_FOUND", "No signed document has this reference.");
});

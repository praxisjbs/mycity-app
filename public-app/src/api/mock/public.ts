import type { ApplicationReceipt, ApplyLink, ApplyQuestion, AssessmentSession, PublicJob, PublicJobCard, PublicQuestion } from "@mycity/contract/contract.gen.ts";
import candidates from "@mycity/contract/schemas/candidates.js";
import type { OfferToSign, VerifyResult } from "@/api/types/public";
import { fail, inDays, invalid, ok, paged, route, type Req } from "./core";

/**
 * Fixtures for the public pages, in the contract's own shapes (P11). The roles and people are the
 * staff app's mock, so a demo can follow one candidate from the careers page to a signed, verified
 * offer. Every bad link is the same 404 the API sends, so a link never says why it failed.
 */

/* ── Text as the API sends it: blocks from the one Markdown renderer ── */
type Block = PublicJob["description"][number];
const span = (text: string, bold = false) => ({ text, bold, italic: false, href: null });
const p = (...parts: Array<string | [string]>): Block => ({ kind: "paragraph", spans: parts.map((x) => (Array.isArray(x) ? span(x[0], true) : span(x))) });
const h = (level: 2 | 3, text: string): Block => ({ kind: "heading", level, spans: [span(text)] });
const ul = (...items: string[]): Block => ({ kind: "bullets", items: items.map((t) => [span(t)]) });

const ABOUT: Block[] = [
  p("MyCityApp is a digital city and lifestyle platform connecting people, businesses, experiences and government services across Nigerian cities. We are building a scalable ecosystem that helps businesses reach customers, grow their visibility and generate value through technology."),
];

/** The end of a day in Lagos (23:59:59, UTC+1), `days` from today. */
const lagosEnd = (days: number) => {
  const d = new Date(Date.now() + days * 86400000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 22, 59, 59)).toISOString();
};

type Role = PublicJob & { questions: ApplyQuestion[] };
const q = (id: string, question_type: ApplyQuestion["question_type"], prompt: string, required: boolean, options: string[] | null = null): ApplyQuestion => ({
  vacancy_question_id: id,
  question_type,
  prompt,
  options,
  required,
});
const role = (r: Partial<Role> & Pick<Role, "slug" | "title" | "department" | "location" | "work_pattern" | "description">): Role => ({
  employment_type: "full_time",
  work_pattern_note: null,
  probation_months: 3,
  reports_to: null,
  min_experience_years: null,
  working_days: "Monday to Friday",
  about_company: ABOUT,
  requirements: null,
  nice_to_have: null,
  how_we_hire: ["apply", "screening", "interview"],
  applicants: 0,
  closes_at: lagosEnd(21),
  state: "open",
  questions: [],
  ...r,
});

const ROLES: Role[] = [
  /* MyCity's own job description for the role (docs/MyCity-ERP-Documents), as staff would paste it. */
  role({
    slug: "head-sales-revenue-lagos",
    title: "Head, Sales & Revenue",
    department: "Sales & Marketing",
    location: "Lagos, Nigeria",
    work_pattern: "hybrid",
    work_pattern_note: "2 days in office, 3 from home",
    working_days: "Monday to Saturday",
    reports_to: "Chief Executive Officer",
    min_experience_years: 8,
    probation_months: null,
    how_we_hire: ["apply", "screening", "assessment", "interview"],
    applicants: 23,
    closes_at: lagosEnd(14),
    description: [
      p("The Head, Sales & Revenue will lead MyCityApp & MyLagosApp's commercial growth by developing and executing the company's sales and revenue strategy."),
      p("The role will own revenue generation, sales targets, pipeline development, client and merchant acquisition, commercial partnerships and sales team performance, while building a structured and scalable sales function."),
      h(2, "Key Responsibilities"),
      h(3, "1. Sales & Revenue Strategy"),
      ul(
        "Develop and execute MyCityApp's & MyLagosApp overall sales and revenue strategy.",
        "Identify new revenue opportunities, products and commercial models.",
        "Set clear sales targets and revenue objectives.",
        "Develop strategies for customer, merchant and corporate acquisition.",
        "Drive sustainable and predictable revenue growth.",
      ),
      h(3, "2. Business Development & Client Acquisition"),
      ul(
        "Identify and pursue high-value businesses, brands, merchants and corporate clients.",
        "Build and manage a strong pipeline of prospective clients.",
        "Lead high-value pitches, presentations and commercial negotiations.",
        "Develop strategic relationships with key decision-makers.",
        "Convert opportunities into paying clients and long-term accounts.",
      ),
      h(3, "3. Sales Pipeline & Conversion"),
      ul(
        "Establish a structured sales pipeline from lead generation to deal closure.",
        "Monitor lead quality, conversion rates, sales cycle and deal value.",
        "Ensure consistent follow-up and movement of opportunities through the pipeline.",
        "Identify bottlenecks and implement strategies to improve conversion.",
      ),
      h(3, "4. Revenue Growth"),
      ul(
        "Develop multiple revenue streams across MyCityApp & MyLagosApp's products and services.",
        "Identify opportunities for upselling, cross-selling and customer retention.",
        "Monitor revenue performance against targets.",
        "Develop strategies to increase average revenue per client and overall commercial value.",
      ),
      h(3, "5. Sales Team Leadership"),
      ul(
        "Build, lead and develop the sales team.",
        "Assign targets and territories based on business priorities.",
        "Establish clear sales processes, standards and accountability.",
        "Coach team members on prospecting, pitching, negotiation and closing.",
        "Monitor individual and team performance.",
      ),
      h(3, "6. Partnerships & Commercial Opportunities"),
      ul(
        "Identify strategic commercial partnerships that can generate revenue or significant business value.",
        "Work with internal teams to develop commercially viable partnership propositions.",
        "Lead commercial negotiations and ensure agreed terms support MyCityApp's business objectives.",
        "Track partnership performance and revenue contribution.",
      ),
      h(3, "7. Sales Reporting & Forecasting"),
      ul(
        "Provide accurate weekly and monthly sales reports.",
        "Maintain visibility on pipeline value, expected closures and revenue projections.",
        "Provide management with realistic sales forecasts.",
        "Use sales data and market insights to guide commercial decisions.",
      ),
      h(3, "8. Sales Process & Systems"),
      ul(
        "Develop and implement effective sales processes and standards.",
        "Ensure proper use of CRM and sales management systems.",
        "Establish clear documentation of leads, opportunities, client engagements and deals.",
        "Continuously improve the sales process based on performance data and market feedback.",
      ),
      h(2, "Key Performance Indicators (KPIs)"),
      p("The role will be measured primarily on commercial outcomes, including:"),
      ul(
        "Revenue generated against target",
        "New clients/merchants acquired",
        "Value of closed deals",
        "Sales pipeline value",
        "Lead-to-client conversion rate",
        "Average deal value",
        "Sales cycle",
        "Client retention and repeat revenue",
        "Revenue generated from partnerships",
        "Sales team performance against targets",
        "Accuracy of sales forecasts",
      ),
    ],
    requirements: [
      ul(
        "Bachelor's degree in Business Administration, Marketing, Economics, Finance or a related field.",
        "8+ years of relevant experience in Sales, Business Development, Revenue Management, Commercial or related roles.",
        "Proven experience leading sales teams and delivering revenue targets.",
        "Demonstrable track record of personally closing significant business deals.",
        "Experience in technology, digital platforms, fintech, media, advertising, telecommunications, FMCG, hospitality, e-commerce or other high-growth environments is an advantage.",
        "Strong experience in B2B sales, client acquisition and commercial negotiations.",
        "Strong understanding of sales pipeline management and CRM systems.",
        "Excellent negotiation, pitching and relationship-management skills.",
        "Strong commercial and analytical mindset.",
        "Ability to operate independently and deliver in a fast-paced, growth-focused environment.",
      ),
    ],
    nice_to_have: [
      p("We are looking for a commercial leader, not simply a sales administrator. Someone who can identify opportunities, open doors, build relationships, negotiate, close deals and build a high-performing sales engine around those opportunities."),
      p("The ideal candidate should be target-driven, commercially aggressive, strategic, hands-on and accountable for results."),
    ],
    questions: [
      q("11111111-1111-4111-8111-000000000001", "yes_no", "Have you led a sales team of three or more people?", true),
      q("11111111-1111-4111-8111-000000000002", "choice", "Which best describes the deals you have closed?", true, ["Under ₦5 million a year", "₦5 million to ₦50 million a year", "Over ₦50 million a year"]),
      q("11111111-1111-4111-8111-000000000003", "text", "Share a link to a proposal or campaign you led, if you can.", false),
    ],
  }),
  role({
    slug: "partnerships-associate-lagos",
    title: "Partnerships Associate",
    department: "Sales & Marketing",
    location: "Ikeja, Lagos",
    work_pattern: "hybrid",
    work_pattern_note: "4 days on site",
    reports_to: "Head, Sales & Revenue",
    min_experience_years: 4,
    salary_min: "500000.00",
    salary_max: "700000.00",
    how_we_hire: ["apply", "screening", "assessment", "interview"],
    applicants: 19,
    description: [
      p("You will build and hold the relationships that put MyCityApp in front of millions of Nigerians: brands, government and venues across Lagos and beyond."),
      h(2, "Key Responsibilities"),
      ul("Find and qualify new partners in hospitality, banking and telecoms", "Run partner meetings from first call to signed agreement", "Keep every partner's results and renewals on track"),
      h(2, "Key Performance Indicators (KPIs)"),
      ul("Partners signed each quarter", "Renewals kept"),
    ],
    requirements: [ul("A degree in management, marketing or business", "4 years in partnerships or business development", "Comfortable leading a room of senior people")],
    nice_to_have: [p("Experience in telecoms, banking or hospitality partnerships, and a network in Lagos State government.")],
    questions: [q("22222222-2222-4222-8222-000000000001", "yes_no", "Can you work from our Ikeja office four days a week?", true)],
  }),
  role({
    slug: "content-producer-lagos",
    title: "Content Producer",
    department: "Content",
    location: "Yaba, Lagos",
    work_pattern: "hybrid",
    work_pattern_note: "3 days on site",
    reports_to: "Head of Content",
    min_experience_years: 2,
    applicants: 41,
    how_we_hire: ["apply", "screening", "assessment", "interview"],
    description: [
      p("You will find the places, people and stories that make Lagos worth exploring, and turn them into guides, videos and posts people save and share."),
      h(2, "Key Responsibilities"),
      ul("Plan and produce a weekly calendar of city guides and short videos", "Visit, photograph and review new places", "Work with partners on sponsored features"),
    ],
    requirements: [ul("2 years writing or producing for a brand, publication or channel", "A portfolio of published work")],
    questions: [q("33333333-3333-4333-8333-000000000001", "text", "A link to your portfolio", true)],
  }),
  role({ slug: "graphics-motion-designer-lagos", title: "Graphics and Motion Designer", department: "Design", location: "Yaba, Lagos", work_pattern: "hybrid", work_pattern_note: "2 days on site", applicants: 12, how_we_hire: ["apply", "assessment", "interview"], description: [p("You will turn MyCityApp, a city discovery and lifestyle platform, into engaging, culturally relevant visual content that drives awareness and adoption: flyers, social posts and short promo videos.")], requirements: [ul("A portfolio of static and motion work for social media", "Skill in layout, typography, colour, motion and editing")] }),
  role({ slug: "backend-engineer", title: "Backend Engineer", department: "Engineering", location: null, work_pattern: "remote", employment_type: "full_time", working_days: "Monday to Friday", applicants: 57, how_we_hire: ["apply", "screening", "assessment", "interview"], description: [p("You will build the services behind the app: search, listings, bookings and the partner dashboard, in Node.js and PostgreSQL.")], requirements: [ul("4 years building APIs in Node.js", "PostgreSQL and its query plans")] }),
  role({ slug: "city-guide-editor-abuja", title: "City Guide Editor", department: "Content", location: "Wuse, Abuja", work_pattern: "on_site", applicants: 8, description: [p("You will own MyCityApp's guide to Abuja: what is in it, how it reads and how fresh it stays.")] }),
  role({ slug: "data-analyst-lagos", title: "Data Analyst", department: "Engineering", location: "Lekki, Lagos", work_pattern: "hybrid", applicants: 15, description: [p("You will turn what people search, save and book into the figures our teams decide with.")] }),
  role({ slug: "social-media-manager-lagos", title: "Social Media Manager", department: "Sales & Marketing", location: "Yaba, Lagos", work_pattern: "hybrid", applicants: 33, description: [p("You will run MyCityApp's social channels and grow the community around them.")] }),
  role({ slug: "operations-intern-lagos", title: "Operations Intern", department: "Operations & People", location: "Lekki, Lagos", work_pattern: "on_site", employment_type: "internship", probation_months: null, applicants: 64, closes_at: lagosEnd(5), description: [p("Six months with the team that keeps MyCityApp running: people, offices, suppliers and the day-to-day.")] }),
  role({ slug: "studio-assistant-lagos", title: "Studio Assistant", department: "Content", location: "Yaba, Lagos", work_pattern: "on_site", employment_type: "contract", state: "paused", description: [p("You will keep our Yaba studio ready for every shoot.")] }),
  role({ slug: "customer-support-lead", title: "Customer Support Lead", department: "Customer Experience", location: "Ikeja, Lagos", work_pattern: "on_site", state: "filled", closes_at: lagosEnd(-10), description: [p("You led the team that answers every message our users send.")] }),
  role({ slug: "events-coordinator-lagos", title: "Events Coordinator", department: "Sales & Marketing", location: "Victoria Island, Lagos", work_pattern: "on_site", state: "closed", closes_at: lagosEnd(-3), description: [p("You will plan MyCityApp's city events.")] }),
];

const cardOf = (r: Role): PublicJobCard => ({ slug: r.slug, title: r.title, department: r.department, location: r.location, work_pattern: r.work_pattern });
const jobOf = ({ questions: _q, ...r }: Role): PublicJob => r;
const notFound = () => fail(404, "NOT_FOUND", "This link is not valid or has expired");
const takesApplications = (r: Role) => r.state === "open" && (!r.closes_at || Date.parse(r.closes_at) > Date.now());

route("GET /api/public/v1/jobs", (req) => paged(ROLES.filter(takesApplications).map(cardOf), req, (v) => [v.title, v.department, v.location]));
route("GET /api/public/v1/jobs/:slug", (req) => {
  const r = ROLES.find((x) => x.slug === req.params.slug);
  return r ? ok(jobOf(r)) : fail(404, "NOT_FOUND", "There is no open role at this address");
});

/* ── Apply ── */
type Link = { slug: string; expires_at: string; receipt: ApplicationReceipt | null; email: string | null };
let nextApp = 42;
const LINKS = new Map<string, Link>([
  ["k7Qm2TxV9pLa", { slug: "head-sales-revenue-lagos", expires_at: inDays(2), receipt: null, email: null }],
  ["Bv3nQ8sLp2Wd", { slug: "content-producer-lagos", expires_at: inDays(2), receipt: null, email: null }],
  ["Wn4cR8yHj2Zs", { slug: "partnerships-associate-lagos", expires_at: inDays(-1), receipt: null, email: null }],
]);
const opaque = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"[b % 56]).join("");
const liveLink = (token: string) => {
  const l = LINKS.get(token);
  return l && Date.parse(l.expires_at) > Date.now() ? l : null;
};

route("POST /api/public/v1/jobs/:slug/apply", (req) => {
  const r = ROLES.find((x) => x.slug === req.params.slug);
  if (!r || !takesApplications(r)) return fail(404, "NOT_FOUND", "There is no open role at this address");
  const token = opaque();
  LINKS.set(token, { slug: r.slug, expires_at: inDays(2), receipt: null, email: null });
  return ok({ token });
});
route("GET /api/public/v1/apply/:token", (req) => {
  const l = liveLink(req.params.token);
  if (!l || l.receipt) return notFound();
  const r = ROLES.find((x) => x.slug === l.slug)!;
  const out: ApplyLink = { vacancy_title: r.title, expires_at: l.expires_at, questions: r.questions };
  return ok(out);
});

/** The answers held to the vacancy's questions, as the API holds them: field errors name the question. */
function answersOf(r: Role, answers: Record<string, string>): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const qn of r.questions) {
    const a = String(answers[qn.vacancy_question_id] ?? "").trim();
    const key = `answers.${qn.vacancy_question_id}`;
    if (!a) {
      if (qn.required) fields[key] = ["Answer this question"];
    } else if (qn.question_type === "yes_no" && !["yes", "no"].includes(a.toLowerCase())) fields[key] = ["Answer yes or no"];
    else if (qn.question_type === "choice" && !(qn.options ?? []).includes(a)) fields[key] = ["Pick one of the options"];
  }
  return fields;
}

route("POST /api/public/v1/apply/:token", (req: Req) => {
  const l = liveLink(req.params.token);
  if (!l) return notFound();
  /* A second press finds the link spent and is given the first one's receipt. */
  if (l.receipt) return ok(l.receipt);
  const checked = candidates.ApplicationSubmit.safeParse(req.body);
  const r = ROLES.find((x) => x.slug === l.slug)!;
  const fields: Record<string, string[]> = {};
  if (!checked.success) for (const i of checked.error.issues) (fields[i.path.join(".") || "body"] ??= []).push(i.message);
  Object.assign(fields, answersOf(r, ((req.body as { answers?: Record<string, string> }).answers ?? {}) as Record<string, string>));
  if (Object.keys(fields).length) return invalid(fields);
  l.receipt = { reference: `APP-${String(++nextApp).padStart(4, "0")}`, submitted_at: new Date().toISOString() };
  l.email = String((req.body as { email?: string }).email ?? "");
  r.applicants += 1;
  return ok(l.receipt);
});

/* ── Assessment ── */
type Sitting = AssessmentSession & { due_days: number | null };
const tq = (n: number, prompt: string, answer: string | null = null): PublicQuestion => ({ assessment_question_id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`, n, question_type: "text", prompt, options: null, answer, file_name: null });
const cq = (n: number, prompt: string, opts: string[], answer: string | null = null): PublicQuestion => ({
  assessment_question_id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`,
  n,
  question_type: "choice",
  prompt,
  options: opts.map((text, i) => ({ id: String.fromCharCode(97 + i), text })),
  answer,
  file_name: null,
});
const fq = (n: number, prompt: string): PublicQuestion => ({ assessment_question_id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`, n, question_type: "file", prompt, options: null, answer: null, file_name: null });

const CASE: PublicQuestion[] = [
  cq(1, "A hotel group wants to list 40 properties on MyCityApp but will not pay a listing fee. Which first offer is strongest?", ["Waive the fee for good", "A revenue share on bookings made through the app", "A discount on the fee for the first year", "Ask them to list five properties first"]),
  cq(2, "A partner's sponsored guide gets half the views it was promised. What do you do first?", ["Offer a refund", "Look at what changed and share it with them, with a plan", "Wait for the month to end", "Run the guide again for free"]),
  tq(3, "Outline the partnership you would propose to the hotel group, and what MyCity gets from it. Use the figures you think matter."),
  tq(4, "How would you measure whether the partnership worked after six months?"),
  fq(5, "Upload a one-page plan of the first 90 days of the partnership (PDF, Word or a spreadsheet), or paste a link to it."),
];
/* MyCity's own Motion and Graphics design brief (docs/MyCity-ERP-Documents): two deliverables and a note. */
const BRIEF: PublicQuestion[] = [
  fq(
    1,
    'Task 1: Static Graphic (Awareness Flyer)\nDesign a social media flyer for Instagram introducing MyCityApp to a new audience, on the concept "Discover Your City with MyCityApp".\n\n• Highlight discovering places (restaurants, events, experiences), exploring your city effortlessly, and connecting with what is happening around you\n• Include a strong call to action, such as Download Now or Explore Your City Like Never Before\n• Keep the layout, typography and brand consistent\n\nSubmit a PNG or JPEG.',
  ),
  fq(
    2,
    'Task 2: Motion Design (Short Promo Video)\nCreate a promo video of 15 to 30 seconds for Instagram Reels or TikTok, on the concept "A Day in Your City with MyCityApp".\n\n• Show a user discovering places, finding events and exploring the city with the app\n• Use motion, transitions and storytelling; add text overlays or mock UI if you can\n• End with a clear call to action\n\nSubmit an MP4, or paste a link to it if it is over 25 MB.',
  ),
  tq(3, "In two or three sentences, explain your creative approach."),
];

const sitting = (s: Partial<Sitting> & Pick<Sitting, "assessment" | "questions">): Sitting => ({
  candidate_first_name: "Adaeze",
  vacancy_title: "Partnerships Associate",
  state: "not_started",
  timed: s.assessment.duration_minutes !== null,
  start_by: inDays(3).slice(0, 10),
  ends_at: null,
  server_now: new Date().toISOString(),
  current_question: 0,
  submitted_at: null,
  due_days: null,
  ...s,
});
const CASE_DEF = { name: "Partnership Brief", assessment_type: "case_study" as const, duration_minutes: 45, question_count: CASE.length, instructions: "Read each situation and answer as you would at work. There is no trick: we want to see how you think. Your answers save as you go." };
const SITTINGS = new Map<string, Sitting>([
  ["Px2mL9vQe4Ty", sitting({ assessment: CASE_DEF, questions: CASE.map((x) => ({ ...x })) })],
  ["Hb6tZ3qNw8Rk", sitting({ assessment: CASE_DEF, questions: CASE.map((x, i) => (i === 0 ? { ...x, answer: "b" } : { ...x })), state: "in_progress", ends_at: new Date(Date.now() + 31 * 60000).toISOString(), current_question: 1 })],
  [
    "Tk8wD3fRm6Qa",
    sitting({
      vacancy_title: "Graphics and Motion Designer",
      candidate_first_name: "Tobi",
      assessment: {
        name: "Motion and Graphics Design Brief",
        assessment_type: "practical",
        duration_minutes: null,
        question_count: BRIEF.length,
        instructions:
          "Two tasks on MyCityApp as a city discovery and lifestyle platform: one static graphic and one short promo video. We are looking at real-world execution, creativity and fit with our brand.\n\nDownload and explore MyCityApp Nigeria first, for the product, its content and its feel. Your work should be your own.",
      },
      questions: BRIEF.map((x) => ({ ...x })),
      due_days: 5,
    }),
  ],
  ["Jd5sF7aWc3Xe", sitting({ assessment: CASE_DEF, questions: CASE.map((x) => ({ ...x })), state: "submitted", submitted_at: inDays(-1) })],
  ["Mz4pK7tYb2Vn", sitting({ assessment: CASE_DEF, questions: CASE.map((x) => ({ ...x })), state: "timed_out", submitted_at: inDays(-2) })],
]);

/** What the page is sent: the server's own clock beside the end; no questions until it starts. */
const view = (s: Sitting): AssessmentSession => {
  const { due_days: _d, ...rest } = s;
  if (rest.state === "in_progress" && rest.ends_at && Date.parse(rest.ends_at) <= Date.now()) {
    s.state = "timed_out";
    s.submitted_at = rest.ends_at;
    return view(s);
  }
  return { ...rest, server_now: new Date().toISOString(), questions: rest.state === "not_started" ? null : rest.questions };
};
const sittingOf = (token: string) => SITTINGS.get(token) ?? null;

route("GET /api/public/v1/assess/:token", (req) => {
  const s = sittingOf(req.params.token);
  return s ? ok(view(s)) : notFound();
});
route("POST /api/public/v1/assess/:token/start", (req) => {
  const s = sittingOf(req.params.token);
  if (!s) return notFound();
  if (s.state === "not_started") {
    s.state = "in_progress";
    s.ends_at = s.assessment.duration_minutes ? new Date(Date.now() + s.assessment.duration_minutes * 60000).toISOString() : lagosEnd(s.due_days ?? 5);
  }
  return ok(view(s));
});
const running = (s: Sitting | null) => {
  if (!s) return notFound();
  const v = view(s);
  if (v.state === "timed_out") return fail(409, "TIME_UP", "The time for this assessment is over");
  if (v.state !== "in_progress") return fail(409, "NOT_RUNNING", "This assessment is not running");
  return null;
};
route("PUT /api/public/v1/assess/:token/answers/:question_id", (req) => {
  const s = sittingOf(req.params.token);
  const refused = running(s);
  if (refused) return refused;
  const qn = s!.questions!.find((x) => x.assessment_question_id === req.params.question_id);
  if (!qn) return notFound();
  const answer = String((req.body as { answer?: unknown }).answer ?? "").trim();
  if (answer.length > 20000) return invalid({ answer: ["Too long"] });
  if (qn.question_type === "choice" && answer && !(qn.options ?? []).some((o) => o.id === answer)) return invalid({ answer: ["Pick one of the options"] });
  if (qn.question_type === "file" && answer && !/^https:\/\/[^\s/$.?#]\S*$/i.test(answer)) return invalid({ answer: ["Upload a file or give an https link"] });
  /* Moving on from a file question without a new answer keeps what was given; a new link replaces it. */
  if (!(qn.question_type === "file" && !answer)) {
    qn.answer = answer || null;
    if (qn.question_type === "file") qn.file_name = null;
  }
  const at = Number((req.body as { current_question?: unknown }).current_question);
  if (Number.isInteger(at)) s!.current_question = Math.max(0, Math.min(s!.questions!.length - 1, at));
  return ok({ saved_at: new Date().toISOString(), file_name: null });
});
route("POST /api/public/v1/assess/:token/answers/:question_id/file", (req) => {
  const s = sittingOf(req.params.token);
  const refused = running(s);
  if (refused) return refused;
  const qn = s!.questions!.find((x) => x.assessment_question_id === req.params.question_id);
  if (!qn) return notFound();
  qn.file_name = "answer.pdf";
  qn.answer = null;
  return ok({ saved_at: new Date().toISOString(), file_name: qn.file_name });
});
route("POST /api/public/v1/assess/:token/submit", (req) => {
  const s = sittingOf(req.params.token);
  if (!s) return notFound();
  if (s.state === "not_started") return fail(409, "NOT_RUNNING", "Start the assessment first");
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

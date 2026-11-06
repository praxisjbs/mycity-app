import type { ApplicationReceipt, ApplyLink, ApplyQuestion, AssessmentSession, PublicJob, PublicJobCard, PublicJobsSummary, PublicQuestion } from "@mycity/contract/contract.gen.ts";
import candidates from "@mycity/contract/schemas/candidates.js";
import type { OfferToSign, VerifyByToken, VerifyResult } from "@/api/types/public";
import { fail, inDays, invalid, ok, paged, route, type Req } from "./core";

/**
 * Fixtures for the public pages, in the contract's own shapes (P11). The open roles are the approved
 * public site design's twelve (public-site-demo.html, 06/11/2026): its titles, departments, places,
 * arrangements and employment types, closing in its order, each date counted from today so it stays
 * ahead. A paused, a filled, a past-its-day and a closed role sit beside them for the Vacancy page's
 * states. The candidates and the assessments follow the staff app's mock
 * (app/src/api/mock/data/recruitment.ts). Every bad link is the same 404 the API sends.
 */

/* ── Text as the API sends it: blocks from the one Markdown renderer ── */
type Block = PublicJob["description"][number];
const span = (text: string, bold = false) => ({ text, bold, italic: false, href: null });
const p = (...parts: Array<string | [string]>): Block => ({ kind: "paragraph", spans: parts.map((x) => (Array.isArray(x) ? span(x[0], true) : span(x))) });
const h = (level: 2 | 3, text: string): Block => ({ kind: "heading", level, spans: [span(text)] });
const ul = (...items: string[]): Block => ({ kind: "bullets", items: items.map((t) => [span(t)]) });

/* About MyCityApp, as Careers Settings would hold it: the index's paragraph. */
const ABOUT: Block[] = [
  p("MyCityApp is a digital city and lifestyle platform connecting people, businesses, experiences and government services across Nigerian cities."),
  p("Our apps, MyCityApp and MyLagosApp, help businesses reach customers, grow their visibility and create value through technology."),
];

/* Each department's code, as the API names it on a card and takes it in `department`. */
const CODES: Record<string, string> = {
  "Operations & People": "OPS",
  "Marketing & Sales": "MKT",
  Studio: "STU",
  Engineering: "ENG",
  Content: "CNT",
  Support: "SUP",
  Finance: "FIN",
};

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
  department_code: r.department ? (CODES[r.department] ?? null) : null,
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
  role({ slug: "operations-intern-lagos", title: "Operations Intern", department: "Operations & People", location: "Lekki Phase 1, Lagos", work_pattern: "on_site", employment_type: "internship", probation_months: null, applicants: 64, closes_at: lagosEnd(5), description: [p("Six months with the team that keeps MyCityApp running: people, offices, suppliers and the day to day.")] }),
  /* MyCity's own job description for the role (docs/MyCity-ERP-Documents), as staff would paste it. */
  role({
    slug: "head-sales-revenue-lagos",
    title: "Head, Sales & Revenue",
    department: "Marketing & Sales",
    location: "Lekki Phase 1, Lagos",
    work_pattern: "hybrid",
    work_pattern_note: "2 days in office",
    working_days: "Monday to Saturday",
    reports_to: "Chief Executive Officer",
    min_experience_years: 8,
    probation_months: 6,
    how_we_hire: ["apply", "screening", "assessment", "interview"],
    applicants: 12,
    closes_at: lagosEnd(12),
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
  /* MyCity's own Motion and Graphics brief is this role's take-home (VAC-0002 in the staff mock). */
  role({
    slug: "graphics-and-motion-designer-lagos",
    title: "Graphics and Motion Designer",
    department: "Studio",
    location: "Ikeja, Lagos",
    work_pattern: "on_site",
    min_experience_years: 3,
    applicants: 12,
    closes_at: lagosEnd(14),
    /* Written as staff often paste it, under its own Role Overview heading: the page shows that heading once. */
    description: [
      h(2, "Role Overview"),
      p("The Graphics and Motion Designer turns MyCityApp, a city discovery and lifestyle platform, into engaging, culturally relevant visual content that drives awareness and adoption."),
      h(2, "Key Responsibilities"),
      ul("Design the weekly campaign art for the app and social media.", "Edit and animate short promo videos for Instagram Reels and TikTok.", "Keep the brand consistent across every piece."),
    ],
    requirements: [ul("Three years of brand and motion design.", "A portfolio of flyers, posts and short videos.", "Adobe After Effects and Illustrator, or the like.")],
    questions: [q("33333333-3333-4333-8333-000000000001", "text", "A link to your portfolio", true)],
  }),
  role({ slug: "data-analyst-lagos", title: "Data Analyst", department: "Engineering", location: "Lekki Phase 1, Lagos", work_pattern: "hybrid", applicants: 15, salary_min: "500000.00", salary_max: "700000.00", closes_at: lagosEnd(16), description: [p("The Data Analyst turns what people search, save and book into the figures MyCityApp's teams decide with.")] }),
  role({ slug: "city-editor-abuja", title: "City Editor, Abuja", department: "Content", location: "Wuse, Abuja", work_pattern: "on_site", applicants: 8, closes_at: lagosEnd(19), description: [p("The City Editor owns MyCityApp's guide to Abuja: what is in it, how it reads and how fresh it stays.")] }),
  role({
    slug: "partnerships-associate-lagos",
    title: "Partnerships Associate",
    department: "Marketing & Sales",
    location: "Lekki Phase 1, Lagos",
    work_pattern: "hybrid",
    min_experience_years: 2,
    applicants: 9,
    closes_at: lagosEnd(20),
    description: [p("The Partnerships Associate signs and looks after the venues and brands that list on MyCityApp, from the first call to the renewal a year on.")],
    requirements: [ul("Two years in sales or partnerships.", "Comfortable on the phone and in person.")],
  }),
  role({ slug: "product-designer-lagos", title: "Product Designer", department: "Studio", location: "Ikeja, Lagos", work_pattern: "hybrid", applicants: 27, closes_at: lagosEnd(21), description: [p("The Product Designer shapes how people find and book what their city offers in the MyCityApp app.")] }),
  role({
    slug: "customer-support-lead-lagos",
    title: "Customer Support Lead",
    department: "Support",
    location: "Ikeja, Lagos",
    work_pattern: "on_site",
    min_experience_years: 4,
    applicants: 17,
    closes_at: lagosEnd(22),
    description: [p("The Customer Support Lead runs the team that answers MyCityApp's users and partners by chat, email and phone, and turns what they hear into fixes the product team can act on.")],
    requirements: [ul("Four years in customer support, one leading a team.", "Calm, clear writing in English.")],
  }),
  role({
    slug: "content-producer-lagos",
    title: "Content Producer",
    department: "Content",
    location: "Lekki Phase 1, Lagos",
    work_pattern: "hybrid",
    employment_type: "contract",
    min_experience_years: 2,
    applicants: 41,
    closes_at: lagosEnd(23),
    description: [p("The Content Producer plans, shoots and writes the guides and short videos that show MyCityApp users the best of their city, every week, with the Studio and the city editors.")],
    requirements: [ul("Two years producing content for social media.", "A portfolio of guides or short videos.")],
  }),
  role({ slug: "social-media-manager-lagos", title: "Social Media Manager", department: "Marketing & Sales", location: "Lekki Phase 1, Lagos", work_pattern: "hybrid", applicants: 33, closes_at: lagosEnd(24), description: [p("The Social Media Manager runs MyCityApp's social channels and grows the community around them.")] }),
  role({ slug: "finance-officer-lagos", title: "Finance Officer", department: "Finance", location: "Lekki Phase 1, Lagos", work_pattern: "on_site", reports_to: "Head of Finance", applicants: 19, closes_at: lagosEnd(25), description: [p("The Finance Officer keeps MyCityApp's books, payments and month-end close in order.")] }),
  role({ slug: "community-manager-lagos", title: "Community Manager", department: "Marketing & Sales", location: "Lekki Phase 1, Lagos", work_pattern: "hybrid", applicants: 11, closes_at: lagosEnd(27), description: [p("The Community Manager brings MyCityApp's users and partners together, online and at city events.")] }),
  /* The Vacancy page's other states, none of them on Careers or the index. */
  /* Paused: the link keeps working and says so. */
  role({
    slug: "video-editor-lagos",
    title: "Video Editor",
    department: "Studio",
    location: "Ikeja, Lagos",
    work_pattern: "on_site",
    min_experience_years: 2,
    state: "paused",
    description: [p("The Video Editor cuts the Studio's shoots into the reels and guides MyCityApp posts every week.")],
    requirements: [ul("Two years editing short video.", "Premiere Pro or DaVinci Resolve.")],
  }),
  /* Closed as filled. */
  role({
    slug: "studio-assistant-lagos",
    title: "Studio Assistant",
    department: "Studio",
    location: "Ikeja, Lagos",
    work_pattern: "on_site",
    state: "filled",
    closes_at: lagosEnd(-30),
    description: [p("The Studio Assistant keeps the Studio's shoots, kit and bookings in order.")],
  }),
  /* Open, but its closing day has passed, so it takes no one and reads closed. */
  role({
    slug: "copywriter-lagos",
    title: "Copywriter",
    department: "Content",
    location: "Lekki Phase 1, Lagos",
    work_pattern: "hybrid",
    applicants: 22,
    closes_at: lagosEnd(-2),
    description: [p("The Copywriter writes the words of MyCityApp's campaigns, from a billboard line to a push notification.")],
  }),
  role({ slug: "events-coordinator-lagos", title: "Events Coordinator", department: "Marketing & Sales", location: "Victoria Island, Lagos", work_pattern: "on_site", state: "closed", closes_at: lagosEnd(-3), description: [p("The Events Coordinator plans MyCityApp's city events.")] }),
];

const cardOf = (r: Role): PublicJobCard => ({
  slug: r.slug,
  title: r.title,
  department: r.department,
  department_code: r.department_code,
  location: r.location,
  work_pattern: r.work_pattern,
  work_pattern_note: r.work_pattern_note,
  employment_type: r.employment_type,
  closes_at: r.closes_at,
});
/** As the server's publicState: an open role past its closing time reads closed. */
const stateOf = (r: Role): PublicJob["state"] => (r.state === "open" && r.closes_at && Date.parse(r.closes_at) <= Date.now() ? "closed" : r.state);
const jobOf = ({ questions: _q, ...r }: Role): PublicJob => ({ ...r, state: stateOf(r as Role) });
const notFound = () => fail(404, "NOT_FOUND", "This link is not valid or has expired");
const takesApplications = (r: Role) => stateOf(r) === "open";

/** As the API lists them: closing soonest first, a role with no closing date last (guide §6.1). */
const closingOrder = (a: Role, b: Role) => (a.closes_at ? Date.parse(a.closes_at) : Infinity) - (b.closes_at ? Date.parse(b.closes_at) : Infinity);
const listed = () => ROLES.filter(takesApplications).sort(closingOrder);
/** The city of a role's place: the last part of its line ("Lekki Phase 1, Lagos" is Lagos). */
const cityOf = (r: Role) => (r.location ? r.location.split(",").pop()!.trim() : null);

route("GET /api/public/v1/jobs", (req) => {
  const code = req.query.department?.trim().toLowerCase();
  const rows = listed().filter((r) => !code || (r.department_code ?? "").toLowerCase() === code);
  return paged(rows.map(cardOf), req, (v) => [v.title, v.department, v.location], ["department"]);
});
route("GET /api/public/v1/jobs/summary", () => {
  const roles = listed();
  const count = <K extends string>(keys: Array<K | null>) => {
    const m = new Map<K, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m];
  };
  const out: PublicJobsSummary = {
    open: roles.length,
    departments: count(roles.map((r) => r.department))
      .map(([name, open]) => ({ code: CODES[name]!, name, open }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    cities: count(roles.map(cityOf))
      .map(([name, open]) => ({ name, open }))
      .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
    closing_soon: roles.slice(0, 3).map(cardOf),
    about_company: ABOUT,
  };
  return ok(out);
});
route("GET /api/public/v1/jobs/:slug", (req) => {
  const r = ROLES.find((x) => x.slug === req.params.slug);
  return r ? ok(jobOf(r)) : fail(404, "NOT_FOUND", "There is no open role at this address");
});

/* ── Apply ── */
type Link = { slug: string; expires_at: string; receipt: ApplicationReceipt | null; email: string | null };
let nextApp = 42;
const LINKS = new Map<string, Link>([
  ["k7Qm2TxV9pLa", { slug: "head-sales-revenue-lagos", expires_at: inDays(2), receipt: null, email: null }],
  ["Bv3nQ8sLp2Wd", { slug: "graphics-and-motion-designer-lagos", expires_at: inDays(2), receipt: null, email: null }],
  ["Wn4cR8yHj2Zs", { slug: "studio-assistant-lagos", expires_at: inDays(-1), receipt: null, email: null }],
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
  const out: ApplyLink = { vacancy_title: r.title, vacancy_department: r.department, vacancy_location: r.location, expires_at: l.expires_at, questions: r.questions };
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

/* The Sales Scenario Case Study as the approved design shows it: 60 minutes, two written answers and a pitch to attach or link. */
const CASE: PublicQuestion[] = [
  tq(1, "A chain of five Lagos restaurants spends ₦2 million a month on billboards and wants more weekday diners. Write the plan you would pitch them for a three month MyCityApp campaign."),
  tq(2, "The same chain says the price is too high after one month of weak results. How do you keep the account?"),
  fq(3, "Attach the one-page pitch you would send the chain's owner, or paste a link to it."),
];
const LIKERT = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
/* The staff mock's Work Style Profile (ASM-0003): 20 minutes, how far the candidate agrees with each line. */
const STYLE: PublicQuestion[] = [
  cq(1, "I finish what I start, even when it gets dull.", LIKERT),
  cq(2, "I prefer to wait for clear instructions before I begin.", LIKERT),
  cq(3, "I enjoy meeting people I do not know.", LIKERT),
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

const sitting = (s: Partial<Sitting> & Pick<Sitting, "assessment" | "questions" | "candidate_first_name">): Sitting => ({
  vacancy_title: "Head, Sales & Revenue",
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
const CASE_DEF = { name: "Sales Scenario Case Study", assessment_type: "case_study" as const, duration_minutes: 60, question_count: CASE.length, instructions: "Read the scenario in each question and answer in your own words. You have 60 minutes once you press Start." };
const STYLE_DEF = { name: "Work Style Profile", assessment_type: "psychometric" as const, duration_minutes: 20, question_count: STYLE.length, instructions: "Say how far you agree with each statement. There are no right or wrong answers." };
/* The staff mock's ASM-0001 by name; its brief is MyCity's own (docs/MyCity-ERP-Documents). Sent to Segun, as there. */
const BRIEF_DEF = {
  name: "Graphics and Motion Design Brief",
  assessment_type: "practical" as const,
  duration_minutes: null,
  question_count: BRIEF.length,
  instructions:
    "Two tasks on MyCityApp as a city discovery and lifestyle platform: one static graphic and one short promo video. We are looking at real-world execution, creativity and fit with our brand.\n\nDownload and explore MyCityApp Nigeria first, for the product, its content and its feel. Your work should be your own.",
};
const SITTINGS = new Map<string, Sitting>([
  ["Px2mL9vQe4Ty", sitting({ candidate_first_name: "Ngozi", assessment: CASE_DEF, questions: CASE.map((x) => ({ ...x })) })],
  [
    "Hb6tZ3qNw8Rk",
    sitting({
      candidate_first_name: "Funke",
      assessment: STYLE_DEF,
      questions: STYLE.map((x, i) => (i === 0 ? { ...x, answer: "d" } : { ...x })),
      state: "in_progress",
      ends_at: new Date(Date.now() + 14 * 60000).toISOString(),
      current_question: 1,
    }),
  ],
  ["Tk8wD3fRm6Qa", sitting({ candidate_first_name: "Segun", vacancy_title: "Graphics and Motion Designer", assessment: BRIEF_DEF, questions: BRIEF.map((x) => ({ ...x })), due_days: 5 })],
  ["Jd5sF7aWc3Xe", sitting({ candidate_first_name: "Ngozi", vacancy_title: "Graphics and Motion Designer", assessment: BRIEF_DEF, questions: BRIEF.map((x) => ({ ...x })), state: "submitted", submitted_at: inDays(-1) })],
  ["Mz4pK7tYb2Vn", sitting({ candidate_first_name: "Emeka", assessment: CASE_DEF, questions: CASE.map((x) => ({ ...x })), state: "timed_out", submitted_at: inDays(-2) })],
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
  return ok({ document_id: crypto.randomUUID(), file_name: qn.file_name, size_bytes: 1024, mime_type: "application/pdf", saved_at: new Date().toISOString() });
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
/* The approved design's offer (OFF-0018, for Chiamaka Eze), one already signed and one past its day. */
const OFF_0016_SIGNED = "2026-10-21T13:05:00.000Z"; // 21/10/2026, 14:05 in Lagos
const OFFERS = new Map<string, Offer>([
  ["Rt8wN2kPz5Gb", { reference: "OFF-0018", candidate_name: "Chiamaka Eze", role: "Content Producer", company: "MyCity App Ltd", issued_at: new Date().toISOString(), expires_at: inDays(7), state: "awaiting", letter: LETTER("Chiamaka", "Content Producer", "₦480,000", "20 October 2026", "Head of Content"), signed_at: null, verify_number: null }],
  ["Yc3vB6mQh9Ls", { reference: "OFF-0016", candidate_name: "Obinna Chukwu", role: "Content Producer", company: "MyCity App Ltd", issued_at: "2026-10-17T09:00:00.000Z", expires_at: "2026-10-24T22:59:59.000Z", state: "signed", letter: LETTER("Obinna", "Content Producer", "₦460,000", "1 November 2026", "Head of Content"), signed_at: OFF_0016_SIGNED, verify_number: "OFF-0016" }],
  ["Gz7kT4pXw2Nd", { reference: "OFF-0013", candidate_name: "Kemi Adebayo", role: "Studio Assistant", company: "MyCity App Ltd", issued_at: inDays(-9), expires_at: inDays(-2), state: "awaiting", letter: LETTER("Kemi", "Studio Assistant", "₦200,000", "1 October 2026", "Studio Manager"), signed_at: null, verify_number: null }],
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

/* ── Verification: two hashes, two verdicts ──
 * The approved design's cases: OFF-0016 genuine, OFF-0012 its stored file altered (the artifact hash
 * differs), OFF-0011 its record altered (the content hash differs), OFF-0099 not found; OFF-0018 is
 * added genuine when it is signed above. OFF-0009 has both changed. Signed times are Lagos's.
 */
const VERIFY = new Map<string, VerifyResult>(
  ([
    ["OFF-0016", "Obinna Chukwu", OFF_0016_SIGNED, "matches", "matches"],
    ["OFF-0012", "Ifeanyi Okafor", "2026-09-27T09:42:00.000Z", "matches", "differs"],
    ["OFF-0011", "Halima Bello", "2026-09-15T15:20:00.000Z", "differs", "matches"],
    ["OFF-0009", "Seun Ajayi", "2026-08-28T10:10:00.000Z", "differs", "differs"],
  ] as const).map(([number, signed_by, signed_at, content, artifact]) => [number, { number, document_type: "Offer of employment", signed_by, signed_at, issued_by: "MyCity App Ltd", content, artifact }]),
);
route("GET /api/public/v1/verify/:number", (req) => {
  const r = VERIFY.get(req.params.number.trim().toUpperCase());
  return r ? ok(r) : fail(404, "NOT_FOUND", "No signed document has this reference.");
});

/* The QR printed on each page of a sealed document opens it by token, with the document itself. */
const QR = new Map<string, string>([["Qd5mW8rTx3Kp", "OFF-0016"]]);
route("GET /api/public/v1/verify/t/:token", (req) => {
  const number = QR.get(req.params.token);
  const r = number ? VERIFY.get(number) : undefined;
  const offer = [...OFFERS.values()].find((o) => o.reference === number);
  if (!r || !offer) return fail(404, "NOT_FOUND", "This link is not valid. Check you scanned the whole code.");
  const out: VerifyByToken = { ...r, document: { title: "Offer of Employment", letter: offer.letter, file_name: `${r.number}.pdf`, url: `/api/public/v1/verify/t/${req.params.token}/file` } };
  return ok(out);
});

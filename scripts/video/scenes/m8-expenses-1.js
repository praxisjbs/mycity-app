"use strict";
/**
 * Milestone 8 handover, part 1 of 2: Expenses, raising and approving. docs/runbooks/training-videos.md
 * says how a scene is written and filmed, and §8 the plan.
 *
 * MyCity's own people do the work (TB, 13/11/2026: "Use real employees. Make it feel so real"), on a
 * development database prepared by `prepare` below. Aaron Agama raises a request on his phone;
 * Bode Oluwasanmi, the CTO, raises JBS Praxis's real invoice INV-202611-9525 with Read Invoice;
 * Chinyere Elechi approves her team's and sends one back; Similoluwa Michael sends it again;
 * Cynthia Osakunih, Operations & People, checks a possible duplicate and approves; Tobiloba Dada
 * raises one from the chat. Part 2 (`m8-expenses-2.js`) runs on the same database after it.
 *
 * `prepare` is the ground both parts are filmed on: the staging seed without its own expense rows,
 * then what MyCity's people would have done in Expenses before the camera rolls, each step through
 * the module's own service as its screen makes it: the twelve suggested categories; this year's
 * budgets for three departments (examples, A25, said so on camera); two projects; and earlier
 * requests by the people whose work they are, walked to where each stands. Refused anywhere but a
 * development database; run once on a fresh one (`make.js m8-expenses-1 prepare`, runbook §4.1).
 */
const path = require("node:path");

const src = (p) => require(path.join(__dirname, "..", "..", "..", "src", p));

/** The JBS Praxis invoice's payee, as printed on the invoice the camera reads. */
const JBS = Object.freeze({ payee_name: "JBS Praxis Limited", bank_name: "Nombank MFB", account_name: "JBS Praxis Limited", account_number: "5589994089" });

/** The people paid into their own account in the videos (Use My Company Account). */
const OWN_ACCOUNT = Object.freeze(["Social Media Manager", "Graphics Designer", "Content & Listing Associate"]);

const BUDGETS = Object.freeze({
  "Branding & Marketing": [
    ["Advertising and Media", "1500000.00"],
    ["Branded Items and Printing", "900000.00"],
    ["Content and Production", "600000.00"],
    ["Influencers and PR", "1200000.00"],
    ["Data Airtime and Subscriptions", "300000.00"],
    ["Equipment", "400000.00"],
  ],
  "Technology & Back-office Ops": [
    ["Legal and Professional Services", "1200000.00"],
    ["Travel and Transport", "300000.00"],
    ["Data Airtime and Subscriptions", "200000.00"],
    ["Office and Admin", "250000.00"],
  ],
  "People & Culture": [
    ["Events and Activations", "1500000.00"],
    ["Office and Admin", "500000.00"],
    ["Accommodation and Meals", "300000.00"],
  ],
});

/**
 * The requests made before filming, by job title (never a name written here). `walk`: paid
 * (with `reference`, or none), authorised, approved, with_operations, with_manager, rejected.
 * `paid` is days ago. Bank details are typed for every payee but Staff on their own account.
 */
const REQUESTS = Object.freeze([
  { by: "Chief Technology Officer", walk: "paid", paid: 9, reference: "NIP-261104-0918274", project: "Website Ticket Payments",
    purpose: "Website ticket payments, 50% deposit", category: "Legal and Professional Services", payee: "vendor", ...JBS,
    lines: [["Three switchable payment gateways, 50% deposit", "1", "300000.00"]] },
  { by: "Head, PR, Marketing & Brand Strategy", walk: "paid", paid: 6, reference: "NIP-261107-5520113",
    purpose: "Influencer posts, Detty December teaser", category: "Influencers and PR", payee: "partner",
    payee_name: "Lagos Lifestyle Media", bank_name: "Wema Bank", account_name: "Lagos Lifestyle Media Ltd", account_number: "0123984471",
    lines: [["Instagram post and story", "3", "150000.00"]] },
  { by: "Social Media Manager", walk: "paid", paid: 4, reference: "NIP-261109-3307745",
    purpose: "Data for live coverage, Ikeja walk", category: "Data Airtime and Subscriptions", payee: "staff",
    lines: [["Data bundle, 20GB", "2", "10000.00"]] },
  { by: "Program Manager", walk: "paid", paid: 2, reference: null,
    purpose: "Partner lunch, Providus Bank team", category: "Accommodation and Meals", payee: "vendor",
    payee_name: "The Yellow Chilli", bank_name: "GTBank", account_name: "Yellow Chilli Restaurant Ltd", account_number: "0224410958",
    lines: [["Lunch for six", "1", "96000.00"]] },
  { by: "Graphics Designer", walk: "authorised",
    purpose: "Adobe Creative Cloud, December", category: "Data Airtime and Subscriptions", payee: "staff",
    lines: [["Creative Cloud seat, one month", "2", "38000.00"]] },
  { by: "PR & Marketing Lead - MyLagosApp", walk: "approved",
    purpose: "MyLagosApp launch flyers, Ikeja", category: "Branded Items and Printing", payee: "vendor",
    payee_name: "Printmax Nigeria Ltd", bank_name: "Zenith Bank", account_name: "Printmax Nigeria Ltd", account_number: "1014429931",
    lines: [["A5 flyers", "5000", "45.00"], ["Roll-up banners", "4", "35000.00"]] },
  { by: "Content & Listing Associate", walk: "approved", nth: 0,
    purpose: "Listing visits, Lekki and Ajah", category: "Travel and Transport", payee: "staff",
    lines: [["Ride-hailing, return trips", "6", "6500.00"]] },
  { by: "Backend Operations Manager", walk: "with_operations", project: "Website Ticket Payments",
    purpose: "JBS Praxis invoice INV-202611-9525", category: "Legal and Professional Services", payee: "vendor", ...JBS,
    lines: [["Balance due, INV-202611-9525", "1", "150000.00"]] },
  { by: "Graphics Associate", walk: "with_manager",
    purpose: "Studio props, product shoot", category: "Content and Production", payee: "vendor",
    payee_name: "Props Hub Yaba", bank_name: "Access Bank", account_name: "Props Hub Enterprises", account_number: "0739921045",
    lines: [["Props and backdrop", "1", "85000.00"]] },
  { by: "Social Media Manager", walk: "rejected", reason: "We have two ring lights in the studio.",
    purpose: "Ring light for content", category: "Equipment", payee: "staff",
    lines: [["18-inch ring light with stand", "1", "65000.00"]] },
]);

async function prepare({ log = console.log } = {}) {
  const { config } = src("config/env");
  require("../people").guard(config);
  const { pool } = src("config/db");
  const requestContext = src("config/request-context");
  const c = require("@mycity/contract");
  const grants = src("shared/rbac/grants-cache");
  const lagos = src("shared/time/lagos");
  const { atomically } = src("shared/db/tx");
  const runner = require("../../db/seed");
  const { realStaff } = require("../../../seeds/staging/lib/staff");
  const { removeHomeStagingRows } = require("../../../seeds/staging/lib/home-staging-rows");
  const { EXPENSE_TABLES } = require("../../../seeds/staging/80_expenses");

  const { rows: had } = await pool.query("SELECT count(*)::int AS n FROM expense_request");
  if (had[0].n) throw new Error("Expenses already has requests: prepare runs once, on a fresh database (runbook §4.1).");

  const inContext = (fn) => requestContext.run({ requestId: "video-m8", surface: "script" }, fn);
  /* The staging seed, every file but Expenses' own: its rows are the Implementation Team's. */
  for (const file of runner.seedFiles("staging")) {
    if (path.basename(file) === "80_expenses.js") continue;
    await inContext(() => require(file)({ pool, actor: runner.ACTOR, log: (m) => log(`[seed] ${m}`) }));
    log(`[seed] ${path.basename(file)}`);
  }

  await inContext(async () => {
    const categories = src("modules/expense_categories/expense_categories.service");
    const budgets = src("modules/budgets/budgets.service");
    const projects = src("modules/projects/projects.service");
    const expenses = src("modules/expenses/expenses.service");
    const requisitions = src("modules/requisitions/requisitions.service");
    const disbursements = src("modules/disbursements/disbursements.service");
    const workflow = src("modules/workflow/workflow.service");

    /* Home's demonstration requests and budgets away, and 8099's five where nothing names them. */
    const client = await pool.connect();
    try {
      await atomically(client, async () => {
        await removeHomeStagingRows(client, EXPENSE_TABLES);
        await client.query(
          `DELETE FROM expense_category c WHERE c.description IS NULL
              AND c.code IN ('travel', 'office', 'training', 'utilities', 'professional_services')
              AND NOT EXISTS (SELECT 1 FROM expense_request er WHERE er.expense_category_id = c.expense_category_id)
              AND NOT EXISTS (SELECT 1 FROM budget_line bl WHERE bl.expense_category_id = c.expense_category_id)`,
        );
      });
    } finally {
      client.release();
    }

    const staff = await realStaff(pool);
    const as = async (person) => ({ ...(await grants.getAuthUser(pool, person.user_id)), ip: null });
    const titled = (title, nth = 0) => {
      const found = staff.everyone.filter((p) => p.job_title === title && p.user_id);
      if (!found[nth]) throw new Error(`Nobody with a login is ${title}`);
      return found[nth];
    };
    const ops = await as(staff.operations);
    const ceo = await as(staff.ceo);

    /*
     * The roster carries a bank's name for most staff but never an account number (the repository
     * is public). Use My Company Account needs one, so the people the videos pay into their own
     * account are given one here, on the filming database only, as Operations & People would on
     * People · Employees: a number made from their name, the same every run.
     */
    const organisation = src("modules/organisation/organisation.service");
    const accountOf = (name) => {
      let h = 7;
      for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000_000;
      return `0${String(h).padStart(9, "0")}`;
    };
    for (const person of staff.everyone.filter((p) => OWN_ACCOUNT.includes(p.job_title))) {
      const { rows: bank } = await pool.query("SELECT bank_name FROM employee WHERE employee_id = $1", [person.employee_id]);
      const db = await pool.connect();
      try {
        await atomically(db, () => organisation.updateEmployee(db, person.employee_id, { bank_name: bank[0].bank_name || "Providus Bank", account_number: accountOf(`${person.first_name} ${person.last_name}`) }, ops));
      } finally {
        db.release();
      }
    }

    const { rows: none } = await pool.query("SELECT count(*)::int AS n FROM expense_category");
    if (!none[0].n) await categories.addSuggested(ops);
    const { rows: cats } = await pool.query("SELECT expense_category_id, name FROM expense_category WHERE active");
    const cat = new Map(cats.map((r) => [r.name, r.expense_category_id]));
    const { rows: depts } = await pool.query("SELECT department_id, name FROM department");
    const dept = new Map(depts.map((r) => [r.name, r.department_id]));

    const year = Number(lagos.today().slice(0, 4));
    for (const [name, lines] of Object.entries(BUDGETS))
      await budgets.create(ops, c.budgets.BudgetCreate.parse({ department_id: dept.get(name), year, lines: lines.map(([category, amount]) => ({ expense_category_id: cat.get(category), amount })) }));
    log(`[m8] ${Object.keys(BUDGETS).length} example budgets for ${year}`);

    const ALL = { scope: "all", scope_ids: null };
    const bode = titled("Chief Technology Officer");
    const chinyere = titled("Head, PR, Marketing & Brand Strategy");
    const site = await projects.create(await as(bode), ALL, { name: "Website Ticket Payments", description: "Three switchable payment gateways for event tickets on the website: Nomba, Paystack and our own." });
    await projects.setBudget(ops, site.project_id, "900000.00");
    await projects.create(await as(chinyere), ALL, { name: "Detty December Campaign", description: "MyCity's December campaign across Lagos: influencers, boosted posts and street activations." });
    const projectId = new Map([["Website Ticket Payments", site.project_id]]);

    const instanceOf = async (id) => (await pool.query("SELECT workflow_instance_id FROM expense_request WHERE expense_request_id = $1", [id])).rows[0].workflow_instance_id;
    const instance = async (id) => (await pool.query("SELECT state, current_stage FROM workflow_instance WHERE workflow_instance_id = $1", [id])).rows[0];
    const managerOf = (person) => staff.everyone.find((p) => p.employee_id === person.line_manager_id);

    const authorise = [];
    const pay = [];
    for (const r of REQUESTS) {
      const person = titled(r.by, r.nth || 0);
      const me = await as(person);
      const own = r.payee === "staff" && !r.payee_name;
      const made = await expenses.create(me, c.expenses.ExpenseCreate.parse({
        purpose: r.purpose,
        expense_category_id: cat.get(r.category),
        project_id: r.project ? projectId.get(r.project) : undefined,
        lines: r.lines.map(([description, quantity, unitPrice]) => ({ description, quantity, unit_price: unitPrice })),
        payee_type: r.payee,
        uses_profile_account: own,
        ...(own ? {} : { payee_name: r.payee_name, bank_name: r.bank_name, account_name: r.account_name, account_number: r.account_number }),
        submit: true,
      }));
      const id = made.expense_request_id;
      if (r.walk === "with_manager") continue;
      let inst = await instanceOf(id);
      if (r.walk === "rejected") {
        const at = await instance(inst);
        await workflow.decide(at.current_stage === "operations_people" ? ops : await as(managerOf(person)), inst, "reject", r.reason);
        await expenses.settle(id, (await instance(inst)).state, inst);
        continue;
      }
      if ((await instance(inst)).current_stage !== "operations_people") await workflow.decide(await as(managerOf(person)), inst, "approve");
      if (r.walk === "with_operations") continue;
      inst = await instanceOf(id);
      await workflow.decide(ops, inst, "approve");
      await expenses.settle(id, (await instance(inst)).state, inst);
      if (r.walk === "approved") continue;
      authorise.push(id);
      if (r.walk === "paid") pay.push({ id, r });
    }
    const req = await requisitions.create(ops, c.requisitions.RequisitionCreate.parse({ expense_request_ids: authorise }));
    await workflow.decide(ceo, req.workflow_instance_id, "approve");
    await requisitions.settle(req.requisition_id, (await instance(req.workflow_instance_id)).state);
    for (const { id, r } of pay)
      await disbursements.create(ops, c.disbursements.DisbursementCreate.parse({
        expense_request_id: id,
        paid_on: lagos.addDays(lagos.today(), -r.paid),
        ...(r.reference ? { payment_reference: r.reference } : { confirm_without_reference: true }),
      }));
    log(`[m8] ${REQUESTS.length} requests by MyCity's staff, ${pay.length} paid`);
  });
}

/* ------------------------------------------------------------------ *
 * The camera's hands
 * ------------------------------------------------------------------ */

const MY_REQUESTS = "/ess?tab=my-requests";
const APPROVALS = "/expenses?tab=approvals";
const REQUISITIONS = "/expenses?tab=requisitions";
/** The invoice JBS Praxis sent MyCity (TB, 13/11/2026): read by Read Invoice on camera. */
const INVOICE = () => process.env.M8_INVOICE || path.join(process.env.VIDEO_OUT || "/tmp/video/m8-expenses-1", "INV-202611-9525.pdf");

/** The dialog, sheet or confirmation on top. */
const dialog = (s) => s.page.locator("[role=dialog], [role=alertdialog]").last();
/** A record's window by its name, never a help term's popup (runbook §6.16). */
const record = (s) => s.page.getByRole("dialog", { name: "Expense Request" });
const form = (s, name = "New Request") => s.page.getByRole("dialog", { name });
const inForm = (s, label, name) => form(s, name).getByLabel(label, { exact: true }).first();
const button = (s, name, within) => (within || s.page).getByRole("button", { name, exact: true }).first();
/** A KPI tile: a button named by its label and its figure ("In Flight 1"). */
const tile = (s, label) => s.page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).first();
/** A request's row or card, by its purpose. */
const row = (s, words) => s.page.getByText(words, { exact: true }).first();

/** Glide to `loc` when it shows within a few seconds (an AI answer's parts differ from take to take, §6.12). */
async function soft(s, loc, wait = 4000) {
  if (await loc.waitFor({ state: "visible", timeout: wait }).then(() => true, () => false)) await s.hover(loc);
}

/** Wait for a toast that starts with `start` (the branded Toaster's), up to `seconds`. */
async function toastOf(s, start, seconds = 90) {
  const t = s.page.getByText(new RegExp(`^${start}`)).first();
  await t.waitFor({ state: "visible", timeout: seconds * 1000 }).catch(() => null);
}

/** Type a line of a request: its item, quantity and unit price (fields named "Item n"). */
async function line(s, n, item, quantity, price, name) {
  const f = form(s, name);
  await s.type(f.getByLabel(`Item ${n}`, { exact: true }), item, { delay: 30 });
  const q = f.getByRole("textbox", { name: "Quantity" }).nth(n - 1);
  await s.type(q, quantity, { delay: 60 });
  await s.type(f.getByRole("textbox", { name: "Unit Price" }).nth(n - 1), price, { delay: 60 });
}

/**
 * Ask Praxis AI in the box at the foot of Ask, and wait for its answer (a new Answer), however long
 * the model takes (§6.12): a question's choices, a card, or words.
 */
async function ask(s, words) {
  const p = s.page;
  const answers = () => p.getByRole("article", { name: "Answer" }).count();
  const before = await answers();
  await s.type(p.getByRole("textbox", { name: "Ask a Question" }), words, { delay: 24 });
  await s.click(p.getByRole("button", { name: "Send", exact: true }));
  for (let i = 0; i < 300 && (await answers()) <= before; i++) await s.wait(0.5);
  await s.settle();
}

/** Press one of the last answer's choices, and wait for the next answer. */
async function choose(s, name) {
  const p = s.page;
  const answers = () => p.getByRole("article", { name: "Answer" }).count();
  const before = await answers();
  await s.click(p.getByRole("article", { name: "Answer" }).last().getByRole("button", { name, exact: true }));
  for (let i = 0; i < 300 && (await answers()) <= before; i++) await s.wait(0.5);
  await s.settle();
}

module.exports = {
  id: "m8-expenses-1",
  file: "MyCity-M8-Expenses-Part-1-Raising-and-Approving",
  meta: { title: "MyCity App · Expenses, Part 1: Raising and Approving (Milestone 8)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 8 Handover · Part 1",
    title: "Expenses",
    subtitle: "Raising a request, and approving it",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 8 · Expenses · Part 1",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  prepare,
  people: {
    cynthia: (staff) => staff.operations.work_email,
    aaron: (staff) => staff.everyone.find((p) => p.job_title === "Social Media Manager").work_email,
    bode: (staff) => staff.everyone.find((p) => p.job_title === "Chief Technology Officer").work_email,
    chinyere: (staff) => staff.everyone.find((p) => p.job_title === "Head, PR, Marketing & Brand Strategy").work_email,
    similoluwa: (staff) => staff.everyone.find((p) => p.job_title === "Graphics Associate").work_email,
    bassey: (staff) => staff.everyone.find((p) => p.first_name === "Bassey").work_email,
  },
  chapters: [
    {
      name: "Welcome",
      shots: [
        {
          kind: "card",
          card: "opening",
          lines: [
            "Welcome to the walkthrough of Expenses, delivered in Milestone 8 of the MyCity hub.",
            "It is the first of two. This part raises requests and approves them. The second pays them, and keeps the budgets.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: REQUISITIONS,
          lines: [
            { say: "Expenses is under Business in the menu. It is how anyone at MyCity asks for company money.", do: (s) => s.hover(s.page.getByRole("link", { name: "Expenses" }).first()) },
            "Every request takes the same road, whatever its amount.",
            "The line manager approves it, then Operations and People.",
            { say: "Operations and People group approved requests into a requisition, and the CEO approves it.", do: (s) => s.hover(s.page.getByRole("tab", { name: "Requisitions", exact: true })) },
            { say: "Then each request is paid by bank transfer, and its bank reference recorded.", do: (s) => s.hover(s.page.getByRole("tab", { name: "Disbursements", exact: true })) },
            { say: "Approvals, Projects, Budgets and Categories are the other tabs.", do: async (s) => { for (const t of ["Approvals", "Projects", "Budgets", "Categories"]) { await s.hover(s.page.getByRole("tab", { name: t, exact: true })); await s.wait(0.25); } } },
            { say: "Your own requests are in Employee Self-Service, under My Requests.", do: (s) => s.hover(s.page.getByRole("link", { name: /^Employee Self-Service/ }).first()) },
            "Everyone sees their own. Line managers see their team's. Operations and People and the CEO see every one.",
            "We follow MyCity's own people: Aaron Agama, the Social Media Manager, and Bode Oluwasanmi, the Chief Technology Officer.",
            "Chinyere Elechi, Head of Branding and Marketing, approves for her team. Cynthia Osakunih, the Operations and People Lead, approves for the company.",
          ],
        },
      ],
    },
    {
      name: "Raising a Request",
      shots: [
        {
          kind: "phone",
          as: "aaron",
          start: MY_REQUESTS,
          label: { eyebrow: "On a staff member's phone", title: "My Requests", subtitle: "Aaron Agama asks to be paid back" },
          lines: [
            { say: "On his phone, Aaron opens Self-Service, then My Requests.", do: (s) => s.wait(0.5) },
            "The tiles count his requests In Flight, those Disbursed This Year, his Average Turnaround, and any Rejected.",
            "Below them, every request he has raised, newest first, with its stage.",
            "Last week Aaron paid for three Instagram boosts with his own card. Now he asks to be paid back.",
            { say: "He presses New Request. The form opens as a sheet.", do: (s) => s.click(button(s, "New Request")) },
            { say: "First the Purpose: what the money is for.", do: (s) => s.type(inForm(s, "Purpose"), "Instagram boosts, Detty December", { delay: 40 }) },
            { say: "Then each item on its own line: what it is, how many, and the price of each.", do: (s) => line(s, 1, "Instagram boost, 7 days", "3", "25,000") },
            { say: "Suggest Category picks the category from his purpose and items.", do: async (s) => { await s.click(button(s, "Suggest Category", form(s))); await toastOf(s, ".+ picked", 60); } },
            { say: "Advertising and Media. He could pick another under Category, filtered by type and searched by name.", do: async (s) => { await form(s).getByLabel("Purpose", { exact: true }).scrollIntoViewIfNeeded(); await s.wait(0.3); }, hold: 0.3 },
            { say: "The boosts were for the Detty December Campaign, so he picks that Project.", do: (s) => s.pick(inForm(s, "Project"), "Detty December Campaign") },
            { say: "The money comes back to him, so the Payee is Staff.", do: (s) => s.pick(inForm(s, "Payee"), "Staff") },
            { say: "He ticks Use My Company Account. It's paid into the bank account on his profile, so he types no bank details.", do: (s) => s.click(form(s).getByRole("checkbox", { name: "Use My Company Account" })) },
            "An invoice can be attached here too. Aaron's receipts are with Operations and People already.",
            { say: "He presses Send Request.", do: async (s) => { await s.click(button(s, "Send Request", form(s))); await toastOf(s, "EXP-\\d+ sent", 20); } },
            "It goes to his line manager, Chinyere Elechi, who is told at once.",
            { say: "His request waits on Line Manager. Save Draft would have kept it to finish later.", do: (s) => s.wait(0.5), hold: 0.4 },
          ],
        },
      ],
    },
    {
      name: "Reading an Invoice",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: MY_REQUESTS,
          lines: [
            "Bode Oluwasanmi runs MyCity's work with JBS Praxis on the website's ticket payments.",
            { say: "JBS Praxis has sent its invoice, INV-202611-9525. Bode raises the payment from My Requests." },
            { say: "New Request, and the Purpose.", do: async (s) => { await s.click(button(s, "New Request")); await s.type(inForm(s, "Purpose"), "JBS Praxis invoice INV-202611-9525", { delay: 32 }); } },
            { say: "Under Invoice he attaches the PDF JBS Praxis sent.", do: async (s) => { await s.hover(button(s, "Drop files here, or browse", form(s))); await form(s).locator("input[type=file]").setInputFiles(INVOICE()); await button(s, "Read Invoice", form(s)).waitFor({ timeout: 30000 }); } },
            { say: "He presses Read Invoice. The AI reads the payee, every line, and the category.", do: async (s) => { await s.click(button(s, "Read Invoice", form(s))); await toastOf(s, "Invoice (read|asks)", 120); } },
            { say: "Nothing is saved yet. Bode checks every line against the invoice.", do: (s) => s.scroll(-2000, form(s).getByLabel("Purpose", { exact: true })), hold: 0.3 },
            { say: "Four pieces of work, then two lines that take money off.", do: (s) => s.hover(form(s).getByLabel("Item 4", { exact: true })) },
            { say: "A discount of one hundred thousand naira, and three hundred thousand already paid as a deposit.", do: (s) => s.hover(form(s).getByRole("textbox", { name: "Unit Price" }).nth(5)) },
            { say: "A minus before the Unit Price takes it off. The Total is one hundred and fifty thousand naira: what the invoice asks for.", do: (s) => s.hover(form(s).getByText(/^Total/).first()) },
            { say: "Legal and Professional Services was picked from the invoice. He picks the Project, Website Ticket Payments.", do: (s) => s.pick(inForm(s, "Project"), "Website Ticket Payments") },
            { say: "The payee's name is read from the invoice. He writes it as the bank holds it.", do: (s) => s.type(inForm(s, "Payee Name"), "JBS Praxis Limited", { delay: 30 }) },
            { say: "The bank is typed or picked. Nombank MFB has been paid before, so it's on the list.", do: async (s) => { await s.type(inForm(s, "Bank"), "Nomb", { delay: 70 }); await s.click(s.page.getByRole("option", { name: /^Nombank MFB/ }).first()); } },
            { say: "Then the Account Name and Account Number, from How to Pay on the invoice.", do: async (s) => { await s.type(inForm(s, "Account Name"), "JBS Praxis Limited", { delay: 26 }); await s.type(inForm(s, "Account Number"), "5589994089", { delay: 70 }); } },
            { say: "He presses Send Request.", do: async (s) => { await s.click(button(s, "Send Request", form(s))); await toastOf(s, "EXP-\\d+ sent", 20); } },
            "Bode manages people himself, so his request skips the line manager. It goes straight to Operations and People.",
          ],
        },
      ],
    },
    {
      name: "Following a Request",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: MY_REQUESTS,
          lines: [
            { say: "In Flight counts Bode's requests still on their way. Pressing it lists them.", do: async (s) => { await s.click(tile(s, "In Flight")); await s.wait(1.2); await s.click(button(s, "Close", dialog(s))); } },
            { say: "He opens his request. Its lines, its total, its payee, and the invoice.", do: (s) => s.click(row(s, "JBS Praxis invoice INV-202611-9525")) },
            { say: "Possible Duplicate: another request went to the same payee, for the same amount, within 30 days.", do: (s) => soft(s, record(s).getByText("Possible Duplicate", { exact: true })) },
            { say: "The route shows who it waits on now: Operations and People.", do: (s) => soft(s, record(s).getByRole("list", { name: "Approval route" })) },
            { say: "History records every step, who took it, and when.", do: (s) => s.scroll(500, record(s).getByRole("heading", { name: "History" })) },
            { say: "Until Operations and People approve, he can press Cancel Request. After that, only they can withdraw it.", do: (s) => soft(s, button(s, "Cancel Request", record(s))) },
            "Nothing in a sent request is changed. A change is a Send Back, as we'll see next.",
          ],
        },
      ],
    },
    {
      name: "The Line Manager",
      shots: [
        {
          kind: "desktop",
          as: "chinyere",
          start: APPROVALS,
          lines: [
            { say: "Chinyere Elechi is told of Aaron's request in the bell. Approvals lists everything waiting on her.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Approvals", level: 1 })) },
            { say: "The tiles count requests With You, their Total Value, the Oldest, and those she Approved This Month.", do: (s) => s.hover(tile(s, "With You")) },
            { say: "She opens Aaron's Instagram boosts.", do: (s) => s.click(row(s, "Instagram boosts, Detty December")) },
            { say: "Budget Left is what Branding and Marketing has left for Advertising and Media this year.", do: (s) => soft(s, record(s).getByText("Budget Left", { exact: true })) },
            { say: "Department Left is the department's whole budget left. Over Budget would show at the top, before anyone approves.", do: (s) => soft(s, record(s).getByText("Department Left", { exact: true })) },
            { say: "It's within budget, and Aaron's account is on his profile. She presses Approve.", do: (s) => s.click(button(s, "Approve", record(s))), hold: 0.4 },
            "It moves on to Operations and People. Aaron is told at each step.",
          ],
        },
      ],
    },
    {
      name: "Send Back and Send Again",
      shots: [
        {
          kind: "desktop",
          as: "chinyere",
          start: APPROVALS,
          lines: [
            { say: "Similoluwa Michael's studio props come as one line for everything.", do: (s) => s.click(row(s, "Studio props, product shoot")) },
            { say: "Chinyere presses Send Back, and writes why.", do: async (s) => { await s.click(button(s, "Send Back", record(s))); await s.type(inForm(s, "Reason", "Send Back EXP-0009"), "Split the props and the backdrop into two lines, please.", { delay: 22 }); } },
            { say: "Send Back. The request goes back to Similoluwa, with the reason.", do: (s) => s.click(button(s, "Send Back", form(s, "Send Back EXP-0009"))), hold: 0.4 },
            "Reject would end it, also with a reason. Neither is ever silent.",
          ],
        },
        {
          kind: "desktop",
          as: "similoluwa",
          start: MY_REQUESTS,
          lines: [
            { say: "Similoluwa is told in the bell. On My Requests, hers reads Sent Back.", do: (s) => s.hover(row(s, "Studio props, product shoot")) },
            { say: "She opens it. Chinyere's reason is in its History.", do: (s) => s.click(row(s, "Studio props, product shoot")) },
            { say: "She presses Edit Request, and splits the line in two.", do: async (s) => { await s.click(button(s, "Edit Request", record(s))); await line(s, 1, "Props", "1", "50,000", "Edit Request"); await s.click(button(s, "Add Line", form(s, "Edit Request"))); await line(s, 2, "Backdrop and stand", "1", "35,000", "Edit Request"); } },
            { say: "Send Again. It starts again with her line manager, as a new approval.", do: async (s) => { await s.click(button(s, "Send Again", form(s, "Edit Request"))); await toastOf(s, "EXP-\\d+ sent", 20); }, hold: 0.4 },
          ],
        },
      ],
    },
    {
      name: "Operations and People",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: APPROVALS,
          lines: [
            { say: "Every request reaches Operations and People next. Cynthia has three waiting.", do: (s) => s.hover(tile(s, "With You")) },
            { say: "She opens Bode's JBS Praxis payment.", do: (s) => s.click(s.page.getByRole("row").filter({ hasText: "Bode Oluwasanmi" }).first()) },
            { say: "Open Invoice downloads the PDF Bode attached, to check against the lines.", do: (s) => s.hover(button(s, "Open Invoice", record(s))) },
            { say: "It's flagged Possible Duplicate. Check Duplicate asks the AI to compare the two.", do: async (s) => { await s.click(button(s, "Check Duplicate", record(s))); await record(s).getByText(/^(Likely repeats|Looks different|Nothing to compare)/).first().waitFor({ timeout: 90000 }).catch(() => null); } },
            { say: "It likely repeats EXP-0008: Oladotun Shola-Adido raised the same invoice earlier today.", do: (s) => soft(s, record(s).getByText(/^Likely repeats/).first()) },
            "The AI only compares. The approver decides.",
            { say: "Bode's request has every line and the project, so Cynthia approves it.", do: (s) => s.click(button(s, "Approve", record(s))), hold: 0.4 },
            { say: "She opens Oladotun's copy, and presses Reject.", do: async (s) => { await s.click(s.page.getByRole("row").filter({ hasText: "Oladotun Shola-Adido" }).first()); await s.click(button(s, "Reject", record(s))); } },
            { say: "She writes why, and presses Reject Request. Oladotun is told, with her reason.", do: async (s) => { await s.type(dialog(s).getByLabel("Reason", { exact: true }), "Raised twice. Paid on Bode's request.", { delay: 24 }); await s.click(button(s, "Reject Request", dialog(s))); }, hold: 0.4 },
            { say: "Aaron's boosts are within budget. She approves them too.", do: async (s) => { await s.click(row(s, "Instagram boosts, Detty December")); await s.click(button(s, "Approve", record(s))); }, hold: 0.4 },
            { say: "Approved requests wait on Requisitions, for the CEO. Part two starts there.", do: (s) => s.hover(s.page.getByRole("tab", { name: "Requisitions", exact: true })) },
          ],
        },
      ],
    },
    {
      name: "Raising One by Chat",
      shots: [
        {
          kind: "desktop",
          as: "bassey",
          start: "/praxis-ai?tab=ask",
          lines: [
            "A request can be raised from Praxis AI too. Bassey Ekpe, a Content and Listing Associate, asks in his own words.",
            { say: "Raise an expense request for my listing visits to Yaba next week.", do: (s) => ask(s, "Raise an expense request for my listing visits to Yaba next week") },
            { say: "Praxis AI asks what it needs, a question at a time. First the category.", do: (s) => choose(s, "Travel and Transport"), hold: 0.3 },
            { say: "Then what he's paying for, how many, and how much each.", do: (s) => ask(s, "Ride-hailing return trips to Yaba, 4 of them, 5,500 each") },
            { say: "Who is it paid to? Bassey presses Staff.", do: (s) => choose(s, "Staff"), hold: 0.3 },
            { say: "The card shows the request as it will be sent: its purpose, category, line and payee.", do: (s) => soft(s, s.page.getByRole("article", { name: "Answer" }).last().getByText("Purpose", { exact: true }), 15000) },
            { say: "Edit changes a field first. Nothing is saved until he presses.", do: (s) => soft(s, s.page.getByRole("article", { name: "Answer" }).last().getByRole("button", { name: "Edit", exact: true })) },
            { say: "He presses New Request. It's sent, with the same checks and the same road as one from the form.", do: async (s) => { const card = s.page.getByRole("article", { name: "Answer" }).last(); await s.click(card.getByRole("button", { name: "New Request", exact: true })); await s.wait(2.5); await s.settle(); }, hold: 1 },
          ],
        },
      ],
    },
    {
      name: "Wrapping Up",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: REQUISITIONS,
          lines: [
            { say: "That's Expenses' first half, from a new request to Operations and People's approval.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Approved Requests" })) },
            "Part two groups these into a requisition for the CEO, pays them, and keeps each budget.",
          ],
        },
        {
          kind: "card",
          card: "closing",
          lines: ["Every step is also written up in the User Guide, in the Knowledge Hub. Thank you for watching."],
        },
      ],
    },
  ],
};

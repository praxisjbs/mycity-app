"use strict";
/**
 * Milestone 4 handover, part 1 of 2: Vacancies, the careers page, Apply and the candidates board.
 * docs/runbooks/training-videos.md says how a scene is written and filmed, and §8 the chapter plan.
 *
 * The chapters run in order on one filming database, each picking up where the one before left it:
 * chapter 3 publishes the Copywriter role that chapters 4 and 5 change, chapter 7's applicant is
 * the one chapters 8 to 11 screen, move and keep.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mail = require("../mail");

const VACANCIES = "/recruitment?tab=vacancies";
const CANDIDATES = "/recruitment?tab=candidates";
const SALES = "Head, Sales & Revenue";
/** The candidate who applies on camera: invented, as every candidate here is. */
const BISI = { name: "Bisi Adewale", email: "bisi.adewale@example.test", phone: "8035550147" };

const dialog = (s) => s.page.getByRole("dialog").last();
const inDialog = (s, label) => dialog(s).getByLabel(label, { exact: true }).first();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
/** A card on the board, by the candidate's name. */
const card = (s, name) => s.page.locator("li").filter({ has: s.page.getByText(name, { exact: true }) }).first();
/** A board column, by its stage: each is a section named for it, inside the Board region. */
const column = (s, label) => s.page.getByRole("region", { name: "Board" }).getByRole("region", { name: label, exact: true });

/** The invented CV the candidate sends, printed to a PDF as a candidate's would be. */
async function inventedCv(context) {
  const file = path.join(os.tmpdir(), "mycity-video", "Bisi-Adewale-CV.pdf");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const page = await context.newPage();
  await page.setContent(`<html><body style="font-family:Arial;margin:48px;color:#111">
    <h1 style="margin:0">Bisi Adewale</h1><p>Lagos · ${BISI.email} · 0803 555 0147</p>
    <h2>Profile</h2><p>Commercial leader with eleven years in B2B sales across media and events in Lagos, five of them leading a sales team of eight.</p>
    <h2>Experience</h2>
    <p><b>Head of Sales, Lagos Live Media</b> (2021 to now)<br>Led a team of eight selling advertising and event sponsorship. Grew revenue from ₦310 million to ₦540 million in three years. Won and renewed the three largest venue accounts.</p>
    <p><b>Senior Account Manager, Eko Events</b> (2016 to 2021)<br>Managed 40 brand and venue partners. Built the yearly packages for festival sponsors.</p>
    <p><b>Sales Executive, City Billboards Ltd</b> (2014 to 2016)</p>
    <h2>Education</h2><p>BSc Marketing, University of Lagos, 2013</p>
    <h2>Skills</h2><p>Pipeline reviews, pricing and packages, partner renewals, revenue forecasting, coaching</p>
    <p style="color:#888;font-size:11px">An invented CV for a demonstration.</p></body></html>`);
  await page.pdf({ path: file, format: "A4" });
  await page.close();
  return file;
}

/** Wait until the board shows no Provisional score for `names` (the AI has read them), reloading it. */
async function untilRead(s, names, seconds = 90) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    let waiting = 0;
    for (const n of names) if (await card(s, n).getByText("Provisional", { exact: true }).isVisible().catch(() => false)) waiting++;
    if (!waiting) return;
    await s.wait(3);
    await s.page.getByRole("button", { name: "Refresh", exact: true }).first().click().catch(() => null);
    await s.settle();
  }
}

module.exports = {
  id: "m4-recruitment-1",
  file: "MyCity-M4-Recruitment-Part-1-Vacancies-and-Candidates",
  meta: { title: "MyCity App · Recruitment, Part 1: Vacancies and Candidates (Milestone 4)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 4 Handover · Part 1",
    title: "Recruitment",
    subtitle: "Vacancies, the careers page and the candidates board",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 4 · Recruitment · Part 1",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    // The Implementation Team's account (create-admin --build-account): the roles' hiring manager.
    team: (staff) => staff.everyone.find((p) => p.job_title === "Implementation Partner").work_email,
  },
  chapters: [
    {
      name: "Welcome",
      shots: [
        {
          kind: "card",
          card: "opening",
          lines: [
            "Welcome to Recruitment, delivered in Milestone 4 of the MyCity hub.",
            "This is the first of two walkthroughs. It covers vacancies, the careers page,|applying on a phone, and the candidates board, through to the Talent Pool.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: "/",
          lines: [
            { say: "You'll find it in the menu, under Recruitment.", do: (s) => s.click(s.page.getByRole("link", { name: "Recruitment", exact: true }).first()) },
            { say: "Its tabs run from Vacancies to Talent Pool. Offers and Onboarding belong to Milestone 5.", do: (s) => s.hover("Talent Pool") },
            "Operations and People, Management, the Implementation team and the CEO see every vacancy.",
            "A Head of Department sees the roles whose hiring manager is in their team,|and anyone on an interview panel sees that interview.",
            "Every candidate in this walkthrough is invented, so no real applicant is involved.",
          ],
        },
      ],
    },
    {
      name: "Reading Vacancies",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: VACANCIES,
          lines: [
            "Cynthia Osakunih, the Operations and People Lead, runs recruitment.",
            { say: "Along the top, the tiles count the open vacancies, the applicants,|those in interview, and roles past their closing date.", do: (s) => s.hover(text(s, "Open Vacancies")) },
            { say: "The list shows each role with its department, openings, location,|applicants, closing day and status.", do: (s) => s.hover(s.page.getByRole("row").nth(3)) },
            { say: "Press a vacancy, and it opens beside the list.", do: (s) => s.click(text(s, SALES)) },
            { say: "It shows the role's details and its public link. Copy Link shares it.", do: (s) => s.hover("Copy Link") },
            { say: "Below are its scorecard weights, its candidates at each stage,|and the traits its interview panel will rate.", do: (s) => s.scroll(420, text(s, "Copy Link")) },
            { say: "Under the list, the funnel shows how many candidates stand at each stage, across every role.", do: (s) => s.hover(text(s, "Funnel, All Roles")) },
            { say: "Careers Page opens the public site, as a candidate sees it.", do: (s) => s.hover("Careers Page") },
            { say: "See Candidates opens the role's candidates on the board.", do: async (s) => { await s.scroll(-2000); await s.click(text(s, SALES)); await s.hover("See Candidates"); } },
          ],
        },
      ],
    },
    {
      name: "Writing a Vacancy",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: VACANCIES,
          lines: [
            { say: "Cynthia is hiring a copywriter. She presses New Vacancy.", do: (s) => s.click("New Vacancy") },
            { say: "It asks about the role one question at a time. The bar counts them.", do: (s) => s.hover(dialog(s).getByRole("progressbar")) },
            { say: "Only the job title is needed.", do: async (s) => { await s.type(inDialog(s, "Job Title"), "Copywriter"); await s.click(dialog(s).getByRole("button", { name: "Next", exact: true })); } },
            {
              say: "She picks the hiring manager, the JBS Praxis Team, and the department.",
              do: async (s) => {
                await s.type(dialog(s).getByRole("searchbox", { name: "Hiring Manager" }), "JBS");
                await dialog(s).getByRole("option", { name: /^Aaron Agama/ }).waitFor({ state: "detached" });
                await s.click(dialog(s).getByRole("option", { name: /^JBS Praxis Team/ }));
                await dialog(s).getByRole("button", { name: "Remove JBS Praxis Team" }).waitFor();
                await s.pick("Department", "Branding & Marketing");
              },
            },
            { say: "One full time position.", do: async (s) => { await s.click(dialog(s).getByRole("button", { name: "Next", exact: true })); await s.wait(0.6); await s.click(dialog(s).getByRole("button", { name: "Next", exact: true })); } },
            { say: "The role is remote, so the question about where it's based is passed over.", do: async (s) => { await s.click(dialog(s).getByRole("radio", { name: "Remote" })); await s.click(dialog(s).getByRole("button", { name: "Next", exact: true })); } },
            {
              say: "She types the monthly salary band.",
              do: async (s) => {
                await s.type(inDialog(s, "Salary From"), "350,000", { delay: 70 });
                await s.type(inDialog(s, "Salary To"), "500,000", { delay: 70 });
                await s.click(dialog(s).getByRole("button", { name: "Next", exact: true }));
              },
            },
            {
              say: "Then, in her own words, what the role must have and what it will do.",
              do: async (s) => {
                await s.type(inDialog(s, "Your Answer"), "Three years writing for brands. Writes our app copy, campaigns and partner emails.", { delay: 24 });
                await s.type(inDialog(s, "Years of Experience"), "3", { delay: 80 });
              },
            },
            { say: "Any question she can't answer yet, she presses Skip.", do: async (s) => { await s.click(dialog(s).getByRole("button", { name: "Next", exact: true })); await s.click(dialog(s).getByRole("button", { name: "Skip", exact: true })); } },
            { say: "The hub then asks two questions of its own, about this role.", do: (s) => s.hover(dialog(s).getByRole("heading", { level: 3 })), hold: 0.6 },
            {
              say: "She answers the first, and skips the second.",
              do: async (s) => {
                await s.type(inDialog(s, "Your Answer"), "Figma, Google Docs and our app's content tool.", { delay: 26 });
                await s.click(dialog(s).getByRole("button", { name: "Next", exact: true }));
              },
            },
            { say: "Draft Vacancy writes the vacancy from her answers.", do: async (s) => { await s.click(dialog(s).getByRole("button", { name: "Draft Vacancy", exact: true })); await dialog(s).getByRole("heading", { name: "Role", exact: true }).waitFor({ timeout: 60000 }); } },
            { say: "It opens in three steps: Role, Details, and Pay and Publish.", do: (s) => s.hover(dialog(s).getByRole("list", { name: "Steps" })) },
            {
              say: "On Details is the drafted description,|with the experience it requires and what we look for.",
              do: async (s) => { await s.click(dialog(s).getByRole("button", { name: "Next", exact: true })); await s.scroll(380, inDialog(s, "Description")); },
              hold: 0.8,
            },
            { say: "Closes On is the day it stops taking applications. A month ahead is filled in.", do: async (s) => { await s.scroll(-380, inDialog(s, "Description")); await s.hover(inDialog(s, "Closes On")); } },
            { say: "On the last step, Publish Now is ticked.", do: async (s) => { await s.click(dialog(s).getByRole("button", { name: "Next", exact: true })); await s.hover(dialog(s).getByText("Publish Now", { exact: true })); } },
            { say: "She presses Publish Vacancy, and the role is on the careers page.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Publish Vacancy", exact: true })), hold: 0.6 },
            {
              say: "An empty seat on the organogram is listed under Suggested From Organogram.|Create Vacancy starts its vacancy with the seat's details filled in.",
              do: async (s) => { await s.scroll(1400); await s.hover(s.page.getByRole("button", { name: "Create Vacancy", exact: true }).first()); },
            },
          ],
        },
      ],
    },
    {
      name: "Questions, Scorecard and Emails",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: VACANCIES,
          setup: (s) => s.click(text(s, "Copywriter")),
          lines: [
            { say: "Each vacancy has its own questions. Cynthia presses Questions.", do: (s) => s.click("Questions") },
            { say: "Apply questions are on the form a candidate fills in.|Interview traits are what each panelist rates, from 1 to 10.", do: (s) => s.hover(dialog(s).getByRole("heading", { name: "Interview Traits" })) },
            { say: "She presses Suggest With AI for questions that fit this role.", do: async (s) => { await s.scroll(-2000, dialog(s).getByRole("heading", { name: "Apply Questions" })); await s.click(dialog(s).getByRole("button", { name: "Suggest With AI", exact: true })); await s.wait(1); } },
            { say: "She keeps the ones she wants, changes their words, and saves them.", do: (s) => s.scroll(320, dialog(s).getByRole("heading", { name: "Apply Questions" })), hold: 0.8 },
            { say: "She presses Save Questions.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Save Questions", exact: true })) },
            { say: "The scorecard ranks the role's candidates in five parts.", do: (s) => s.click("Scorecard") },
            {
              say: "A copywriter takes no psychometric test. She gives its weight to the technical part,|and switches it off.",
              do: async (s) => {
                // Technical's weight first: once Psychometric is off, its weight field goes.
                await s.type(dialog(s).getByRole("textbox", { name: "Weight" }).nth(2), "40", { delay: 90 });
                await s.click(dialog(s).getByRole("checkbox", { name: "Psychometric" }));
              },
            },
            { say: "The parts left on must add up to 100. She presses Save Scorecard.", do: async (s) => { await s.hover(dialog(s).getByText(/^Total/)); await s.click(dialog(s).getByRole("button", { name: "Save Scorecard", exact: true })); } },
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: VACANCIES,
          lines: [
            { say: "Candidate Emails holds the eight emails candidates receive.", do: (s) => s.click("Candidate Emails") },
            { say: "She opens one to change its words.", do: (s) => s.click(dialog(s).getByText("Application Received", { exact: true })) },
            { say: "Words in double braces, like the vacancy's title, are filled in by the hub.", do: (s) => s.hover(dialog(s).getByText("{{ vacancy_title }}", { exact: true }).last()) },
            { say: "Save Email uses the new words from the next email. Once changed, Restore Default puts MyCity's wording back.", do: (s) => s.hover(dialog(s).getByRole("button", { name: "Save Email", exact: true })) },
            { say: "Careers Settings holds the paragraph every vacancy opens with,|and the default traits a new vacancy starts with.", do: async (s) => { await s.click(dialog(s).getByRole("button", { name: "Cancel", exact: true })); await s.click(dialog(s).getByRole("button", { name: "Close", exact: true }).last()); await s.click("Careers Settings"); } },
            { say: "Only someone who may change every vacancy can save these.", do: (s) => s.scroll(300, inDialog(s, "Default Trait 1")) },
          ],
        },
      ],
    },
    {
      name: "Pause, Resume and Close",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: VACANCIES,
          setup: (s) => s.click(text(s, "Copywriter")),
          lines: [
            { say: "To stop applications for a while, Cynthia presses Pause.", do: (s) => s.click("Pause") },
            { say: "A paused role takes no applications, but its link keeps working, and says so.", do: (s) => s.hover(s.page.getByRole("row").filter({ hasText: "Copywriter" })) },
            { say: "Resume takes applications again.", do: (s) => s.click("Resume") },
            { say: "The Content Producer role is on hold. She opens it and presses Close Vacancy.", do: async (s) => { await s.click(text(s, "Content Producer")); await s.click("Close Vacancy"); } },
            { say: "She picks why: filled, cancelled, or on hold.", do: (s) => s.click(dialog(s).getByRole("radio", { name: "On Hold" })) },
            { say: "One candidate is still in progress. Not Progress All tells them now.", do: (s) => s.click(dialog(s).getByRole("checkbox", { name: "Not Progress All" })) },
            { say: "She presses Close Vacancy. A closed vacancy can never be opened again.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Close Vacancy", exact: true })), hold: 0.6 },
          ],
        },
      ],
    },
    {
      name: "The Careers Page",
      shots: [
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "On a candidate's phone", title: "The Careers Page", subtitle: "Open roles, as anyone sees them at go.mycityapp.io" },
          lines: [
            "Published roles appear on the careers page, closing soonest first.",
            { say: "Each shows its team, its area, how it's worked, and the day it closes.", do: (s) => s.scroll(260) },
            { say: "A candidate presses a role to read it.", do: (s) => s.click(text(s, SALES)) },
            { say: "The Role card holds the employment type, the working days, the experience asked for,|and who the role reports to.", do: (s) => s.scroll(420) },
            { say: "Then the overview, what the role requires, and what we're looking for.", do: (s) => s.scroll(900) },
            { say: "How We Hire lists the stages this role uses.", do: (s) => s.scroll(1400) },
          ],
        },
      ],
    },
    {
      name: "Applying on a Phone",
      shots: [
        {
          kind: "phone",
          site: "go",
          start: "/jobs/head-sales-revenue-lagos",
          label: { eyebrow: "On a candidate's phone", title: "Apply", subtitle: "Bisi Adewale, an invented candidate, applies" },
          setup: async (s) => { s.cv = await inventedCv(s.page.context()); },
          lines: [
            { say: "Bisi Adewale wants the role. She presses Apply.", do: (s) => s.click(s.page.getByRole("button", { name: "Apply", exact: true }).last()) },
            {
              say: "On About You, she types her name, email and phone, and her years of experience.",
              do: async (s) => {
                await s.type("Full Name", BISI.name, { delay: 30 });
                await s.type("Email", BISI.email, { delay: 18 });
                await s.type("Phone", BISI.phone, { delay: 30 });
                await s.type("Years of Experience", "11", { delay: 60 });
              },
            },
            {
              say: "On the next step, she presses Choose Your CV and picks her PDF.",
              do: async (s) => {
                await s.click("Next");
                const [chooser] = await Promise.all([s.page.waitForEvent("filechooser"), s.click(s.page.getByRole("button", { name: /^Choose Your CV/ }))]);
                await chooser.setFiles(s.cv);
                await s.page.getByRole("button", { name: "Replace", exact: true }).waitFor();
              },
            },
            {
              say: "She answers the role's own questions.",
              do: async (s) => {
                await s.click(s.page.getByRole("radio", { name: "Yes", exact: true }));
                await s.type("The largest deal you closed, and your part in it", "A two year sponsorship with a Lagos festival. I led the pitch.", { delay: 20 });
              },
            },
            {
              say: "On Why This Role, she writes why she wants it.",
              do: async (s) => {
                await s.click("Next");
                await s.type("Why This Role", "I have grown media sales in Lagos for eleven years, and I want to build MyCityApp's team.", { delay: 18 });
              },
            },
            { say: "She ticks the privacy notice. The form can't be sent without it.", do: (s) => s.click(s.page.getByRole("checkbox").last()) },
            { say: "She presses Submit Application.", do: (s) => s.click("Submit Application") },
            { say: "The page gives her reference. She quotes it if she writes to MyCity.", do: (s) => s.hover(text(s, "Your Reference")), hold: 0.8 },
          ],
        },
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "In the candidate's inbox", title: "Application Received", subtitle: "The email the hub sends, as it arrives" },
          setup: async (s) => {
            const got = await mail.message(BISI.email, "application-received");
            await s.page.setContent(got.html);
          },
          lines: [
            "The hub emails her at once, with the same reference.",
            { say: "Its words are the Application Received email in Candidate Emails.", hold: 0.6 },
          ],
        },
      ],
    },
    {
      name: "The Candidates Board",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: CANDIDATES,
          lines: [
            { say: "Candidates is the board: each application a card, in a column for its stage.", do: (s) => s.hover(column(s, "Applied").getByRole("heading")) },
            { say: "The tiles count the candidates, those to screen, those in interview, and those shortlisted.", do: (s) => s.hover(text(s, "To Screen")) },
            { say: "Cynthia picks Head, Sales and Revenue in the vacancy filter.", do: (s) => s.pick("Vacancy", SALES) },
            { say: "The columns run from Applied to Shortlist, the best weighted total first.", do: (s) => s.hover(column(s, "Shortlist").getByRole("heading")) },
            { say: "Each card shows the name, the screening score, and the days at its stage.", do: (s) => s.hover(card(s, BISI.name)) },
            { say: "Provisional means the score is an estimate from the form only. The CV hasn't been read yet.", do: (s) => s.hover(card(s, BISI.name).getByText("Provisional", { exact: true })) },
            { say: "She presses Bisi's card, and Bisi opens beside the board.", do: (s) => s.click(card(s, BISI.name).getByText(BISI.name, { exact: true })) },
            { say: "Her details, her CV with View CV, and the answers she gave.", do: (s) => s.hover("View CV") },
            { say: "Weighted Total adds up each part's score with the role's weights. One part is scored so far.", do: (s) => s.scroll(300, "View CV") },
            { say: "Stage History lists each move, who made it, and when.", do: (s) => s.scroll(700, "View CV"), hold: 0.6 },
          ],
        },
      ],
    },
    {
      name: "Screening With AI",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: `${CANDIDATES}&vacancy=`,
          setup: (s) => s.pick("Vacancy", SALES),
          lines: [
            { say: "Screen With AI reads every candidate of a role who has no AI score yet.", do: (s) => s.click("Screen With AI") },
            { say: "The role in the filter is picked already. She types a condition a CV must meet.", do: (s) => s.type(inDialog(s, "Must Meet 1"), "Under 40 years old", { delay: 40 }) },
            { say: "A condition about age is refused, as is one about sex, religion, tribe or state of origin.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Screen Applications", exact: true })), hold: 0.8 },
            {
              say: "She writes one about experience instead, and presses Add Condition for a second.",
              do: async (s) => {
                await s.type(inDialog(s, "Must Meet 1"), "Eight years or more in B2B sales", { delay: 30 });
                await s.click(dialog(s).getByRole("button", { name: "Add Condition", exact: true }));
                await s.type(inDialog(s, "Must Meet 2"), "Has led a sales team", { delay: 30 });
              },
            },
            { say: "She presses Screen Applications. The candidates are read one by one.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Screen Applications", exact: true })), hold: 0.6 },
            { say: "As each is read, its score replaces the estimate, and Provisional goes.", do: (s) => untilRead(s, ["Kunle Afolabi"], 20), hold: 0.6 },
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: CANDIDATES,
          // Off camera, until every one of the role's candidates has been read.
          setup: async (s) => { await s.pick("Vacancy", SALES); await untilRead(s, [BISI.name, "Chinedu Okafor", "Funke Bakare", "Emeka Obi", "Tobi Adeyemi", "Halima Yusuf", "Kunle Afolabi"], 180); },
          lines: [
            { say: "Once all are read, Bisi's card carries the AI's score, at the top of her column.", do: (s) => s.click(card(s, BISI.name).getByText(BISI.name, { exact: true })) },
            { say: "Under Screening is its summary: which conditions she meets, and what it could not check.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Screening", exact: true })), hold: 1.2 },
            { say: "A score never moves, rejects or hides anyone. A person does.", hold: 0.4 },
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: CANDIDATES,
          lines: [
            { say: "Score With AI reads one candidate. Cynthia opens Zainab Ibrahim, a designer.", do: (s) => s.click(card(s, "Zainab Ibrahim").getByText("Zainab Ibrahim", { exact: true })) },
            { say: "She presses Score With AI. Each candidate is read once.", do: async (s) => { await s.click("Score With AI"); await s.page.getByText("Provisional", { exact: true }).first().waitFor({ state: "attached" }).catch(() => null); }, hold: 0.8 },
          ],
        },
      ],
    },
    {
      name: "Moving and Stopping",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: CANDIDATES,
          setup: (s) => s.pick("Vacancy", SALES),
          lines: [
            { say: "To move a candidate, Cynthia drags the card to its new column.", do: (s) => s.drag(card(s, BISI.name), column(s, "Screening")) },
            { say: "A card can move to any stage ahead, or one stage back. Each move goes in Stage History.", do: (s) => s.hover(card(s, BISI.name)) },
            { say: "Or she opens the candidate and presses the button for the stage.", do: (s) => s.click(card(s, "Chinedu Okafor").getByText("Chinedu Okafor", { exact: true })) },
            { say: "Chinedu moves to Screening.", do: (s) => s.click("Move to Screening") },
            { say: "Funke Bakare doesn't meet the role. Cynthia opens her and presses Not Progressing.", do: async (s) => { await s.click(card(s, "Funke Bakare").getByText("Funke Bakare", { exact: true })); await s.click("Not Progressing"); } },
            { say: "She types the reason. Only staff read it.", do: (s) => s.type(inDialog(s, "Reason"), "Six years in sales, none of them leading a team.", { delay: 22 }) },
            { say: "Funke is emailed that she isn't going further, and her links stop working.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Not Progressing", exact: true })), hold: 0.6 },
            { say: "Reopen brings a candidate back to the stage they left.", do: (s) => s.hover("Reopen"), hold: 0.6 },
          ],
        },
      ],
    },
    {
      name: "Talent Pool",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: CANDIDATES,
          setup: (s) => s.pick("Status", "Not Progressing"),
          lines: [
            { say: "Funke is a good seller, worth keeping for a later role.", do: (s) => s.click(card(s, "Funke Bakare").getByText("Funke Bakare", { exact: true })) },
            { say: "Cynthia presses Add to Pool, and types why she's worth keeping.", do: async (s) => { await s.click("Add to Pool"); await s.type(inDialog(s, "Why Keep Them"), "A strong seller with venue accounts; one for a sales associate role.", { delay: 20 }); } },
            { say: "She presses Add to Pool. Funke is kept in the Talent Pool for 24 months.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Add to Pool", exact: true })), hold: 0.4 },
            { say: "The Talent Pool tab lists everyone kept.", do: (s) => s.click(s.page.getByRole("tab", { name: "Talent Pool", exact: true })) },
            { say: "The tiles count who is in the pool, those invited back, those hired from it, and their average score.", do: (s) => s.hover(text(s, "In the Pool")) },
            { say: "Each person shows the role they applied for, their score, why they were kept,|and Kept Until, the day they leave the pool by themselves.", do: (s) => s.click(text(s, "Femi Lawal")) },
            { say: "To invite Femi to a later role, she presses Invite to Apply and picks the open vacancy.", do: async (s) => { await s.click("Invite to Apply"); await s.pick("Vacancy", "Copywriter"); } },
            { say: "She presses Send Invitation. Femi gets an Apply link that works for seven days.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Send Invitation", exact: true })), hold: 0.4 },
            { say: "Invite to Apply on the board does the same for someone she has found herself.", hold: 0.2 },
            { say: "Remove takes a person out of the pool. Export makes the list a workbook.", do: async (s) => { await s.hover("Remove"); await s.hover("Export"); } },
          ],
        },
      ],
    },
    {
      name: "Wrapping Up",
      shots: [
        {
          kind: "card",
          card: "closing",
          extra: 1.6,
          lines: [
            "That's Recruitment's first half, from a new vacancy to the Talent Pool.",
            "The second walkthrough covers assessments, interviews and the shortlist.",
            "Every step is also written up in the User Guide, in the Knowledge Hub.",
            "Thank you for watching.",
          ],
        },
      ],
    },
  ],
};

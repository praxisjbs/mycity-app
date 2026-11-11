"use strict";
/**
 * Milestone 4 handover, part 2 of 2: Assessments and Interviews, then the shortlist and the hand-off
 * to Offers. docs/runbooks/training-videos.md says how a scene is written and filmed, and §8 the plan.
 *
 * Filmed on the database part 1 leaves (runbook §8): Bisi Adewale, who applied on camera there, is
 * at Screening for Head, Sales & Revenue. Here she is sent a test she takes on her phone, is marked,
 * interviewed by a panel of two and shortlisted. The chapters run in order, each on the one before.
 */
const mail = require("../mail");

const ASSESSMENTS = "/recruitment?tab=assessments";
const CANDIDATES = "/recruitment?tab=candidates";
const INTERVIEWS = "/recruitment?tab=interviews";
const SALES = "Head, Sales & Revenue";
const BISI = { name: "Bisi Adewale", email: "bisi.adewale@example.test" };
const TEST = "Sales Pitch Exercise";

/** The dialog or sheet on top, a confirmation (an alert dialog) included. */
const dialog = (s) => s.page.locator("[role=dialog], [role=alertdialog]").last();
const inDialog = (s, label) => dialog(s).getByLabel(label, { exact: true }).first();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
const card = (s, name) => s.page.locator("li").filter({ has: s.page.getByText(name, { exact: true }) }).first();
const next = (s) => s.click(s.page.getByRole("button", { name: "Next", exact: true }).last());

/** Today in Lagos as the form takes it (DD/MM/YYYY), and an hour that has already begun there. */
function lagosNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = Math.max(1, Number(parts.hour) - 1);
  const hh = (h) => String(h).padStart(2, "0");
  return { day: `${parts.day}/${parts.month}/${parts.year}`, starts: `${hh(hour)}:00`, ends: `${hh(Math.min(23, hour + 1))}:00` };
}

/** Rate every trait on My Card: `stars[i]` for trait i. */
async function rate(s, stars) {
  const traits = dialog(s).getByRole("list", { name: "Traits" }).getByRole("radiogroup");
  const n = await traits.count();
  for (let i = 0; i < n; i++) {
    const star = traits.nth(i).getByRole("radio", { name: `${stars[i % stars.length]} of 10`, exact: true });
    await star.scrollIntoViewIfNeeded();
    await star.tap();
    await s.wait(0.25);
  }
}

module.exports = {
  id: "m4-recruitment-2",
  file: "MyCity-M4-Recruitment-Part-2-Assessments-and-Interviews",
  meta: { title: "MyCity App · Recruitment, Part 2: Assessments and Interviews (Milestone 4)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 4 Handover · Part 2",
    title: "Recruitment",
    subtitle: "Assessments, interviews and the shortlist",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 4 · Recruitment · Part 2",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    // The Implementation Team's account (create-admin --build-account): a panelist and the hiring manager.
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
            "Welcome to the second walkthrough of Recruitment, delivered in Milestone 4 of the MyCity hub.",
            "It covers assessments, interviews and the shortlist.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: ASSESSMENTS,
          lines: [
            { say: "Assessments and Interviews are the third and fourth tabs of Recruitment.", do: (s) => s.hover(s.page.getByRole("tab", { name: "Interviews", exact: true })) },
            "Cynthia Osakunih, the Operations and People Lead, runs them.",
            "We follow Bisi Adewale, the invented candidate who applied in the first walkthrough.",
            "She takes a test on her phone, is interviewed by a panel, and reaches the shortlist.",
          ],
        },
      ],
    },
    {
      name: "The Assessment Library",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ASSESSMENTS,
          lines: [
            { say: "Assessments holds MyCity's tests and take-home briefs.", do: (s) => s.hover(s.page.getByRole("row").nth(1)) },
            { say: "The tiles count the active assessments, how many were sent,|those awaiting marking, and the average score.", do: (s) => s.hover(text(s, "Awaiting Marking")) },
            { say: "Assessments shows the library. Sittings shows who took what.", do: (s) => s.hover(s.page.getByRole("radio", { name: "Sittings" })) },
            { say: "Each shows its type, its minutes, its questions, how many were sent, and the average.", do: (s) => s.hover(text(s, "Sales Scenario Case Study")) },
            { say: "A timed test has minutes and a clock. A take-home brief is untimed, and due by a day.", do: (s) => s.hover(text(s, "Untimed")) },
            { say: "Cynthia opens the Work Style Profile, beside the list.", do: (s) => s.click(text(s, "Work Style Profile")) },
            { say: "It shows each question, and the points each answer scores.", do: (s) => s.scroll(320, text(s, "Instructions")), hold: 0.8 },
          ],
        },
      ],
    },
    {
      name: "Making an Assessment",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ASSESSMENTS,
          lines: [
            { say: "For the sales role, Cynthia presses New Assessment.", do: (s) => s.click("New Assessment") },
            {
              say: "She types the name, picks the type, and gives it thirty minutes and a pass mark.",
              do: async (s) => {
                await s.type(inDialog(s, "Name"), TEST, { delay: 30 });
                await s.click(dialog(s).getByRole("radio", { name: "Case Study" }));
                await s.type(inDialog(s, "Minutes"), "30", { delay: 80 });
                await s.type(inDialog(s, "Pass Mark"), "60", { delay: 80 });
              },
            },
            { say: "Left without minutes, it would be a take-home brief.", hold: 0.2 },
            { say: "She writes the instructions the candidate reads before starting.", do: (s) => s.type(inDialog(s, "Instructions"), "Three questions on selling MyCityApp to Lagos restaurants and venues. You have 30 minutes once you press Start.", { delay: 16 }) },
            { say: "She presses Make Assessment. It gets its code, and stays off until it has questions.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Make Assessment", exact: true })), hold: 0.4 },
            { say: "In Questions, Suggest With AI writes five from the type and the instructions.", do: async (s) => { await s.click("Questions"); await s.click(dialog(s).getByRole("button", { name: "Suggest With AI", exact: true })); await dialog(s).getByRole("heading", { name: "Question 5" }).waitFor({ timeout: 60000 }); } },
            { say: "Nothing is kept until she saves. Today she writes her own, so she presses Cancel.", do: (s) => s.scroll(600, dialog(s).getByRole("heading", { name: "Question 1" })), hold: 0.4 },
            {
              say: "Add Question. A choice: each option has the points it scores.",
              do: async (s) => {
                await s.click(dialog(s).getByRole("button", { name: "Cancel", exact: true }));
                await s.click("Questions");
                await s.click(dialog(s).getByRole("button", { name: "Add Question", exact: true }));
                await s.click(dialog(s).getByRole("radio", { name: "Choice" }));
                await s.type(inDialog(s, "Question"), "A venue owner says the price is too high. What do you do first?", { delay: 14 });
                await s.type(inDialog(s, "Option 1"), "Ask what result they need from us", { delay: 14 });
                await s.type(dialog(s).getByRole("textbox", { name: "Points" }).nth(0), "5", { delay: 60 });
                await s.type(inDialog(s, "Option 2"), "Offer a discount at once", { delay: 14 });
              },
            },
            {
              say: "A written answer, with its most points. She marks it herself.",
              do: async (s) => {
                await s.click(dialog(s).getByRole("button", { name: "Add Question", exact: true }));
                const q = dialog(s).getByRole("textbox", { name: "Question" }).nth(1);
                await s.type(q, "In five sentences, pitch MyCityApp to a group of Lagos restaurants.", { delay: 14 });
                await s.type(dialog(s).getByRole("textbox", { name: "Most Points" }).nth(0), "20", { delay: 60 });
              },
            },
            {
              say: "And a file or a link: a deck, a video, or a portfolio.",
              do: async (s) => {
                await s.click(dialog(s).getByRole("button", { name: "Add Question", exact: true }));
                await s.click(dialog(s).getByRole("radio", { name: "File or Link" }).nth(2));
                await s.type(dialog(s).getByRole("textbox", { name: "Question" }).nth(2), "Share a sales deck you have used, as a file or a link.", { delay: 14 });
              },
            },
            {
              say: "She presses Save Questions, then Activate. Only active assessments can be sent.",
              do: async (s) => {
                await s.click(dialog(s).getByRole("button", { name: "Save Questions", exact: true }));
                // The toast sits over the pane's last buttons until it goes.
                await s.page.getByText("Questions saved", { exact: true }).waitFor({ state: "hidden", timeout: 12000 }).catch(() => null);
                await s.click("Activate");
              },
              hold: 0.4,
            },
            { say: "Once it has been sent to anyone, its questions can't change.", hold: 0.2 },
            { say: "Export makes it a file, and Import on another hub brings it in, so nothing is typed twice.", do: (s) => s.hover("Export") },
          ],
        },
      ],
    },
    {
      name: "Sending It",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: CANDIDATES,
          setup: (s) => s.pick("Vacancy", SALES),
          lines: [
            { say: "Cynthia opens Bisi on the candidates board, and presses Send Assessment.", do: async (s) => { await s.click(card(s, BISI.name).getByText(BISI.name, { exact: true })); await s.click("Send Assessment"); } },
            { say: "She picks the new assessment. Only active ones are offered.", do: (s) => s.pick(inDialog(s, "Assessment"), `${TEST} · Case Study`) },
            { say: "Start Within Days is how long Bisi has to start it. It starts at three.", do: (s) => s.hover(inDialog(s, "Start Within Days")) },
            { say: "A take-home brief also asks for the days to finish after starting.", hold: 0.2 },
            { say: "She presses Send Assessment. Bisi gets an email with her own link, and moves to Assessment.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Send Assessment", exact: true })), hold: 0.6 },
            { say: "To send one to everyone at a stage, she opens it in the library and presses Send to Candidates.", do: async (s) => { await s.click(s.page.getByRole("tab", { name: "Assessments", exact: true })); await s.click(text(s, "Work Style Profile")); await s.click("Send to Candidates"); } },
            { say: "She picks the vacancy and the stage, Screening.", do: async (s) => { await s.pick(inDialog(s, "Vacancy"), SALES); await s.click(dialog(s).getByRole("radio", { name: "Screening" })); } },
            { say: "She presses Send Assessment. The hub says how many were sent.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Send Assessment", exact: true })), hold: 0.6 },
            "Each candidate takes an assessment once.",
          ],
        },
      ],
    },
    {
      name: "Taking It on a Phone",
      shots: [
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "In the candidate's inbox", title: "Your Assessment", subtitle: "The email the hub sends, with Bisi's own link" },
          setup: async (s) => {
            const got = await mail.message(BISI.email, "assessment-invite", { match: (d) => d.assessment_name === TEST });
            await s.page.setContent(got.html);
          },
          lines: [
            "Bisi's email names the role, the assessment, its time, and the day to start by.",
            { say: "Its link is hers alone.", hold: 0.6 },
          ],
        },
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "On the candidate's phone", title: "The Assessment", subtitle: "Bisi takes the Sales Pitch Exercise" },
          setup: async (s) => {
            const got = await mail.message(BISI.email, "assessment-invite", { match: (d) => d.assessment_name === TEST });
            await s.page.goto(got.data.assess_url);
            await s.settle();
          },
          lines: [
            { say: "The Assessment shows its type, its time, how many questions, and the instructions.", do: (s) => s.scroll(400) },
            { say: "When she's ready, she presses Start the Assessment.", do: (s) => s.click("Start the Assessment") },
            { say: "The clock counts down the time left. It's MyCity's clock, not her phone's.", hold: 0.4 },
            { say: "She picks her answer. Each answer saves as she gives it, and the page shows Saved.", do: (s) => s.click(s.page.getByRole("radio", { name: "Ask what result they need from us" })), hold: 0.4 },
            {
              say: "Next. She writes her pitch.",
              do: async (s) => {
                await next(s);
                await s.type("Your Answer", "MyCityApp puts your restaurant in front of diners nearby tonight. We bring weekday covers you can count.", { delay: 14 });
              },
            },
            {
              say: "For the last, she could upload a file up to 25 megabytes. She presses Paste a Link instead.",
              do: async (s) => {
                await next(s);
                await s.click(s.page.getByText("Paste a Link", { exact: true }).first());
              },
            },
            { say: "A link anyone can open, starting with https.", do: (s) => s.type(s.page.getByRole("textbox").last(), "https://drive.example.test/bisi-sales-deck", { delay: 16 }) },
            { say: "On the last question, she presses Submit Assessment.", do: (s) => s.click("Submit Assessment") },
            { say: "A box says how many are answered. She presses Submit Assessment again.", do: (s) => s.click(s.page.getByRole("button", { name: "Submit Assessment", exact: true }).last()), hold: 0.6 },
            { say: "Her answers reach the hiring team. She never sees a score.", hold: 0.6 },
          ],
        },
      ],
    },
    {
      name: "Marking",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ASSESSMENTS,
          lines: [
            { say: "Back in the hub, Cynthia presses Sittings, then To Mark.", do: async (s) => { await s.click(s.page.getByRole("radio", { name: "Sittings" })); await s.click(s.page.getByRole("radio", { name: "To Mark" })); } },
            { say: "She opens Bisi's sitting. Her choice was marked by itself.", do: (s) => s.click(s.page.getByRole("row").filter({ hasText: BISI.name }).filter({ hasText: TEST }).first()) },
            { say: "She reads the pitch and gives its mark, with a comment if she likes.", do: (s) => s.type(s.page.getByLabel("Mark", { exact: true }).nth(0), "16", { delay: 90 }) },
            { say: "She opens the link Bisi gave, and marks it too.", do: async (s) => { await s.hover(text(s, "https://drive.example.test/bisi-sales-deck")); await s.type(s.page.getByLabel("Mark", { exact: true }).nth(1), "8", { delay: 90 }); } },
            { say: "She presses Mark Answers. The sitting is scored, and its percentage goes on Bisi's scorecard.", do: (s) => s.click("Mark Answers"), hold: 0.8 },
            { say: "A question left unanswered scores nothing, but a mark left empty is refused.", hold: 0.2 },
          ],
        },
      ],
    },
    {
      name: "Scheduling an Interview",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: INTERVIEWS,
          lines: [
            { say: "Interviews lists what's coming first, then those held. My Panels shows the ones you sit on.", do: (s) => s.hover(s.page.getByRole("radio", { name: "My Panels" })) },
            { say: "Cynthia presses Schedule Interview, and finds Bisi.", do: async (s) => { await s.click("Schedule Interview"); await s.type(dialog(s).getByRole("searchbox", { name: "Candidate" }), "Bisi"); await s.click(dialog(s).getByRole("option", { name: /^Bisi Adewale/ })); } },
            {
              say: "How it's held: in person, by video, or by phone. This one is by video, with its link.",
              do: (s) => s.type(inDialog(s, "Meeting Link"), "https://meet.example.test/mycity-bisi", { delay: 14 }),
            },
            {
              say: "She picks the day, when it starts, and when it ends.",
              do: async (s) => {
                const t = lagosNow();
                await s.type(inDialog(s, "Day"), t.day, { delay: 50 });
                await s.type(inDialog(s, "Starts"), t.starts, { delay: 60 });
                await s.type(inDialog(s, "Ends"), t.ends, { delay: 60 });
              },
            },
            {
              say: "The panel: the JBS Praxis Team and herself. Only people who hold Recruitment are offered.",
              do: async (s) => {
                const panel = dialog(s).getByRole("searchbox", { name: "Panel" });
                await s.type(panel, "JBS");
                await s.click(dialog(s).getByRole("option", { name: /^JBS Praxis Team/ }));
                await s.type(panel, "Cynthia");
                await s.click(dialog(s).getByRole("option", { name: /^Cynthia Osakunih/ }));
              },
            },
            { say: "She presses Schedule Interview. Bisi gets an email with a calendar file.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Schedule Interview", exact: true })), hold: 0.4 },
            "Each panelist gets a calendar invite, also on My Workspace's calendar.",
            { say: "She opens the interview. Under Candidate Details, she presses Edit.", do: async (s) => { await s.click(text(s, BISI.name)); await s.click(dialog(s).getByRole("button", { name: "Edit", exact: true }).first()); } },
            {
              say: "Bisi's current employer, her academics, and her experience in months. The whole panel reads them.",
              do: async (s) => {
                await s.type(inDialog(s, "Current Employer"), "Lagos Live Media", { delay: 22 });
                await s.click(dialog(s).getByRole("radio", { name: "Very Good" }));
                await s.type(inDialog(s, "Total Months"), "132", { delay: 60 });
                await s.type(inDialog(s, "Relevant Months"), "132", { delay: 60 });
                await s.click(dialog(s).getByRole("button", { name: "Save Details", exact: true }));
              },
              hold: 0.4,
            },
          ],
        },
      ],
    },
    {
      name: "The Blind Panel",
      shots: [
        {
          kind: "phone",
          as: "team",
          start: INTERVIEWS,
          label: { eyebrow: "On a panelist's phone", title: "My Card", subtitle: "The JBS Praxis Team scores Bisi's interview" },
          lines: [
            { say: "Each panelist scores alone. The JBS Praxis Team opens the interview, and presses My Card.", do: async (s) => { await s.click(text(s, BISI.name)); await s.click("My Card"); } },
            { say: "For each trait, a star from one to ten. Each star saves as it's pressed.", do: (s) => rate(s, [8, 9, 8, 9, 8, 9, 9, 8, 9, 9]) },
            { say: "Your score shows the average so far.", do: (s) => s.hover(text(s, "Decision")) },
            { say: "The decision: Select.", do: (s) => s.click(dialog(s).getByRole("radio", { name: "Select" })) },
            { say: "Comments are optional. Tidy With AI tidies the wording, to keep or not.", do: async (s) => { await s.type("Comments", "strong on pricing and partners, has led a team of 8, good energy", { delay: 14 }); await s.click("Tidy With AI"); await s.wait(4); }, hold: 0.6 },
            { say: "Private Notes are for the panelist alone. Nobody else ever sees them.", do: (s) => s.type("Private Notes", "Ask about notice period.", { delay: 20 }) },
            { say: "Submit Card, then Submit Card again. Once submitted, it can't change.", do: async (s) => { await s.click("Submit Card"); await s.click(dialog(s).getByRole("button", { name: "Submit Card", exact: true })); }, hold: 0.6 },
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: INTERVIEWS,
          lines: [
            { say: "On Cynthia's screen, Blind Panel shows each person as Submitted or Waiting.", do: (s) => s.click(text(s, BISI.name)) },
            { say: "A submitted score reads Hidden until the round closes.", do: (s) => s.hover(dialog(s).getByText("Hidden", { exact: true }).first()) },
            "While the round is open, nobody reads another person's card, not the hiring manager, not the CEO.",
          ],
        },
      ],
    },
    {
      name: "Closing the Round",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: INTERVIEWS,
          setup: (s) => s.click(text(s, BISI.name)),
          lines: [
            { say: "The round closes by itself when the last panelist submits.|Cynthia closes it now, with Close Round.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Close Round", exact: true })) },
            { say: "Only submitted cards count. A closed round never opens again.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Close Round", exact: true })), hold: 0.6 },
            { say: "Now everyone who may see the interview reads the results:|each rating, the average for each trait, and the total out of 100.", do: (s) => s.scroll(900, dialog(s).getByRole("heading", { name: "Blind Panel" }).first()), hold: 0.6 },
            { say: "The hiring manager writes one report for the panel. Cynthia presses Write Report.", do: async (s) => { await s.scroll(-900, dialog(s).getByRole("heading", { name: "Blind Panel" }).first()); await s.click(dialog(s).getByRole("button", { name: "Write Report", exact: true })); } },
            {
              say: "What the panel found, and the decision: Select.",
              do: async (s) => {
                await s.type(inDialog(s, "Report"), "A proven sales leader with eleven years in Lagos media and a team of eight. Clear on pricing and renewals.", { delay: 12 });
                await s.click(dialog(s).getByRole("radio", { name: "Select" }));
              },
            },
            { say: "She presses Save Report. The Interview Assessment Form is made from the whole card.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Save Report", exact: true })), hold: 0.6 },
            { say: "Download Form saves it as a PDF: the details, every rating, each decision, the total and the report.", do: (s) => s.click(dialog(s).getByRole("button", { name: "Download Form", exact: true })), hold: 0.6 },
          ],
        },
      ],
    },
    {
      name: "Shortlist and Offer",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: CANDIDATES,
          setup: (s) => s.pick("Vacancy", SALES),
          lines: [
            { say: "The panel selected Bisi. On the board, Cynthia moves her to Shortlist.", do: async (s) => { await s.click(card(s, BISI.name).getByText(BISI.name, { exact: true })); await s.click("Move to Shortlist"); } },
            { say: "At Shortlist, Make Offer starts her offer on the Offers tab.", do: (s) => s.hover("Make Offer") },
            "Offers and Onboarding are covered in the Milestone 5 walkthrough.",
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
            "That's Recruitment, from a new vacancy to the shortlist.",
            "Every step is also written up in the User Guide, in the Knowledge Hub.",
            "Thank you for watching.",
          ],
        },
      ],
    },
  ],
};

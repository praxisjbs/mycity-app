"use strict";
/**
 * Milestone 10 handover, part 1 of 2: the Knowledge Hub (Policies, SOPs, Training) and ESS · My
 * Training. docs/runbooks/training-videos.md says how a scene is written and filmed, and §8 the plan.
 *
 * MyCity's own people do the work, on a development database with the staging seed (TB,
 * 12/11/2026: an internal guide, as real as it can be). Cynthia Osakunih writes a policy and builds
 * a course; Chinyere Elechi, Head of Branding & Marketing, writes her department's SOP with AI;
 * Aaron Agama, in her department, takes the course on his phone with My Notes open, and receives
 * the certificate that go.mycityapp.io verifies. The chapters run in order, each on the one before.
 */
const fs = require("node:fs");
const path = require("node:path");

const POLICIES = "/knowledge?tab=policies";
const SOPS = "/knowledge?tab=sops";
const TRAINING = "/knowledge?tab=training";
const MY_TRAINING = "/ess?tab=my-training";
const COURSE = "Spotting Phishing Messages";
const POLICY = "Remote Work";
const SOP = "Influencer Collaboration";
const VIDEO = "https://www.youtube.com/watch?v=JlQovysQBn0";
/** Where filming keeps what it makes: the course's PDF, the certificate's picture and number. */
const OUT = () => process.env.VIDEO_OUT || "/tmp/video/m10-knowledge-hub";
const CHECKLIST = () => path.join(OUT(), "phishing-checklist.pdf");

/** IT's one-page checklist, the course's file: printed by the filming browser before the shot. */
async function printChecklist(s) {
  const page = await s.page.context().newPage();
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Inter, Arial, sans-serif; margin: 48px; color: #1b1b1b; }
    h1 { font-size: 28px; margin: 0 0 4px; } p.sub { color: #555; margin: 0 0 28px; }
    li { font-size: 17px; margin: 0 0 14px; line-height: 1.45; } b { color: #00201d; }
  </style></head><body>
    <h1>Phishing Checklist</h1><p class="sub">MyCity App Ltd · IT · Before you click</p>
    <ol>
      <li><b>Pause on urgency.</b> "Act now" or "your account will close" is a warning sign.</li>
      <li><b>Check the sender.</b> The address must match the company it claims to be.</li>
      <li><b>Hover first.</b> A link's real address shows before you click it.</li>
      <li><b>Distrust surprises.</b> An attachment you did not expect stays closed.</li>
      <li><b>Never share passwords.</b> MyCity never asks for one by mail or message.</li>
      <li><b>Report it.</b> Tell IT on Staff Community, then delete the message.</li>
      <li><b>Clicked already?</b> Change your password at once and tell IT.</li>
    </ol></body></html>`);
  fs.mkdirSync(OUT(), { recursive: true });
  await page.pdf({ path: CHECKLIST(), format: "A4", printBackground: true });
  await page.close();
}

const POLICY_TEXT =
  "Remote work at MyCity. Staff may work from home up to two days a week when their line manager agrees. " +
  "Clock in from your approved home location. Keep company devices locked and on a private network. " +
  "Be reachable on Staff Community during working hours. Client data never leaves company devices.";

const SOP_SOURCE =
  "How we run influencer collaborations. First the campaign lead writes a one page brief with the goal, budget and dates. " +
  "Then the social media manager shortlists three influencers and checks their audience is at least 60 percent Nigerian. " +
  "The head of branding approves the shortlist. Operations sends the contract and the brief. " +
  "The influencer shares drafts for approval before anything is posted. After the campaign the social media manager reports reach and clicks within 7 days.";

const LESSON_SOURCE =
  "Phishing is a message that pretends to be someone you trust so you click a link, open a file or share a password. " +
  "Warning signs: urgency like act now or your account will close, a sender address that does not match the company, " +
  "links whose real address is different when you hover, unexpected attachments, requests for passwords or payment. " +
  "At MyCity we never ask for your password by mail or message. If something looks wrong, do not click. " +
  "Report it to IT on Staff Community and delete it. If you clicked, change your password at once and tell IT.";

/** The dialog, sheet or side panel on top, a confirmation (an alert dialog) included. */
const dialog = (s) => s.page.locator("[role=dialog], [role=alertdialog]").last();
const inDialog = (s, label) => dialog(s).getByLabel(label, { exact: true }).first();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
const button = (s, name, within) => (within || s.page).getByRole("button", { name, exact: true }).first();
/** A chip (a pressed-state button): the lists' filters. */
const chip = (s, name) => s.page.getByRole("button", { name, exact: true }).first();

/** Today in Lagos as a date field takes it (DD/MM/YYYY). */
function today() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}`;
}

/**
 * A signature drawn on a pad at a person's pace: a looped capital, then a run of joined loops that
 * shrink to a tail, the way a hurried hand writes a name.
 */
async function sign(s, pad) {
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  const W = box.width * 0.7;
  const H = box.height * 0.32;
  const x0 = box.x + box.width * 0.14;
  const y0 = box.y + box.height * 0.56;
  // A prolate cycloid loops where the pen doubles back; the loops shrink and flatten to the end.
  const at = (t) => {
    const k = t * 7 * Math.PI;
    const r = 1.35 * (1 - 0.55 * t);
    return { x: x0 + W * (t + (r * Math.sin(k)) / 26), y: y0 - H * (r * Math.cos(k)) * (0.55 + 0.45 * (1 - t)) * 0.5 };
  };
  const stroke = async (from, to, n) => {
    const a = at(from);
    await s.page.mouse.move(a.x, a.y, { steps: 6 });
    await s.page.mouse.down();
    for (let i = 1; i <= n; i++) {
      const p = at(from + ((to - from) * i) / n);
      await s.page.mouse.move(p.x, p.y, { steps: 2 });
    }
    await s.page.mouse.up();
  };
  if (!s.phone) await s.hover(pad);
  await stroke(0, 0.62, 70);
  await stroke(0.66, 1, 36);
  // The underline.
  await s.page.mouse.move(x0 + W * 0.05, y0 + H * 0.75, { steps: 4 });
  await s.page.mouse.down();
  await s.page.mouse.move(x0 + W * 0.9, y0 + H * 0.62, { steps: 18 });
  await s.page.mouse.up();
  await s.wait(0.3);
}

module.exports = {
  id: "m10-knowledge-hub",
  file: "MyCity-M10-Knowledge-Hub-Part-1-Policies-SOPs-and-Training",
  meta: { title: "MyCity App · Knowledge Hub, Part 1: Policies, SOPs and Training (Milestone 10)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 10 Handover · Part 1",
    title: "Knowledge Hub",
    subtitle: "Policies, SOPs, training and certificates",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 10 · Knowledge Hub · Part 1",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    chinyere: (staff) => staff.everyone.find((p) => p.job_title === "Head, PR, Marketing & Brand Strategy").work_email,
    aaron: (staff) => staff.everyone.find((p) => p.job_title === "Social Media Manager").work_email,
  },
  chapters: [
    {
      name: "Welcome",
      shots: [
        {
          kind: "card",
          card: "opening",
          lines: [
            "Welcome to the walkthrough of the Knowledge Hub, delivered in Milestone 10 of the MyCity hub.",
            "It is the first of two. The second covers Praxis AI and AI Control.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: POLICIES,
          lines: [
            { say: "The Knowledge Hub is under System in the menu. It keeps what MyCity knows about how it works.", do: (s) => s.hover(s.page.getByRole("link", { name: "Knowledge Hub" }).first()) },
            { say: "Policies holds every company policy, with its versions and who has acknowledged it.", do: (s) => s.hover(s.page.getByRole("tab", { name: "Policies", exact: true })) },
            { say: "SOPs are each department's own procedures. Everyone reads them.", do: (s) => s.hover(s.page.getByRole("tab", { name: "SOPs", exact: true })) },
            { say: "Training holds MyCity's courses. Staff take them on My Training, in Self-Service.", do: (s) => s.hover(s.page.getByRole("tab", { name: "Training", exact: true })) },
            { say: "The User Guide is here too: every screen, step by step.", do: (s) => s.hover(s.page.getByRole("tab", { name: "User Guide", exact: true })) },
            "We follow MyCity's own people: Cynthia Osakunih, the Operations and People Lead,",
            "Chinyere Elechi, Head of Branding and Marketing, and Aaron Agama, her Social Media Manager.",
          ],
        },
      ],
    },
    {
      name: "Policies",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: POLICIES,
          lines: [
            { say: "Policies lists each one: who it applies to, the version in force, and how many acknowledged it.", do: (s) => s.hover(text(s, "Code of Conduct")) },
            { say: "The chips narrow it: In Force, Awaiting Approval, Starts Soon, Draft, or Archived.", do: (s) => s.hover(chip(s, "Starts Soon")) },
            "Cynthia holds Manage Policies, as do the Implementation Team and the CEO.",
            { say: "She starts a new one. New Policy, its title, then Start Policy.", do: async (s) => { await s.click("New Policy"); await s.type(inDialog(s, "Title"), POLICY, { delay: 45 }); await s.click(button(s, "Start Policy", dialog(s))); } },
            { say: "Under Policy Settings it applies to Everyone, and needs each person's acknowledgement.", do: (s) => s.hover(text(s, "Needs Acknowledgement")) },
            { say: "She pastes the policy's text from her document.", do: (s) => s.type(s.page.getByRole("textbox", { name: "Policy Text", exact: true }), POLICY_TEXT, { delay: 4 }) },
            { say: "Tidy With AI suggests headings and lists, keeping her words.", do: async (s) => { await s.click("Tidy With AI"); await text(s, "Tidied").waitFor({ timeout: 90000 }); }, hold: 0.6 },
            { say: "She reads Tidied beside Yours, and presses Use Tidied Text.", do: (s) => s.click("Use Tidied Text"), hold: 0.4 },
            { say: "Save Draft keeps it. Nobody is told yet.", do: (s) => s.click("Save Draft"), hold: 0.6 },
            { say: "She presses Publish Policy, gives the first day, and adds a note.", do: async (s) => { await s.click("Publish Policy"); await s.type(inDialog(s, "First Day"), today(), { delay: 60 }); await s.type(inDialog(s, "Note"), "First version of our remote work rules.", { delay: 22 }); } },
            { say: "She signs in Your Signature, with the mouse or a finger.", do: (s) => sign(s, dialog(s).getByRole("img", { name: "Your Signature" })) },
            { say: "Publish Policy. Everyone is told, and asked to acknowledge it after they clock in.", do: (s) => s.click(button(s, "Publish Policy", dialog(s))), hold: 0.8 },
            { say: "It applies to Cynthia too, so she's asked at once. She presses Acknowledge.", do: (s) => s.click(button(s, "Acknowledge", s.page.getByRole("dialog", { name: "Policy Update" }))), hold: 0.6 },
            "A policy that needs approval reads Submit for Approval instead. The CEO approves it.",
          ],
        },
        {
          kind: "phone",
          as: "aaron",
          start: "/ess?tab=policy-updates",
          label: { eyebrow: "On a staff member's phone", title: "Policy Updates", subtitle: "Aaron Agama acknowledges the new policy" },
          lines: [
            { say: "On Aaron's phone, Policy Updates in Self-Service lists what he must read.", do: (s) => s.wait(0.6) },
            { say: "He opens Remote Work, reads it, and presses Acknowledge.", do: async (s) => { await s.click(text(s, POLICY)); await s.scroll(500); await s.click("Acknowledge"); } },
            { say: "It's recorded with the time. Anyone who hasn't acknowledged in three days gets one reminder.", hold: 0.8 },
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: POLICIES,
          lines: [
            { say: "Back on Policies, Cynthia opens Remote Work. Versions lists each version.", do: (s) => s.click(text(s, POLICY)) },
            { say: "Pressing a version shows its text, its signatures, and Acknowledgements:|who has, who is pending, and who is overdue.", do: (s) => s.click(s.page.getByRole("row").filter({ hasText: "Version 1" }).first()), hold: 0.8 },
            { say: "Download PDF saves it on MyCity's letterhead.", do: (s) => s.hover(button(s, "Download PDF", dialog(s))) },
          ],
        },
      ],
    },
    {
      name: "Reading SOPs",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: SOPS,
          lines: [
            { say: "SOPs are each department's standard operating procedures. Every member of staff reads them.", do: (s) => s.wait(0.4) },
            { say: "The chips show one department's. Aaron presses Branding and Marketing.", do: (s) => s.click(chip(s, "Branding & Marketing")) },
            { say: "He opens Campaign Launch. It reads beside the list.", do: (s) => s.click(text(s, "Campaign Launch")) },
            { say: "Its Purpose, its Scope, the Roles Involved, then numbered Steps, each with who does it.", do: (s) => s.scroll(320, text(s, "Purpose")), hold: 0.4 },
            { say: "Open Screen takes him to the screen a step happens on.", do: (s) => s.hover(button(s, "Open Screen")) },
            { say: "Versions lists every version, newest first, with what changed.", do: (s) => s.scroll(500), hold: 0.4 },
            "Aaron reads them, but he can't write them. He isn't his department's head.",
          ],
        },
      ],
    },
    {
      name: "Writing an SOP With AI",
      shots: [
        {
          kind: "desktop",
          as: "chinyere",
          start: SOPS,
          lines: [
            "A department's head writes its SOPs. People with Manage SOPs may write any department's.",
            { say: "Chinyere presses New SOP. She is offered her own department only.", do: (s) => s.click("New SOP") },
            { say: "She types its title, Influencer Collaboration, and presses Start SOP.", do: async (s) => { await s.type(inDialog(s, "Title"), SOP, { delay: 45 }); await s.click(button(s, "Start SOP", dialog(s))); } },
            { say: "Her department already does this, in a document. In Edit SOP, she presses Draft With AI.", do: async (s) => { await s.click("Edit SOP"); await s.click(button(s, "Draft With AI", dialog(s))); } },
            { say: "From Pasted Text, she pastes the procedure.", do: (s) => s.type(inDialog(s, "Procedure"), SOP_SOURCE, { delay: 3 }) },
            { say: "Draft With AI lays it out as Purpose, Roles and Steps. It keeps her words, and never adds a step.", do: async (s) => { await s.click(button(s, "Draft With AI", dialog(s)).last()); await dialog(s).getByText("Drafted", { exact: true }).first().waitFor({ timeout: 90000 }); }, hold: 0.6 },
            { say: "She reads Drafted beside Yours, and presses Use This Draft.", do: (s) => s.click(button(s, "Use This Draft", dialog(s))), hold: 0.4 },
            { say: "She picks the screen where the contract step happens: Partnerships.", do: (s) => s.pick(dialog(s).getByLabel("Screen", { exact: true }).nth(3), "Partnerships · Partners") },
            { say: "Save Draft. Nobody is told until she publishes.", do: (s) => s.click(button(s, "Save Draft", dialog(s))), hold: 0.6 },
            { say: "She presses Publish SOP. The first version needs no note.", do: async (s) => { await s.click("Publish SOP"); await s.click(button(s, "Publish SOP", dialog(s))); }, hold: 0.8 },
            "Version 1 is in force. Everyone in Branding and Marketing is told: New SOP.",
            "A later version asks for a note saying what changed, and every version is kept.",
          ],
        },
      ],
    },
    {
      name: "Procedures on a Screen",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: "/partnerships?tab=partners",
          lines: [
            { say: "A step that names a screen lists its SOP in that screen's help. Cynthia is on Partnerships.", do: (s) => s.wait(0.4) },
            { say: "She opens the User Guide from her name at the foot of the menu.", do: async (s) => { await s.click(s.page.getByRole("button", { name: /Cynthia Osakunih/ }).first()); await s.click(s.page.getByRole("menuitem", { name: "User Guide" })); } },
            { say: "Under the screen's section, Procedures lists Influencer Collaboration, with its department.", do: (s) => s.hover(text(s, "Procedures")), hold: 0.6 },
            "The procedure is where the work happens.",
          ],
        },
      ],
    },
    {
      name: "Building a Course",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: TRAINING,
          setup: printChecklist,
          lines: [
            { say: "Training is for people who hold Manage Training: Operations and People, Implementation and the CEO.", do: (s) => s.hover(text(s, "NDPA Data Protection Essentials")) },
            "Each course shows its state, its items, whether it's in the Library, and how many are assigned, completed and overdue.",
            { say: "Cynthia presses New Course, types its title and summary, and presses Create Course.", do: async (s) => { await s.click("New Course"); await s.type(inDialog(s, "Title"), COURSE, { delay: 40 }); await s.type(inDialog(s, "Summary"), "How to spot a phishing message, and what to do.", { delay: 18 }); await s.click(button(s, "Create Course", dialog(s))); } },
            { say: "A course is items in order: a file, a video link, a link to an outside course, or a lesson.", do: (s) => s.click("Add Item") },
            { say: "First a lesson. She names it, and presses Draft Lesson.", do: async (s) => { await s.click(dialog(s).getByRole("radio", { name: "Lesson" })); await s.type(inDialog(s, "Title"), "Spot the Signs", { delay: 40 }); await s.type(inDialog(s, "Minutes"), "5", { delay: 60 }); await s.click(button(s, "Draft Lesson", dialog(s))); } },
            { say: "She pastes IT's notes into Source Text, and presses Draft Lesson.", do: async (s) => { await s.type(inDialog(s, "Source Text"), LESSON_SOURCE, { delay: 2 }); await s.click(button(s, "Draft Lesson", dialog(s)).last()); await dialog(s).getByText("Drafted", { exact: true }).first().waitFor({ timeout: 90000 }); }, hold: 0.6 },
            { say: "The lesson comes back with headings and key points, keeping the facts. Use Lesson.", do: (s) => s.click(button(s, "Use Lesson", dialog(s))) },
            { say: "She reads it through, and presses Add Item.", do: (s) => s.click(button(s, "Add Item", dialog(s)).last()), hold: 0.4 },
            {
              say: "Next, a video. A YouTube link plays inside the course.",
              do: async (s) => {
                await s.click("Add Item");
                await s.click(dialog(s).getByRole("radio", { name: "Video Link" }));
                await s.type(inDialog(s, "Title"), "Recognize and Report Phishing", { delay: 30 });
                await s.type(inDialog(s, "Link"), VIDEO, { delay: 16 });
                await s.type(inDialog(s, "Minutes"), "1", { delay: 60 });
                await s.click(button(s, "Add Item", dialog(s)).last());
              },
              hold: 0.4,
            },
            {
              say: "Then a file: IT's one-page checklist, as a PDF.",
              do: async (s) => {
                await s.click("Add Item");
                await s.click(dialog(s).getByRole("radio", { name: "Upload File" }));
                await s.type(inDialog(s, "Title"), "Phishing Checklist", { delay: 30 });
                await dialog(s).locator("input[type=file]").first().setInputFiles(CHECKLIST());
                await dialog(s).getByText("phishing-checklist.pdf").first().waitFor({ timeout: 30000 });
                await s.type(inDialog(s, "Minutes"), "2", { delay: 60 });
                await s.click(button(s, "Add Item", dialog(s)).last());
              },
              hold: 0.4,
            },
            { say: "A course link opens a free outside course, like a certification, in a new tab.", hold: 0.2 },
            { say: "The items show in the order people take them. She drags one by its handle to move it.", do: (s) => s.hover(s.page.getByRole("button", { name: /Drag/ }).first()) },
          ],
        },
      ],
    },
    {
      name: "Publishing and Assigning",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: TRAINING,
          setup: (s) => s.click(text(s, COURSE)),
          lines: [
            { say: "In Settings, Library lets anyone take it, assigned or not. She switches it on.", do: async (s) => { await s.click(s.page.getByRole("radio", { name: "Settings" })); await s.click(s.page.getByRole("switch", { name: "Library" })); } },
            { say: "Proof Required asks for proof at the end, such as an outside course's certificate. Not here.", do: (s) => s.hover(s.page.getByRole("switch", { name: "Proof Required" })) },
            { say: "Issue Certificate is on. Whoever finishes gets a MyCity certificate.", do: (s) => s.hover(s.page.getByRole("switch", { name: "Issue Certificate" })) },
            { say: "She presses Publish Course, and signs. Her signature is printed on every certificate of this course.", do: async (s) => { await s.click("Publish Course"); await sign(s, dialog(s).getByRole("img", { name: "Your Signature" })); } },
            { say: "Publish Course.", do: (s) => s.click(button(s, "Publish Course", dialog(s))), hold: 0.6 },
            { say: "Now Assign Training. Who Takes It: Everyone, or Pick Who.", do: (s) => s.click("Assign Training") },
            { say: "She picks Branding and Marketing. Departments, roles and named people can be mixed.", do: async (s) => { await s.click(dialog(s).getByRole("radio", { name: "Pick Who" })); await s.pick(inDialog(s, "Departments"), "Branding & Marketing"); } },
            { say: "Due Within seven days. Keep Assigning New Joiners gives it to whoever joins later.", do: (s) => s.type(inDialog(s, "Due Within (Days)"), "7", { delay: 80 }) },
            { say: "Assign Training. Each person gets a task in My Workspace, due on the day, and a notice.", do: (s) => s.click(button(s, "Assign Training", dialog(s))), hold: 0.8 },
            "Those overdue are reminded before, on and after the due date.",
          ],
        },
      ],
    },
    {
      name: "Taking It on a Phone",
      shots: [
        {
          kind: "phone",
          as: "aaron",
          start: MY_TRAINING,
          label: { eyebrow: "On a staff member's phone", title: "My Training", subtitle: "Aaron Agama takes the new course" },
          lines: [
            { say: "Aaron's notice opens My Training. To Do lists his courses, the soonest due first.", do: (s) => s.wait(0.6) },
            { say: "He opens Spotting Phishing Messages. Its due date, its length, and his progress.", do: (s) => s.click(text(s, COURSE)) },
            { say: "He presses Take Notes. My Notes opens over the course, and doesn't block it.", do: (s) => s.click("Take Notes") },
            { say: "His notes are his alone. They save as he types, and follow him to any device.", do: (s) => s.type(s.page.getByRole("textbox", { name: /My Notes/ }), "Hover before I click. We never ask for passwords.", { delay: 26 }), hold: 0.4 },
            { say: "Move to Top puts it out of the way. Minimise keeps only its bar.", do: async (s) => { await s.click("Move to Top"); await s.click("Minimise Notes"); } },
            { say: "He opens the lesson, reads it, and presses Mark Done at its foot.", do: async (s) => { await s.click(s.page.getByRole("button", { name: /Spot the Signs/ })); await s.scroll(900); await s.click("Mark Done"); } },
            { say: "Next Item: the video. Play Video plays it from YouTube, inside the course.", do: async (s) => { await s.click("Next Item"); await s.page.getByRole("button", { name: /Play Video/ }).first().scrollIntoViewIfNeeded(); }, hold: 0.6 },
            { say: "He adds a line to his notes as he watches.", do: async (s) => { await s.click("Open Notes"); await s.type(s.page.getByRole("textbox", { name: /My Notes/ }), "\nReport it to IT on Staff Community.", { delay: 24, clear: false }); await s.click("Minimise Notes"); } },
            { say: "Mark Done, then Next Item: the checklist, page by page.", do: async (s) => { await s.click("Mark Done"); await s.click("Next Item"); await s.wait(1.5); await s.scroll(700); } },
            { say: "The last Mark Done completes the course.", do: async (s) => { await s.scroll(900); await s.click("Mark Done"); }, hold: 0.8 },
          ],
        },
      ],
    },
    {
      name: "The Certificate",
      shots: [
        {
          kind: "phone",
          as: "aaron",
          start: MY_TRAINING,
          label: { eyebrow: "On a staff member's phone", title: "My Training", subtitle: "The certificate of completion" },
          setup: (s) => s.click(chip(s, "Completed")),
          lines: [
            { say: "Completed lists it, with the date and its certificate number.", do: (s) => s.wait(0.6) },
            { say: "Download Certificate saves the PDF on his phone.", do: (s) => s.click(s.page.getByRole("button", { name: "Download Certificate" }).first()), hold: 0.6 },
          ],
        },
        {
          kind: "phone",
          site: "go",
          start: "/verify",
          label: { eyebrow: "The certificate", title: "Certificate of Completion", subtitle: "Signed by its publisher, with a QR" },
          setup: async (s) => {
            const art = path.join(OUT(), "certificate.png");
            await s.page.setContent(`<body style="margin:0;background:#00201d;display:flex;align-items:center;justify-content:center;height:100vh"><img src="data:image/png;base64,${fs.readFileSync(art).toString("base64")}" style="width:100%"></body>`);
          },
          lines: [
            { say: "It names Aaron, the course, its items and length, the day he finished,|and Cynthia's signature as its publisher.", hold: 0.6 },
            "Its number and QR code open the verification page on go dot MyCity App dot I O.",
          ],
        },
        {
          kind: "phone",
          site: "go",
          start: "/verify",
          label: { eyebrow: "Anyone, anywhere", title: "Verify a Document", subtitle: "The certificate's QR, on go.mycityapp.io" },
          setup: async (s) => {
            const number = fs.readFileSync(path.join(OUT(), "certificate.txt"), "utf8").trim();
            await s.go(`/verify/${number}`);
          },
          lines: [
            { say: "Anyone with the number or the QR sees Awarded To, the course, when it was completed, and who published it.", do: (s) => s.scroll(300), hold: 0.6 },
            "Two checks say the certificate is genuine and unchanged since it was issued.",
          ],
        },
      ],
    },
    {
      name: "Following Progress",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: TRAINING,
          setup: (s) => s.click(text(s, COURSE)),
          lines: [
            { say: "Back on Training, Cynthia opens People.", do: (s) => s.click(s.page.getByRole("radio", { name: "People" })) },
            { say: "Each person's status, due date, progress, and certificate. The chips narrow it.", do: (s) => s.hover(s.page.getByRole("radio", { name: "Overdue" })) },
            { say: "Remind Overdue reminds everyone past their due date, once a day at most.", do: (s) => s.hover(button(s, "Remind Overdue")) },
            { say: "Download Certificate saves anyone's certificate.", do: (s) => s.hover(s.page.getByRole("button", { name: "Download Certificate" }).first()) },
            { say: "Assignments lists who each assignment reaches. Withdraw takes one back.", do: (s) => s.click(s.page.getByRole("radio", { name: "Assignments" })), hold: 0.4 },
            "Search finds any SOP or course from anywhere, by its title or number.",
            "And nobody but Aaron ever reads his notes: not Cynthia, not the CEO, not Praxis AI.",
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
            "That's the Knowledge Hub, from a new policy to a verified certificate.",
            "Every step is also written up in the User Guide, in the Knowledge Hub.",
            "Thank you for watching.",
          ],
        },
      ],
    },
  ],
};

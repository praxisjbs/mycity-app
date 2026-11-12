/* global document */
"use strict";
/**
 * Milestone 10 handover, part 2 of 2: Praxis AI (Ask, the answer and its pane, an action card,
 * History) and AI Control (jobs, chains, models, spend), and adding a provider's key on Settings ·
 * Integrations. docs/runbooks/training-videos.md says how a scene is written and filmed, and §8 the
 * plan.
 *
 * Filmed with Gemini's key on a development database with the staging seed (runbook §1.4). Ifeoma
 * Mbonu, the CEO, asks MyCity's six target questions (MILESTONES §15); Bassey Ekpe, who holds no
 * expense rights, asks one and is told it is not his; the JBS Praxis Team, as IT, sets AI Control
 * and shows where the Anthropic key goes.
 */

const ASK = "/praxis-ai?tab=ask";
const HISTORY = "/praxis-ai?tab=history";
const ACTIONS = "/ai-control?tab=actions";
const INTEGRATIONS = "/settings?tab=integrations";

const QUESTIONS = {
  tasks: "Who has overdue tasks?",
  expenses: "Which expenses are waiting for approval?",
  confirmation: "Who is due for confirmation?",
  partnerships: "Which partnerships have gone inactive?",
  candidates: "Which candidates are waiting for feedback?",
  budget: "What is our budget against actual spend this month?",
};

const dialog = (s) => s.page.locator("[role=dialog], [role=alertdialog]").last();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
const button = (s, name, within) => (within || s.page).getByRole("button", { name, exact: true }).first();

/** Ask a question in the box at the foot of Ask, and wait for the answer to land. */
async function ask(s, question) {
  const box = s.page.getByRole("textbox", { name: "Ask a Question" });
  const before = await s.page.getByRole("article").count().catch(() => 0);
  await s.type(box, question, { delay: 28 });
  await s.click("Send");
  // The answer is in when Send answers again and Reading Your Records has gone.
  await s.page.getByText("Reading Your Records").first().waitFor({ state: "hidden", timeout: 120000 }).catch(() => null);
  await s.page.waitForFunction((n) => document.querySelectorAll("article").length > n, before, { timeout: 120000 }).catch(() => null);
  await s.settle();
}

module.exports = {
  id: "m10-praxis-ai",
  file: "MyCity-M10-Praxis-AI-Part-2-Praxis-AI-and-AI-Control",
  meta: { title: "MyCity App · Praxis AI and AI Control, Part 2 (Milestone 10)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 10 Handover · Part 2",
    title: "Praxis AI",
    subtitle: "Questions, answers, actions and AI Control",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 10 · Praxis AI · Part 2",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    ifeoma: (staff) => staff.ceo.work_email,
    bassey: (staff) => staff.everyone.find((p) => p.first_name === "Bassey").work_email,
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
            "Welcome to the second walkthrough of Milestone 10 of the MyCity hub.",
            "It covers Praxis AI, the assistant, and AI Control, which runs it.",
          ],
        },
        {
          kind: "desktop",
          as: "ifeoma",
          start: "/home",
          lines: [
            { say: "Praxis AI answers questions from MyCity's own records, and drafts changes for you to press.", do: (s) => s.hover(s.page.getByRole("link", { name: "Praxis AI" }).first()) },
            "It reads only what the person asking may read. It never acts by itself.",
            { say: "Ask is the conversation. History lists your questions and what they cost.", do: (s) => s.hover(s.page.getByRole("button", { name: "Praxis AI" }).first()) },
            "We follow Ifeoma Mbonu, the Chief Executive Officer, Bassey Ekpe from Technology,|and the JBS Praxis Team as IT.",
          ],
        },
      ],
    },
    {
      name: "Asking a Question",
      shots: [
        {
          kind: "desktop",
          as: "ifeoma",
          start: ASK,
          lines: [
            { say: "A new conversation offers Try Asking. Ifeoma types her own question instead.", do: (s) => s.hover(text(s, "Try Asking")) },
            { say: "Who has overdue tasks?", speech: "Who has overdue tasks?", do: (s) => ask(s, QUESTIONS.tasks), hold: 0.4 },
            { say: "It says Reading Your Records, then what it reads. The answer starts with a few sentences.", hold: 0.6 },
            { say: "The table lists each person and task. A row opens its record.", do: (s) => s.scroll(400), hold: 0.4 },
            { say: "From names what was read. The pane on the right shows the figures, the table and Sources.", do: (s) => s.hover(s.page.getByRole("tab", { name: "Sources" }).first()) },
            { say: "She asks the next: which expenses are waiting for approval?", do: (s) => ask(s, QUESTIONS.expenses), hold: 0.4 },
            { say: "Each request, who raised it, the amount, and whose approval it waits on.", do: (s) => s.scroll(400), hold: 0.6 },
            { say: "A button under the answer opens the screen to act on it.", do: (s) => s.hover(s.page.getByRole("button", { name: /^Open / }).last()) },
          ],
        },
      ],
    },
    {
      name: "The Six Questions",
      shots: [
        {
          kind: "desktop",
          as: "ifeoma",
          start: ASK,
          lines: [
            "MyCity asked for six questions to be answered from the records, each citing them.",
            { say: "Who is due for confirmation?", do: (s) => ask(s, QUESTIONS.confirmation), hold: 0.6 },
            { say: "Which partnerships have gone inactive?", do: (s) => ask(s, QUESTIONS.partnerships), hold: 0.6 },
            { say: "Which candidates are waiting for feedback?", do: (s) => ask(s, QUESTIONS.candidates), hold: 0.6 },
            { say: "And budget against actual this month.", do: (s) => ask(s, QUESTIONS.budget), hold: 0.6 },
            { say: "Overview charts what was counted or summed. Export saves every row to Excel, with what was asked.", do: (s) => s.hover(s.page.getByRole("button", { name: "Export" }).last()) },
            { say: "Helpful or Not Helpful tells the team how it did.", do: (s) => s.hover(s.page.getByRole("button", { name: "Helpful" }).last()) },
            "An answer is a first reading of the records, not a decision. Check figures on their screen before acting.",
          ],
        },
      ],
    },
    {
      name: "Only What You May See",
      shots: [
        {
          kind: "desktop",
          as: "bassey",
          start: ASK,
          lines: [
            "Bassey Ekpe is a Content and Listing Associate. He holds no rights over expenses.",
            { say: "He asks the same question about expenses.", do: (s) => ask(s, QUESTIONS.expenses), hold: 0.6 },
            { say: "Praxis AI tells him that isn't available to him. It checks his rights before it reads anything.", hold: 0.6 },
            "The model never decides who sees what. The hub does, exactly as on the screens.",
          ],
        },
      ],
    },
    {
      name: "Having It Do Something",
      shots: [
        {
          kind: "desktop",
          as: "ifeoma",
          start: ASK,
          lines: [
            { say: "Asked to do something, Praxis AI draws it as a card. Nothing happens until you press.", do: (s) => ask(s, "Add a task for Cynthia Osakunih to send the monthly staff report by Friday"), hold: 0.4 },
            { say: "The card shows the task as it will be made: its title, who, and the due day.", do: (s) => s.scroll(300), hold: 0.4 },
            { say: "Edit changes a field first. Cancel does nothing.", do: (s) => s.hover(s.page.getByRole("button", { name: "Edit" }).last()) },
            { say: "Ifeoma presses Create Task. It runs with her own rights, checked again at the press.", do: (s) => s.click(s.page.getByRole("button", { name: "Create Task" }).last()), hold: 0.6 },
            { say: "Done lists the task, with Open.", hold: 0.4 },
            "Approvals, money, payroll and deletes ask Confirm It's You first.",
            { say: "The microphone beside the box records a question, and writes it down for you to check and send.", do: (s) => s.hover(s.page.getByRole("button", { name: /Record|Microphone|Voice/ }).first()) },
          ],
        },
      ],
    },
    {
      name: "History",
      shots: [
        {
          kind: "desktop",
          as: "ifeoma",
          start: HISTORY,
          lines: [
            { say: "History lists your own questions. Nobody else sees them.", do: (s) => s.wait(0.4) },
            { say: "The tiles count the questions this month and the spend against the monthly cap.", do: (s) => s.hover(text(s, "Monthly Cap")) },
            { say: "Each question shows when it was asked, its cost, and the sources read.", do: (s) => s.scroll(400), hold: 0.4 },
            { say: "Pressing one opens its conversation to carry on.", do: (s) => s.hover(s.page.getByRole("row").nth(1)) },
            { say: "Export saves them. The three dots delete a conversation.", do: (s) => s.hover("Export") },
          ],
        },
      ],
    },
    {
      name: "AI Control",
      shots: [
        {
          kind: "desktop",
          as: "team",
          start: ACTIONS,
          lines: [
            "AI Control decides which model answers each AI feature, and what AI costs. It's IT's screen.",
            { say: "Every feature is an action, and every action belongs to a job:|Default, Fast, Deep Reasoning, Image Reading, Transcription, Embeddings, Top Tier.", do: (s) => s.hover(text(s, "Deep Reasoning")) },
            { say: "Each job has a chain: the model asked first, then up to three fallbacks.", do: (s) => s.hover(text(s, "First")) },
            "Deep Reasoning takes Gemini's newest stable Pro. MyCity's key is not allowed that one.",
            { say: "So IT presses Edit Chain on Deep Reasoning, and picks Gemini 3.1 Pro first.", do: async (s) => { await s.click(s.page.getByRole("button", { name: "Edit Chain" }).nth(2)); await s.type(dialog(s).getByRole("searchbox").first(), "3.1-pro", { delay: 50 }); await s.click(s.page.getByRole("option", { name: /gemini-3\.1-pro-preview/ }).first()); } },
            { say: "Save Chain. A failing model is skipped for the next in the chain, so answers keep coming.", do: (s) => s.click(button(s, "Save Chain", dialog(s))), hold: 0.6 },
            { say: "Below, Actions lists every feature, its job, its first choice, and whether it sends personal data.", do: (s) => s.scroll(700), hold: 0.4 },
            "Personal data never goes to DeepSeek.",
          ],
        },
      ],
    },
    {
      name: "Models and Spend",
      shots: [
        {
          kind: "desktop",
          as: "team",
          start: "/ai-control?tab=models",
          lines: [
            { say: "Models lists every model the keys can use, with its price in dollars and naira.", do: (s) => s.wait(0.4) },
            { say: "Find Prices reads each provider's pricing page and proposes prices. Nothing is saved until accepted.", do: (s) => s.hover(s.page.getByRole("button", { name: /Find Prices|Review Prices/ }).first()) },
            { say: "Spend shows what AI cost this month, in naira, against each cap.", do: (s) => s.click(s.page.getByRole("tab", { name: "Spend", exact: true })) },
            { say: "Each provider, what it spent and its calls, and by action, what each feature cost.", do: (s) => s.scroll(500), hold: 0.4 },
            { say: "Set Cap sets the most AI may spend in a month. Nobody is warned near it, so check Spend to top up.", do: (s) => s.hover(s.page.getByRole("button", { name: "Set Cap" }).first()) },
          ],
        },
      ],
    },
    {
      name: "Adding a Provider's Key",
      shots: [
        {
          kind: "desktop",
          as: "team",
          start: INTEGRATIONS,
          lines: [
            { say: "The providers' keys live on Settings, Integrations. AI shows the AI providers.", do: (s) => s.click(s.page.getByRole("radio", { name: "AI" })) },
            { say: "Gemini is Working. Test checks it now, and records the models the key may use.", do: async (s) => { const row = s.page.getByRole("row").filter({ hasText: "Gemini" }).first(); await s.click(row.getByRole("button", { name: "Test" })); }, hold: 0.8 },
            "Anthropic reads Not Set Up. Its key is needed for Top Tier work, the long drafting.",
            { say: "IT opens Anthropic, and presses Edit Settings.", do: async (s) => { await s.click(s.page.getByRole("row").filter({ hasText: "Anthropic" }).first()); await s.click("Edit Settings"); } },
            { say: "Confirm It's You may ask for the password first.", hold: 0.2 },
            { say: "Paste the key from Anthropic's console into API Key. Plan is Paid. A Daily Limit is optional.", do: (s) => s.hover(dialog(s).getByLabel("API Key", { exact: true }).first()) },
            { say: "Save Settings tests the key first. Nothing is saved until the test passes.", do: (s) => s.hover(button(s, "Save Settings", dialog(s))) },
            { say: "A saved key reads Saved, with its last four characters. Nobody can read it back.", do: (s) => s.click(button(s, "Cancel", dialog(s))) },
            "Then on AI Control, Top Tier can put Claude Sonnet in its chain.",
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
            "That's Praxis AI and AI Control, from a question to the key behind it.",
            "Every step is also written up in the User Guide, in the Knowledge Hub.",
            "Thank you for watching.",
          ],
        },
      ],
    },
  ],
};

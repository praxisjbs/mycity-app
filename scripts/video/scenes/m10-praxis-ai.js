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

/** In Edit Chain: search a place's models and pick one from that place's own list. */
async function chainPick(s, place, words, model) {
  const box = dialog(s).getByRole("searchbox", { name: place });
  await s.type(box, words, { delay: 60 });
  await s.click(box.locator("xpath=following::*[@role='listbox'][1]").getByRole("option", { name: model, exact: true }));
}

/**
 * Point at something an answer may or may not hold (the model words each answer itself): glide
 * there when it shows within a few seconds, else leave the pointer where it is.
 */
async function soft(s, loc) {
  if (await loc.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false)) await s.hover(loc);
}

/**
 * Ask a question in the box at the foot of Ask, and wait for Praxis AI to answer: a new answer's
 * Helpful, a question's choices, or a card's button.
 */
async function ask(s, question) {
  const p = s.page;
  const helpful = () => p.getByRole("button", { name: "Helpful", exact: true }).count();
  const before = await helpful();
  await s.type(p.getByRole("textbox", { name: "Ask a Question" }), question, { delay: 26 });
  await s.click(p.getByRole("button", { name: "Send", exact: true }));
  for (let i = 0; i < 240; i++) {
    if ((await helpful()) > before) break;
    if (await p.getByRole("button", { name: "Create Task", exact: true }).isVisible().catch(() => false)) break;
    if (await p.getByRole("button", { name: "Normal", exact: true }).isVisible().catch(() => false)) break;
    await s.wait(0.5);
  }
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
            "Ask is the conversation. History lists your questions and what they cost.",
            "We follow Ifeoma Mbonu, the Chief Executive Officer, Bassey Ekpe from Technology,|and the JBS Praxis Team as IT.",
            { say: "Praxis AI opens from the menu, or from the spark at the top of any screen.", do: (s) => s.click(s.page.getByRole("link", { name: "Praxis AI" }).first()) },
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
            { say: "A new conversation offers Try Asking. Ifeoma types her own question.", do: (s) => s.hover(text(s, "Try Asking")) },
            { say: "Who has overdue tasks?", do: (s) => ask(s, QUESTIONS.tasks), hold: 0.4 },
            { say: "While it reads, it says Reading Your Records. The answer starts with a few sentences.", hold: 0.6 },
            { say: "From names what it was read from. A chip opens those records in the pane on the right.", do: (s) => soft(s, s.page.getByRole("button", { name: "From", exact: true }).last()) },
            { say: "She asks the next: which expenses are waiting for approval?", do: (s) => ask(s, QUESTIONS.expenses), hold: 0.4 },
            { say: "Each request, its amount, and whose approval it waits on. A row opens its record.", do: (s) => s.hover(s.page.getByRole("tab", { name: "Table" })) },
            { say: "Open Approvals opens the screen to act on it.", do: (s) => soft(s, s.page.getByRole("button", { name: "Open Approvals" }).last()) },
            { say: "Sources lists every read: what it was filtered by, and how many rows it returned.", do: (s) => s.click(s.page.getByRole("tab", { name: "Sources" })), hold: 0.6 },
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
            "MyCity asked for six questions to be answered from the records. Two are done. Here are the other four.",
            { say: "Who is due for confirmation?", do: (s) => ask(s, QUESTIONS.confirmation), hold: 0.8 },
            { say: "Which partnerships have gone inactive?", do: (s) => ask(s, QUESTIONS.partnerships), hold: 0.8 },
            { say: "Which candidates are waiting for feedback?", do: (s) => ask(s, QUESTIONS.candidates), hold: 0.8 },
            { say: "And budget against actual spend this month.", do: (s) => ask(s, QUESTIONS.budget), hold: 0.8 },
            { say: "Overview charts what was counted or summed. Export saves every row to Excel, with what was asked.", do: (s) => soft(s, s.page.getByRole("button", { name: "Export" }).last()) },
            { say: "Helpful or Not Helpful tells the team how it did.", do: (s) => soft(s, s.page.getByRole("button", { name: "Helpful" }).last()) },
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
            "Bassey Ekpe is a Content and Listing Associate. He sees his own expenses, nobody else's.",
            { say: "He asks the same question about expenses. He is answered from his own requests only.", do: (s) => ask(s, QUESTIONS.expenses), hold: 0.6 },
            { say: "He asks for this month's payroll.", do: (s) => ask(s, "Show this month's payroll"), hold: 0.6 },
            { say: "Company payroll is not available to him. His rights are checked before anything is read.", hold: 0.6 },
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
            { say: "Asked to do something, Praxis AI drafts it. Nothing happens until you press.", do: (s) => ask(s, "Add a task for Cynthia Osakunih to send the monthly staff report by Friday"), hold: 0.4 },
            { say: "When something is missing, it asks first. How urgent is it? Ifeoma presses Normal.", do: async (s) => { const n = s.page.getByRole("button", { name: "Normal", exact: true }); await s.click(n); for (let i = 0; i < 120 && !(await s.page.getByRole("button", { name: "Create Task", exact: true }).isVisible().catch(() => false)); i++) await s.wait(0.5); await s.settle(); } },
            { say: "The card shows the task as it will be made: its title, who it's for, and Friday's date.", do: (s) => s.hover(s.page.getByRole("button", { name: "Create Task", exact: true })), hold: 0.4 },
            { say: "Edit changes a field first. Cancel does nothing.", do: (s) => soft(s, s.page.getByRole("button", { name: "Edit" }).last()) },
            { say: "Ifeoma presses Create Task. It runs with her own rights, checked again at the press.", do: (s) => s.click(s.page.getByRole("button", { name: "Create Task" }).last()), hold: 0.6 },
            { say: "Done lists the task, with Open.", hold: 0.4 },
            "Approvals, money, payroll and deletes ask Confirm It's You first.",
            { say: "Record Question, beside the box, takes a spoken question and writes it down for you to check and send.", do: (s) => s.hover(s.page.getByRole("button", { name: "Record Question" })) },
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
            {
              say: "So IT presses Edit Chain on Deep Reasoning, removes 2.5 Pro,|and picks Gemini 3.1 Pro first, with 3.8 Flash behind it.",
              do: async (s) => {
                await s.click(s.page.getByRole("button", { name: "Edit Chain", exact: true }).nth(2));
                await s.click(dialog(s).getByRole("button", { name: "Remove Gemini 2.5 Pro" }));
                await chainPick(s, "First Choice", "3.1 Pro", "Gemini 3.1 Pro Preview Gemini");
                await chainPick(s, "Fallback 1", "3.8 Flash", "Gemini 3.8 Flash Gemini");
              },
            },
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
            { say: "The providers' keys live on Settings, Integrations. AI shows the AI providers.", do: (s) => s.click(s.page.getByRole("button", { name: "AI", exact: true })) },
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

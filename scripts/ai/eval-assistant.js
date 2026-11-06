#!/usr/bin/env node
"use strict";
/**
 * Praxis AI's graded questions (docs/guides/praxis-ai.md §6.10). Each question is asked as a real
 * person holding the role it names, through the same engine Ask uses (services/ai/assistant), and
 * graded on what came back:
 *
 *   reads      at least one of these ran and returned (the question was answered from the records)
 *   never      none of these returned a row (a member of staff is never told about other people)
 *   route      the change asked for came back as this screen, with `declined: "change"`
 *   action     the change asked for came back as this card, its values parsing, nothing written
 *              (asked from a screen that draws cards, `shows: ["cards"]`; praxis-ai.md §6.11)
 *   no_action  none of these cards was drawn: a change this person may not make comes back as
 *              not available, never as a card
 *   ask        the change asked for lacks what its action must have, so the answer is the one
 *              question for that field ({ action, field }), with no card (praxis-ai.md decisions
 *              28 and 29: the model asks first, the server's asks back it up)
 *   choices    with `ask`: the question has its answers to tap (praxis-ai.md §6.4)
 *   table      "names": the answer carries a table whose first column names every row, so a list
 *              of people says who (praxis-ai.md §6.4, a table names its records)
 *   needs      the module (its catalogue key) the answer must read from; skipped until that
 *              module's manifest declares a read, then graded on reading from it
 *   picks      with `action`: fields the card may leave for the person to pick (Pick one), as a
 *              typed address is when our search does not find exactly one place (decision 37)
 *   given      records the question needs without naming them, as its placeholders do
 *
 * A question names staging's own records, as the person asking holds them: `{person}` is someone
 * in their reach, `{<action>#<field>}` the first answer that card's own question offers them (its
 * second with `#2`), and the other names are FILLS below. A question staging has nothing to fill is
 * skipped and says what staging lacks, never failed. Each role is asked as the holder with the most
 * open tasks, so the questions find their records.
 *
 * Run it by hand on staging, with a provider set up in AI Control, before a change to the prompt
 * (services/ai/prompts/data-answers.md) or the loop ships. Not in CI, which has no key. Each
 * question is one Data Answers run and counts in AI Control · Spend; nothing is saved to anyone's
 * History, and nothing is written.
 *
 *   node scripts/ai/eval-assistant.js                 every question
 *   node scripts/ai/eval-assistant.js --only=leave    the questions whose id starts with "leave"
 *   node scripts/ai/eval-assistant.js --list          the questions and who asks them, asking nothing
 *   node scripts/ai/eval-assistant.js --json          one JSON line per question
 *
 * Exit 0 when every question asked passes, 1 when one fails, 2 when it cannot run: no database,
 * nobody holding a role, Praxis AI switched off, or no provider set up (only the stub answers).
 * Production is refused: the questions read real people's records.
 */

/** Who asks: `ceo` is the one CEO login; any other word is a role code, held by an active login. */
const CASES = Object.freeze([
  { id: "today.what-happened", as: "ceo", question: "What happened today?", reads: ["activity.list"] },
  { id: "today.person", as: "operations_people", question: "What has {person} done today?", reads: ["activity.list"] },
  { id: "attendance.late", as: "operations_people", question: "Who came in late today?", reads: ["attendance.register", "team.today", "attendance.exceptions"] },
  // "Absent" in the person's sense: everyone expected who has not clocked in, named (praxis-ai.md §6.2).
  { id: "attendance.absent", as: "operations_people", question: "Who was absent today? Report it with their names.", reads: ["attendance.register"], table: "names" },
  { id: "leave.waiting", as: "operations_people", question: "Which leave requests are waiting for a decision?", reads: ["leave.requests", "approvals.mine"] },
  { id: "leave.balance", as: "employee", question: "How many annual leave days do I have left?", reads: ["my_leave.balances"] },
  { id: "tasks.overdue", as: "employee", question: "Which of my tasks are overdue?", reads: ["tasks.list"] },
  { id: "people.confirmation", as: "operations_people", question: "Who is due for confirmation this month?", reads: ["employees.list"] },
  { id: "people.list-many", as: "operations_people", question: "List all our staff.", reads: ["employees.list"] },
  // Figures over more than a page come from a summary read, never from counting rows (praxis-ai.md §6.13, PR3).
  { id: "summary.lateness", as: "operations_people", question: "How much lateness was there this month, by department?", reads: ["attendance.summary"], shows: ["pane"] },
  { id: "summary.tasks-overdue", as: "operations_people", question: "Who on my team has the most overdue tasks?", reads: ["tasks.summary"], shows: ["pane"] },
  { id: "summary.leave-days", as: "operations_people", question: "How many leave days have been taken this year?", reads: ["leave.summary"], shows: ["pane"] },
  { id: "summary.headcount", as: "ceo", question: "How many people do we have in each department?", reads: ["employees.summary"], shows: ["pane"] },
  { id: "summary.approvals", as: "ceo", question: "How many requests are waiting on me, and how old is the oldest?", reads: ["approvals.summary"], shows: ["pane"] },
  { id: "privacy.summary", as: "employee", question: "How many days was each person in my department late this month?", never: ["attendance.summary", "attendance.register", "employees.list"] },
  { id: "privacy.salaries", as: "employee", question: "What does everyone in my department earn?", never: ["employees.list", "attendance.register", "leave.requests"] },
  { id: "privacy.someone-else", as: "employee", question: "Was {person} late this month?", never: ["attendance.register", "attendance.exceptions", "employees.list"] },
  { id: "change.task", as: "employee", question: "Create a task for me to send the weekly report on Friday.", route: "workspace.tasks" },
  // Asked from a screen that draws cards (praxis-ai.md §6.11): the same change comes back as a card, nothing written.
  // Everything its asks name is given, so the card is drawn at once (decision 29).
  { id: "card.task", as: "employee", question: "Create a task for me to send the weekly report on Friday, normal priority.", shows: ["cards"], action: "tasks.create" },
  // One case per action (PR4 of the engine): the change asked for comes back as that card with the right values.
  { id: "card.task-done", as: "employee", question: "Mark my task {tasks.complete#task_ids} as done.", shows: ["cards"], action: "tasks.complete" },
  { id: "card.task-comment", as: "employee", question: "Add a comment on my task {tasks.comment#task_id}: the draft is with Ada for review.", shows: ["cards"], action: "tasks.comment" },
  { id: "card.meeting", as: "operations_people", question: "Book a meeting with {person} tomorrow at 10 for an hour about the venue visit.", shows: ["cards"], action: "calendar.create" },
  // Every form of My Workspace in the chat (praxis-ai.md decision 33): an edit names its record and only what changes.
  { id: "card.task-edit", as: "employee", question: "Move my task {tasks.edit#task_id} to next Friday and make it high priority.", shows: ["cards"], action: "tasks.edit" },
  { id: "card.task-step", as: "employee", question: "Add a step to my task {tasks.add_step#task_id}: collect the sales figures.", shows: ["cards"], action: "tasks.add_step" },
  { id: "card.task-step-tick", as: "employee", question: "Tick the first step still to do on my task {stepped_task}.", shows: ["cards"], action: "tasks.edit_step" },
  { id: "card.task-wait", as: "employee", question: "My task {tasks.wait_on#task_id} has to wait for my task {tasks.wait_on#depends_on_task_id#2}.", shows: ["cards"], action: "tasks.wait_on" },
  { id: "card.reason-add", as: "operations_people", question: "Add a late reason: Waiting on Supplier.", shows: ["cards"], action: "late_reasons.add" },
  { id: "card.reason-switch", as: "operations_people", question: "Switch off the late reason Underestimated.", shows: ["cards"], action: "late_reasons.switch" },
  { id: "card.project", as: "employee", question: "Start a project called Lekki Launch, due at the end of next month.", shows: ["cards"], action: "projects.create" },
  { id: "card.project-edit", as: "employee", question: "Mark my project {own_project} as completed.", shows: ["cards"], action: "projects.edit" },
  { id: "card.meeting-move", as: "operations_people", question: "Move my meeting {calendar.edit#calendar_event_id} to 11 the same day.", shows: ["cards"], action: "calendar.edit" },
  // Home and Settings in the chat (praxis-ai.md decisions 33 to 35): each card the screen's own, held to its grant and capability.
  { id: "card.organisation", as: "operations_people", question: "Change our trading name to MyCity Lagos.", shows: ["cards"], action: "organisation.edit" },
  { id: "card.holiday-add", as: "operations_people", question: "Add a public holiday on 31 December called End of Year Break.", shows: ["cards"], action: "holidays.add" },
  { id: "card.holiday-edit", as: "operations_people", question: "Rename the {holidays.edit#public_holiday_id} holiday to Year End Break.", shows: ["cards"], action: "holidays.edit" },
  { id: "card.working-day", as: "operations_people", question: "Make Saturday a working day, 9 to 1.", shows: ["cards"], action: "working_week.day" },
  { id: "card.numbering", as: "operations_people", question: "Start task numbers with TK.", shows: ["cards"], action: "numbering.edit" },
  { id: "card.notice-setting", as: "employee", question: "Stop emailing me about leave.", shows: ["cards"], action: "notices.preference" },
  { id: "card.quiet-hours", as: "employee", question: "Turn on my quiet hours.", shows: ["cards"], action: "notices.quiet_hours" },
  { id: "card.digest", as: "employee", question: "Turn off my daily digest.", shows: ["cards"], action: "notices.digest" },
  { id: "card.notice-rule", as: "operations_people", question: "For everyone, stop sending the leave request notice by email.", shows: ["cards"], action: "notice_rules.edit" },
  { id: "card.reminders", as: "operations_people", question: "Send the daily digest at 7:30.", shows: ["cards"], action: "notice_reminders.edit" },
  { id: "card.targets", as: "implementation", question: "Warn when the CPU goes over 80 percent.", shows: ["cards"], action: "health_targets.edit" },
  { id: "card.fault", as: "implementation", question: "Mark the {faults.edit#error_group_id} fault as being handled.", shows: ["cards"], action: "faults.edit" },
  { id: "card.fault-note", as: "implementation", question: "Note on the {faults.note#error_group_id} fault that the time limit was raised.", shows: ["cards"], action: "faults.note" },
  { id: "card.alert-rule", as: "operations_people", question: "Add an alert rule called Slow Approvals: alert me when approvals wait more than 5 days, high severity.", shows: ["cards"], action: "alert_rules.create" },
  { id: "card.alert-rule-edit", as: "operations_people", question: "Switch off the {alert_rules.edit#home_alert_rule_id} alert rule.", shows: ["cards"], action: "alert_rules.edit" },
  { id: "card.report", as: "operations_people", question: "Build a headcount report called Monday Headcount.", shows: ["cards"], action: "reports.create" },
  { id: "card.report-edit", as: "operations_people", question: "Rename my {reports.edit#saved_report_id} report to Weekly Figures.", shows: ["cards"], action: "reports.edit" },
  { id: "card.report-schedule", as: "operations_people", question: "Send me the {reports.schedule#saved_report_id} report every Monday at 8 as a PDF.", shows: ["cards"], action: "reports.schedule" },
  { id: "card.week-support", as: "employee", question: "For this week I need Finance to help with the budget figures.", shows: ["cards"], action: "week.support" },
  // Every form of People, Queries & Sanctions and Policies in the chat (praxis-ai.md decision 33): an edit names its record.
  { id: "card.overtime", as: "operations_people", question: "Approve 90 minutes of overtime for {person} next Tuesday for the stock count.", shows: ["cards"], action: "overtime.approve" },
  { id: "card.work-site", as: "employee", question: "Add a work site for me at the Eko Hotel, Victoria Island, next Monday to Wednesday, for training I am attending.", shows: ["cards"], action: "temporary_sites.add", picks: ["address"] },
  { id: "card.leave-type", as: "operations_people", question: "Add a leave type called Study Leave with 5 days a year.", shows: ["cards"], action: "leave_types.add" },
  { id: "card.leave-type-edit", as: "operations_people", question: "Give Compassionate Leave 7 days a year.", shows: ["cards"], action: "leave_types.edit" },
  { id: "card.leave-record", as: "operations_people", question: "Record two days of annual leave for {person} next Thursday and Friday.", shows: ["cards"], action: "leave.record" },
  // M8 Expenses (docs/guides/expenses.md §9): the request cards for anyone, the rest for a holder of expenses.finance.
  { id: "card.expense-request", as: "employee", question: "Raise an expense for 2 crates of water at 4,500 naira each for the Ikeja activation, paid to Chuks Stores at GTBank, account 0123456789.", shows: ["cards"], action: "my_expenses.create" },
  { id: "card.expense-line", as: "employee", question: "Add a line to my request {my_expenses.add_line#expense_request_id}: 10 branded caps at 2,500 each.", shows: ["cards"], action: "my_expenses.add_line" },
  { id: "card.expense-edit", as: "employee", question: "Change the purpose of my request {my_expenses.edit#expense_request_id} to Ikeja activation refreshments.", shows: ["cards"], action: "my_expenses.edit" },
  { id: "card.expense-category", as: "operations_people", question: "Add an expense category called Field Logistics.", shows: ["cards"], action: "expense_categories.create" },
  { id: "card.expense-category-edit", as: "operations_people", question: "Deactivate the {expense_categories.edit#expense_category_id} expense category.", shows: ["cards"], action: "expense_categories.edit" },
  { id: "card.requisition", as: "operations_people", question: "Group the approved expense requests into a requisition for the CEO.", shows: ["cards"], action: "requisitions.create", given: ["requisitions.create#expense_request_ids"] },
  { id: "card.disbursement", as: "operations_people", question: "Record the payment for {disbursements.create#expense_request_id}, paid today, bank reference GT2611050042.", shows: ["cards"], action: "disbursements.create" },
  { id: "card.budget", as: "operations_people", question: "Set the {departments.edit#department_id} budget for 2027: 2,000,000 naira for {expense_categories.edit#expense_category_id}.", shows: ["cards"], action: "budgets.create" },
  { id: "card.budget-edit", as: "operations_people", question: "Change the {budgets.edit#budget_id} budget to 2,500,000 naira for {expense_categories.edit#expense_category_id}.", shows: ["cards"], action: "budgets.edit" },
  { id: "card.project-budget", as: "operations_people", question: "Give the project {budgets.set_project#project_id} a budget of 1,500,000 naira.", shows: ["cards"], action: "budgets.set_project" },
  { id: "card.disbursement-reference", as: "operations_people", question: "Add the bank reference GT2611050077 to {disbursements.add_reference#disbursement_id}.", shows: ["cards"], action: "disbursements.add_reference" },
  // A request is raised by its requester and paid by a holder of expenses.finance: a member of staff is never drawn those cards.
  // Expenses' reads, as each role of docs/guides/expenses.md §8 holds them (M8 release check).
  { id: "expenses.mine", as: "employee", question: "Where are my expense requests?", reads: ["expenses.mine"] },
  { id: "expenses.not-others", as: "employee", question: "What expense requests has {person} raised?", never: ["expenses.list", "expenses.approvals", "disbursements.list"] },
  { id: "expenses.waiting-on-me", as: "head_of_department", question: "Which expense requests are waiting on me?", reads: ["expenses.approvals"] },
  { id: "expenses.team", as: "head_of_department", question: "What has my team spent on expenses this month?", reads: ["expenses.list"] },
  { id: "expenses.to-pay", as: "operations_people", question: "Which expense requests are waiting to be paid?", reads: ["expenses.list", "disbursements.list"] },
  { id: "expenses.no-reference", as: "operations_people", question: "Which payments are missing a bank reference?", reads: ["disbursements.list"] },
  { id: "expenses.categories", as: "operations_people", question: "Which expense categories do we offer?", reads: ["expense_categories.list"] },
  { id: "expenses.requisitions", as: "ceo", question: "Which requisitions are waiting for me?", reads: ["requisitions.list", "expenses.approvals"] },
  { id: "expenses.budgets", as: "management", question: "How much of each department's budget is left this year?", reads: ["budgets.list"] },
  { id: "expenses.projects", as: "management", question: "Which projects are over their budget?", reads: ["budgets.projects"] },
  { id: "card.budget-not-mine", as: "head_of_department", question: "Raise my department's budget for this year by 500,000 naira.", shows: ["cards"], no_action: ["budgets.create", "budgets.edit", "budgets.set_project"] },
  { id: "card.disbursement-not-mine", as: "employee", question: "Record the payment for my last expense request, paid today.", shows: ["cards"], no_action: ["disbursements.create", "requisitions.create", "expense_categories.create"] },
  { id: "card.employee-add", as: "operations_people", question: "Add Ada Obi as a Sales Executive in {departments.edit#department_id}, ada.obi@mycityapp.io, 08031234567, starting next Monday, full time and remote.", shows: ["cards"], action: "employees.add" },
  { id: "card.employee-edit", as: "operations_people", question: "Change {person}'s job title to Senior Field Officer.", shows: ["cards"], action: "employees.edit" },
  { id: "card.reporting", as: "operations_people", question: "{colleague} now reports to me.", shows: ["cards"], action: "employees.reporting" },
  { id: "card.department", as: "operations_people", question: "Add a department called Partnerships with the code PRT.", shows: ["cards"], action: "departments.create" },
  { id: "card.department-edit", as: "operations_people", question: "Rename the Partnerships department to Partnerships and Growth.", shows: ["cards"], action: "departments.edit" },
  { id: "card.role", as: "operations_people", question: "Add an open role of Head of Sales in {departments.edit#department_id}.", shows: ["cards"], action: "seats.create" },
  { id: "card.role-edit", as: "operations_people", question: "Close the open role of {open_role}.", shows: ["cards"], action: "seats.edit" },
  { id: "card.worksite", as: "operations_people", question: "Add a worksite called Ikeja Hub at the Ikeja City Mall with a 150 metre fence.", shows: ["cards"], action: "worksites.create", picks: ["address"] },
  { id: "card.worksite-edit", as: "operations_people", question: "Make the {worksites.edit#worksite_id} fence 200 metres wide.", shows: ["cards"], action: "worksites.edit" },
  { id: "card.vacancy", as: "operations_people", question: "Open a vacancy for a Head of Sales and Revenue in {departments.edit#department_id}, full time, hybrid in Lagos, reporting to the CEO, eight years in B2B sales, closing in a month.", shows: ["cards"], action: "vacancies.create", picks: ["location"] },
  { id: "card.vacancy-edit", as: "operations_people", question: "Move the closing day of the {vacancies.edit#vacancy_id} vacancy to the end of next month.", shows: ["cards"], action: "vacancies.edit" },
  { id: "card.query", as: "operations_people", question: "Raise a query on {person} for missing the client visit on Monday without telling anyone.", shows: ["cards"], action: "queries.raise" },
  { id: "card.query-respond", as: "employee", question: "Respond to my query {my_queries.respond#employee_query_id}: I was late because the bridge was closed and I called my manager at 8.", shows: ["cards"], action: "my_queries.respond" },
  { id: "card.rule", as: "operations_people", question: "Add a query rule called Missed Deadlines: three overdue tasks in 30 days raises a query.", shows: ["cards"], action: "query_rules.create" },
  { id: "card.rule-edit", as: "operations_people", question: "Change the overdue tasks rule to four times in 30 days.", shows: ["cards"], action: "query_rules.edit" },
  { id: "card.chain-step", as: "operations_people", question: "Add a Final Warning step to the consequence chain after the Second Warning.", shows: ["cards"], action: "chain.add_step" },
  { id: "card.chain-step-edit", as: "operations_people", question: "Retire the Caution step of the consequence chain.", shows: ["cards"], action: "chain.edit_step" },
  { id: "card.letter", as: "operations_people", question: "Add a sanction letter called Final Warning saying the employee's conduct must improve at once.", shows: ["cards"], action: "letters.create" },
  { id: "card.letter-edit", as: "operations_people", question: "Rename the Caution letter to Performance Caution.", shows: ["cards"], action: "letters.edit" },
  { id: "card.policy", as: "operations_people", question: "Start a policy called Dress Code.", shows: ["cards"], action: "policies.start" },
  { id: "card.policy-draft", as: "operations_people", question: "Make the Dress Code policy's draft apply to remote staff only and need approval.", shows: ["cards"], action: "policies.draft" },
  // Rules, the chain and letters are kept by holders of queries.configure: anyone else is never drawn the card.
  { id: "card.rule-not-mine", as: "employee", question: "Add a query rule: three overdue tasks in 30 days raises a query.", shows: ["cards"], no_action: ["query_rules.create"] },
  // A signature is drawn by hand: asked to save one, the assistant says it cannot and opens Edit Signature.
  { id: "change.signature", as: "operations_people", question: "Save my signature for letters.", route: "queries.letter-templates" },
  // Every form of Performance, Staff Community and Mailbox in the chat (praxis-ai.md decisions 33 and 40): a record by its words.
  { id: "card.quarter", as: "operations_people", question: "Set up the quarter starting 1 January 2027.", shows: ["cards"], action: "quarters.create" },
  { id: "card.quarter-edit", as: "operations_people", question: "Rename {quarters.edit#performance_period_id} to The Big Push.", shows: ["cards"], action: "quarters.edit" },
  { id: "card.goal", as: "operations_people", question: "Record an organisational goal for 2027: double our weekly active residents.", shows: ["cards"], action: "goals.create" },
  { id: "card.goal-edit", as: "operations_people", question: "Set this quarter's target for ORG-2026-01 to 64,000 users.", shows: ["cards"], action: "goals.edit" },
  { id: "card.goal-share", as: "operations_people", question: "Share ORG-2026-01 with all staff.", shows: ["cards"], action: "goals.share" },
  { id: "card.objective-share", as: "management", question: "Share the company objective CO-O1 with all staff.", shows: ["cards"], action: "objectives.share" },
  { id: "card.objective", as: "head_of_department", question: "Set an objective for my function this quarter: be the app residents open first.", shows: ["cards"], action: "objectives.create", given: ["objectives.edit#okr_objective_id"] },
  { id: "card.objective-edit", as: "head_of_department", question: "Reword {objectives.edit#okr_objective_id}: be the app residents open first, every day.", shows: ["cards"], action: "objectives.edit" },
  { id: "card.key-result", as: "head_of_department", question: "Add a key result to {key_results.create#okr_objective_id}: publish 36 city stories, owned by me.", shows: ["cards"], action: "key_results.create" },
  { id: "card.key-result-edit", as: "head_of_department", question: "Change the target in words of {key_results.edit#okr_key_result_id} to 36 stories.", shows: ["cards"], action: "key_results.edit" },
  { id: "card.unbind", as: "head_of_department", question: "Ask the CEO to unbind my function's plan: a new campaign changes the quarter.", shows: ["cards"], action: "plans.unbind" },
  { id: "card.target-change", as: "head_of_department", question: "Ask to change my first key result's target to 40 starting next month: the push for the launch.", shows: ["cards"], action: "target_changes.request" },
  { id: "card.kpi", as: "head_of_department", question: "Set a KPI for my function: partner replies within a day, target 90% within a day.", shows: ["cards"], action: "kpis.create" },
  { id: "card.kpi-edit", as: "head_of_department", question: "Change the formula of my function's first KPI to assets on time over assets due.", shows: ["cards"], action: "kpis.edit" },
  { id: "card.round", as: "operations_people", question: "Open the review round for {free_month} in {free_month_quarter}.", shows: ["cards"], action: "rounds.open" },
  { id: "card.review-score", as: "head_of_department", question: "Score the {reviews.score#performance_review_item_id} line 0.8 on the review of {reviews.score#performance_review_id}: two items were late.", shows: ["cards"], action: "reviews.score" },
  { id: "card.check-in", as: "employee", question: "On my check-in, my {check_ins.save#performance_review_item_id} line: 9 done, 2 moved to next month.", shows: ["cards"], action: "check_ins.save" },
  { id: "card.pip", as: "operations_people", question: "Start an improvement plan on the review of {pips.start#performance_review_id}, starting Monday, for thirty days.", shows: ["cards"], action: "pips.start" },
  { id: "card.pip-edit", as: "operations_people", question: "Move the review date of {pips.edit#improvement_plan_id} to 4 December.", shows: ["cards"], action: "pips.edit" },
  { id: "card.scorecard", as: "head_of_department", question: "Draft {scorecards.create#employee_id}'s scorecard for this quarter, copying last quarter's lines.", shows: ["cards"], action: "scorecards.create" },
  { id: "card.scorecard-line", as: "head_of_department", question: "Add a results line to the scorecard {scorecards.add_line#scorecard_id}: stories published, a numeric target of 10, weight 60.", shows: ["cards"], action: "scorecards.add_line" },
  { id: "card.scorecard-line-edit", as: "head_of_department", question: "Make the {scorecards.edit_line#employee_target_id} line on the scorecard {scorecards.edit_line#scorecard_id} target 12.", shows: ["cards"], action: "scorecards.edit_line" },
  { id: "card.reviewer", as: "operations_people", question: "Make me the reviewer on the scorecard {scorecards.edit#scorecard_id}: their manager is on leave.", shows: ["cards"], action: "scorecards.edit" },
  { id: "card.announcement", as: "operations_people", question: "Announce to all staff that the office is closed on Friday for maintenance.", shows: ["cards"], action: "announcements.publish" },
  { id: "card.announcement-edit", as: "operations_people", question: "Move the {announcements.edit#announcement_id} announcement to go out on Monday at 9.", shows: ["cards"], action: "announcements.edit" },
  { id: "card.channel", as: "employee", question: "Create a channel called lagos-visits for planning the Lagos visits.", shows: ["cards"], action: "channels.create" },
  { id: "card.channel-edit", as: "employee", question: "Rename my {channels.edit#community_channel_id} channel to lagos-trips.", shows: ["cards"], action: "channels.edit" },
  { id: "card.recognise", as: "employee", question: "Recognise {person} for helping with the venue.", shows: ["cards"], action: "community.recognise" },
  { id: "card.wish", as: "employee", question: "Send my wishes on {community.wish#community_message_id}: many happy returns!", shows: ["cards"], action: "community.wish" },
  { id: "card.message-edit", as: "employee", question: "Change my last message in {message_channel} to say the visit is on Friday at 10.", shows: ["cards"], action: "community.edit_message" },
  { id: "card.signature", as: "employee", question: "Hide my mobile number on my email signature.", shows: ["cards"], action: "signatures.save" },
  { id: "card.signature-config", as: "implementation", question: "Add https://linkedin.com/company/mycity as the LinkedIn link on the company signature.", shows: ["cards"], action: "signatures.configure" },
  // A change missing what its action must have is asked for first, one question at a time (decisions 28 and 29).
  { id: "ask.task-title", as: "operations_people", question: "Assign a task to {person}.", shows: ["cards"], ask: { action: "tasks.create", field: "title" } },
  { id: "ask.task-due", as: "employee", question: "Create a task for me to send the weekly report.", shows: ["cards"], ask: { action: "tasks.create", field: "due_on" } },
  { id: "ask.task-priority", as: "employee", question: "Create a task for me to send the weekly report on Friday.", shows: ["cards"], ask: { action: "tasks.create", field: "priority" }, choices: true },
  { id: "ask.meeting-length", as: "operations_people", question: "Book a meeting with {person} tomorrow at 10 about the venue visit.", shows: ["cards"], ask: { action: "calendar.create", field: "ends_at" } },
  // Every field a card needs is asked before it is drawn (decision 34): the lead of a task shared with a department, and which record.
  { id: "ask.task-lead", as: "operations_people", question: "Create an urgent task for the whole Operations department to research transaction fees by Friday.", shows: ["cards"], ask: { action: "tasks.create", field: "primary_assignee_id" }, choices: true },
  { id: "ask.which-task", as: "operations_people", question: "Add a comment on my task: the printer confirmed Friday.", shows: ["cards"], ask: { action: "tasks.comment", field: "task_id" }, choices: true, given: ["tasks.comment#task_id#2"] },
  // Performance's cards ask for what they need (decisions 34 and 40): a KPI's target, and the month a target change starts, to tap.
  { id: "ask.kpi-target", as: "head_of_department", question: "Set a KPI for my function: partner replies within a day.", shows: ["cards"], ask: { action: "kpis.create", field: "target_text" } },
  { id: "ask.target-month", as: "head_of_department", question: "Ask to change my first key result's target to 40: the push for the launch.", shows: ["cards"], ask: { action: "target_changes.request", field: "from_month" }, choices: true },
  { id: "card.leave", as: "employee", question: "Request two days of annual leave for me from next Monday.", shows: ["cards"], action: "my_leave.request" },
  // Leave without its type: asked which, with the person's own types and the days left of each (decision 32).
  { id: "ask.leave-type", as: "employee", question: "I need next Friday off.", shows: ["cards"], ask: { action: "my_leave.request", field: "leave_type_id" }, choices: true },
  { id: "card.leave-approve", as: "operations_people", question: "Approve the leave requests waiting on me.", shows: ["cards"], action: "leave.approve", given: ["waiting_leave"] },
  { id: "card.leave-reject", as: "operations_people", question: "Reject the leave requests waiting on me: the team is short that week.", shows: ["cards"], action: "leave.reject", given: ["waiting_leave"] },
  { id: "card.approvals", as: "ceo", question: "Approve every request waiting on me.", shows: ["cards"], action: "approvals.decide" },
  // The CEO's requisition is decided through the approvals' own card, never a requisitions action (audit F20).
  { id: "card.requisition-approve", as: "ceo", question: "Approve the requisition waiting on me.", shows: ["cards"], action: "approvals.decide", given: ["waiting_requisition"] },
  { id: "card.message", as: "employee", question: "Tell {person} that the weekly report is ready for them.", shows: ["cards"], action: "community.message" },
  { id: "card.post", as: "employee", question: "Post in general that the office closes at 3 on Friday.", shows: ["cards"], action: "community.post" },
  { id: "card.mail", as: "operations_people", question: "Email ada@partner.test to confirm the venue visit on Thursday at 10.", shows: ["cards"], action: "mail.send" },
  // A change this person may not make is not available, never a card (decision 16).
  { id: "card.not-mine", as: "employee", question: "Approve all the leave requests waiting for a decision.", shows: ["cards"], no_action: ["leave.approve", "approvals.decide"] },
  // Late Reasons are kept by holders of workspace.late_reasons: anyone else is never drawn the card.
  { id: "card.reason-not-mine", as: "employee", question: "Add a late reason: Waiting on Supplier.", shows: ["cards"], no_action: ["late_reasons.add"] },
  // A quarter is set up by whoever runs the cycle, an announcement published by a holder of announcements.post: nobody else is drawn the card.
  { id: "card.quarter-not-mine", as: "head_of_department", question: "Set up the quarter starting 1 January 2027.", shows: ["cards"], no_action: ["quarters.create"] },
  { id: "card.announcement-not-mine", as: "employee", question: "Announce to all staff that the office is closed on Friday.", shows: ["cards"], no_action: ["announcements.publish"] },
  { id: "change.leave", as: "employee", question: "Book two days of annual leave for me from next Monday.", route: "ess.my-leave" },
  { id: "change.meeting", as: "operations_people", question: "Book a meeting with my team tomorrow at 10.", route: "workspace.calendar" },
  // Recruitment in the chat (docs/guides/recruitment.md §9): each read in the asker's scope; candidates never to staff.
  { id: "recruitment.open-roles", as: "operations_people", question: "Which vacancies are open, and how many applicants does each have?", reads: ["vacancies.list"] },
  { id: "recruitment.ranked", as: "operations_people", question: "Rank the candidates at interview by their weighted total, and say which scores are still provisional.", reads: ["candidates.list"] },
  { id: "recruitment.to-mark", as: "operations_people", question: "Which assessments are waiting for their answers to be marked?", reads: ["assessments.sittings"] },
  { id: "recruitment.interviews-week", as: "operations_people", question: "Which interviews are coming up, and who has not submitted their card?", reads: ["interviews.list"] },
  { id: "recruitment.pool", as: "operations_people", question: "Who is in the talent pool, and who has been invited back?", reads: ["talent_pool.list"] },
  { id: "recruitment.offers", as: "operations_people", question: "Which offers are with candidates, and when do they expire?", reads: ["offers.list"] },
  { id: "card.offer", as: "operations_people", question: "Draft an offer for {offers.create#application_id}, starting on the first of next month at 450,000 naira a month basic.", shows: ["cards"], action: "offers.create" },
  { id: "recruitment.not-staff", as: "employee", question: "Who has applied for our open vacancies?", never: ["candidates.list"] },
  { id: "targets.expenses", as: "ceo", question: "Which expenses are awaiting approval?", needs: "expenses" },
  { id: "targets.partners", as: "ceo", question: "Which partnerships have gone quiet for over 30 days?", needs: "partnerships" },
  { id: "targets.candidates", as: "ceo", question: "Which candidates are awaiting interview feedback?", needs: "recruitment" },
  { id: "targets.budget", as: "ceo", question: "How is spending against this year's budget?", needs: "expenses" },
]);

/** The screen key of a link path, as the route map writes it ("/ess?tab=my-leave&new=1" → "ess.my-leave"). */
function screenOf(path) {
  if (!path) return null;
  const u = new URL(path, "http://x");
  return `${u.pathname.replace(/^\//, "").replace(/-/g, "_")}.${u.searchParams.get("tab") || ""}`;
}

/** A question's placeholder: a FILLS name, or a card's question by its action and field, "#2" for its second answer. */
const PLACEHOLDER = /\{([a-z_]+(?:\.[a-z_]+#[a-z_]+(?:#\d)?)?)\}/g;

/** The placeholders a case needs filled: those in its question, then its `given`, each once. */
function placeholdersOf(kase) {
  const named = [...String(kase.question || "").matchAll(PLACEHOLDER)].map((m) => m[1]);
  return [...new Set([...named, ...(kase.given || [])])];
}

/** A card placeholder's action, field and which answer (1, or 2 with "#2"); null for a FILLS name. */
function cardPlaceholder(name) {
  const m = /^([a-z_]+\.[a-z_]+)#([a-z_]+)(?:#(\d))?$/.exec(name);
  return m ? { key: m[1], field: m[2], n: m[3] ? Number(m[3]) : 1 } : null;
}

const one = async (pool, sql, params) => ((await pool.query(sql, params)).rows[0] || {}).words || null;
/** The last two months, as their first days and as a person reads them. */
const recentMonths = (today) => [1, 2].map((n) => {
  const first = require("../../src/shared/time/lagos").addMonths(`${today.slice(0, 7)}-01`, -n);
  return { first, words: require("../../src/shared/time/day-first").formatMonth(first) };
});
/** The first recent month with no review round, and its quarter's name. */
async function freeMonth(pool) {
  const lagos = require("../../src/shared/time/lagos");
  for (const m of recentMonths(lagos.today())) {
    const taken = await pool.query("SELECT 1 FROM performance_cycle WHERE starts_on = $1::date LIMIT 1", [m.first]);
    if (taken.rows.length) continue;
    const quarter = await one(pool, "SELECT name AS words FROM performance_period WHERE starts_on <= $1::date AND ends_on >= $1::date LIMIT 1", [m.first]);
    if (quarter) return { month: m.words, quarter };
  }
  return null;
}

/**
 * What a question names that no card's own question offers, read from staging as the person asking
 * holds it; `what` says what staging lacks when it has none.
 */
const FILLS = Object.freeze({
  person: {
    what: "colleague",
    // Someone in their reach: their own report, else their department, else the first by name.
    find: (pool, actor) =>
      one(
        pool,
        `SELECT btrim(e.first_name || ' ' || e.last_name) AS words FROM employee e
          WHERE e.status = 'active' AND e.employee_id IS DISTINCT FROM $1
          ORDER BY (e.line_manager_id = $1) DESC NULLS LAST,
                   (e.department_id = (SELECT department_id FROM employee WHERE employee_id = $1)) DESC NULLS LAST,
                   e.last_name, e.first_name
          LIMIT 1`,
        [actor.employee_id],
      ),
  },
  colleague: {
    what: "colleague who does not report to them",
    find: (pool, actor) =>
      one(
        pool,
        `SELECT btrim(first_name || ' ' || last_name) AS words FROM employee
          WHERE status = 'active' AND employee_id IS DISTINCT FROM $1 AND line_manager_id IS DISTINCT FROM $1
          ORDER BY last_name, first_name LIMIT 1`,
        [actor.employee_id],
      ),
  },
  own_project: {
    what: "open project they own",
    find: (pool, actor) => one(pool, "SELECT name AS words FROM project WHERE owner_employee_id = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1", [actor.employee_id]),
  },
  stepped_task: {
    what: "open task of theirs with a step to do",
    find: (pool, actor) =>
      one(
        pool,
        `SELECT btrim(COALESCE(t.number::text, '') || ' ' || t.title) AS words FROM task t
          WHERE t.primary_assignee_id = $1 AND t.status NOT IN ('done', 'cancelled') AND t.archived_at IS NULL
            AND EXISTS (SELECT 1 FROM task_step st WHERE st.task_id = t.task_id AND st.done_at IS NULL)
          ORDER BY t.updated_at DESC LIMIT 1`,
        [actor.employee_id],
      ),
  },
  open_role: {
    what: "open role",
    find: (pool) => one(pool, "SELECT title AS words FROM org_seat WHERE status = 'vacant' ORDER BY created_at LIMIT 1", []),
  },
  message_channel: {
    what: "channel with a message of theirs",
    find: (pool, actor) =>
      one(
        pool,
        `SELECT '#' || c.name AS words FROM community_message x
           JOIN community_channel c ON c.community_channel_id = x.community_channel_id
          WHERE x.sender_user_id = $1 AND x.deleted_at IS NULL AND x.message_type IN ('text', 'poll')
            AND c.channel_type <> 'direct' AND c.archived_at IS NULL
          ORDER BY x.sent_at DESC LIMIT 1`,
        [actor.user_id],
      ),
  },
  free_month: { what: "recent month with no review round", find: async (pool) => ((await freeMonth(pool)) || {}).month || null },
  free_month_quarter: { what: "quarter for a recent month with no review round", find: async (pool) => ((await freeMonth(pool)) || {}).quarter || null },
  waiting_leave: {
    what: "leave request waiting on them",
    find: async (_pool, actor) => {
      const waiting = await require("../../src/modules/workflow/workflow.service").mine(actor, { page: 1 });
      return waiting.data.some((r) => r.definition_key === "leave.approval") ? "yes" : null;
    },
  },
  waiting_requisition: {
    what: "requisition waiting on the CEO",
    find: async (_pool, actor) => {
      const waiting = await require("../../src/modules/workflow/workflow.service").mine(actor, { page: 1 });
      return waiting.data.some((r) => r.definition_key === "expenses.requisition") ? "yes" : null;
    },
  },
});

/** The answer a card's own question offers this person for a field (decision 34): the nth, as they would tap it. */
async function cardAnswer(pool, actor, { key, field, n }, values) {
  const registry = require("../../src/shared/ai/registry");
  const authorise = require("../../src/shared/ai/authorise");
  const lagos = require("../../src/shared/time/lagos");
  const action = registry.action(key);
  const entry = action && (action.asks || []).find((q) => q.field === field);
  if (!entry) return null;
  const who = await authorise.scopedFor(actor, action);
  if (!who) return null;
  const today = lagos.today();
  const listed = entry.read
    ? await require("../../src/services/ai/assistant/answer").recordChoices(pool, actor, entry)
    : typeof entry.options === "function"
      ? await entry.options({ actor: who, db: pool, today, values })
      : typeof entry.choices === "function"
        ? entry.choices({ today })
        : entry.choices || [];
  const answers = [...new Set((listed || []).map((x) => String(x).trim()).filter(Boolean))];
  return answers[n - 1] || null;
}

/**
 * A case's question with its placeholders filled for the person asking, or what staging lacks. A
 * card's answers are found in its asks' order, each handed the answers before it (a review's line).
 */
async function fill(pool, kase, actor) {
  const registry = require("../../src/shared/ai/registry");
  const rank = (name) => {
    const card = cardPlaceholder(name);
    const action = card && registry.action(card.key);
    return action ? action.asks.findIndex((q) => q.field === card.field) : -1;
  };
  const words = {};
  const values = {};
  for (const name of [...placeholdersOf(kase)].sort((x, y) => rank(x) - rank(y))) {
    const card = cardPlaceholder(name);
    const got = card ? await cardAnswer(pool, actor, card, values[card.key] || {}) : FILLS[name] ? await FILLS[name].find(pool, actor) : null;
    if (!got) return { missing: card ? `answer to ${card.key}'s ${card.field} question${card.n > 1 ? ` (${card.n} of them)` : ""}` : FILLS[name] ? FILLS[name].what : name };
    if (card) (values[card.key] ||= {})[card.field] = got;
    words[name] = got;
  }
  return { question: String(kase.question).replace(PLACEHOLDER, (all, name) => words[name] ?? all) };
}

/**
 * One question's grade.
 * @param {object} kase  a CASES entry
 * @param {{reads: Array<{key: string, ok: boolean, rows: unknown[], module?: string|null}>, shown: {declined: string|null, link: {path: string}|null}}} got
 * @returns {{pass: boolean, problems: string[]}}
 */
function grade(kase, got) {
  const problems = [];
  const returned = got.reads.filter((r) => r.ok);
  if (kase.reads && !returned.some((r) => kase.reads.includes(r.key)))
    problems.push(`ran none of ${kase.reads.join(", ")} (ran: ${got.reads.map((r) => r.key).join(", ") || "nothing"})`);
  if (kase.needs && !returned.some((r) => r.module === kase.needs))
    problems.push(`read nothing from ${kase.needs} (ran: ${got.reads.map((r) => r.key).join(", ") || "nothing"})`);
  for (const key of kase.never || [])
    if (returned.some((r) => r.key === key && r.rows.length)) problems.push(`${key} returned rows to someone who may not see them`);
  if (kase.route) {
    const screen = screenOf(got.shown.link && got.shown.link.path);
    if (got.shown.declined !== "change") problems.push(`declined is ${got.shown.declined}, not change`);
    if (screen !== kase.route) problems.push(`offered ${screen || "no screen"}, not ${kase.route}`);
  }
  if (kase.action) {
    const card = got.card || null;
    if (!card) problems.push(`drew no card; expected ${kase.action}`);
    else if (card.row.action_key !== kase.action) problems.push(`drew ${card.row.action_key}, not ${kase.action}`);
    else {
      // A field the case lets the person pick (a typed address, decision 37) may wait on Pick one alone.
      const left = Object.entries(card.row.problems || {}).filter(([field, said]) => !((kase.picks || []).includes(field) && (said || []).every((m) => m === "Pick one")));
      const written = (field) => (card.row.values && card.row.values[field] !== undefined ? [`written ${JSON.stringify(card.row.values[field])}`] : []);
      if (left.length) problems.push(`the card has problems on ${left.map(([field, said]) => `${field} (${[...(said || []), ...written(field)].join("; ")})`).join(", ")}`);
    }
  }
  if (kase.no_action && got.card && kase.no_action.includes(got.card.row.action_key)) problems.push(`drew ${got.card.row.action_key} for someone who may not make that change`);
  if (kase.ask) {
    const asked = got.ask || null;
    if (got.card) problems.push(`drew ${got.card.row.action_key} instead of asking for ${kase.ask.field}`);
    else if (!asked || asked.action !== kase.ask.action || asked.field !== kase.ask.field)
      problems.push(`asked ${asked && asked.field ? `for ${asked.action} ${asked.field}` : "nothing"}; expected ${kase.ask.action} ${kase.ask.field}`);
    else if (kase.choices && !asked.choices.length) problems.push(`asked for ${asked.field} with no answers to tap`);
  }
  if (kase.table === "names") {
    const t = got.shown.table;
    if (!t || !t.rows.length) problems.push("drew no table");
    else if (t.rows.some((r) => !String(r[0] || "").trim())) problems.push(`its first column, ${t.columns[0]}, does not name every row`);
  }
  return { pass: problems.length === 0, problems };
}

/** A case waits on a module none of whose reads is declared yet. */
const waiting = (kase, registry) => Boolean(kase.needs) && !registry.reads().some((r) => r.module === kase.needs);

async function main(argv) {
  const flag = (name) => argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  const only = (flag("only") || "").split("=")[1] || "";
  const asJson = Boolean(flag("json"));
  const cases = CASES.filter((k) => k.id.startsWith(only));

  if (flag("list")) {
    for (const k of cases) process.stdout.write(`${k.id.padEnd(24)} ${k.as.padEnd(18)} ${k.question}\n`);
    return 0;
  }

  const { config } = require("../../src/config/env");
  if (config.APP_ENV === "production") {
    process.stderr.write("eval-assistant: refused on production; run it on staging.\n");
    return 2;
  }
  const { pool } = require("../../src/config/db");
  const registry = require("../../src/shared/ai/registry");
  const grantsCache = require("../../src/shared/rbac/grants-cache");
  const orchestrator = require("../../src/services/ai/assistant/orchestrator");
  const answer = require("../../src/services/ai/assistant/answer");

  const people = new Map();
  async function personFor(role) {
    if (people.has(role)) return people.get(role);
    const { rows } =
      role === "ceo"
        ? await pool.query("SELECT user_id FROM app_user WHERE is_ceo AND status = 'active'")
        : await pool.query(
            `SELECT u.user_id
               FROM app_user u
               JOIN user_role ur ON ur.user_id = u.user_id AND ur.effective_from <= CURRENT_DATE
                AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)
               JOIN role r ON r.role_id = ur.role_id AND r.code = $1 AND r.active
              WHERE u.status = 'active' AND NOT u.is_ceo
                AND ($1 <> 'employee' OR NOT EXISTS (
                      SELECT 1 FROM user_role o JOIN role ro ON ro.role_id = o.role_id
                       WHERE o.user_id = u.user_id AND ro.code <> 'employee'
                         AND (o.effective_to IS NULL OR o.effective_to > CURRENT_DATE)))
              -- The holder with the most open work, so the questions about their tasks find some.
              ORDER BY (SELECT count(*) FROM task t WHERE t.primary_assignee_id = u.employee_id
                          AND t.status NOT IN ('done', 'cancelled') AND t.archived_at IS NULL) DESC, u.email
              LIMIT 1`,
            [role],
          );
    const user = rows[0] ? await grantsCache.getAuthUser(pool, rows[0].user_id) : null;
    const actor = user && { user_id: user.user_id, employee_id: user.employee_id, email: user.email, display_name: user.display_name, role_ids: user.role_ids || [], is_ceo: user.is_ceo === true };
    people.set(role, actor);
    return actor;
  }

  let failed = 0;
  let exit = 0;
  try {
    for (const kase of cases) {
      if (waiting(kase, registry)) {
        report({ id: kase.id, result: "skip", why: `waits on ${kase.needs}'s reads` });
        continue;
      }
      const actor = await personFor(kase.as);
      if (!actor) {
        report({ id: kase.id, result: "cannot run", why: `nobody active holds ${kase.as}` });
        exit = 2;
        continue;
      }
      // The question about their own records; one staging has nothing for is skipped, saying what it lacks.
      const filled = await fill(pool, kase, actor);
      if (filled.missing) {
        report({ id: kase.id, result: "skip", why: `staging offers no ${filled.missing} for ${kase.as}` });
        continue;
      }
      const question = filled.question;
      let out;
      try {
        out = await orchestrator.answer({ db: pool, actor, question, shows: kase.shows || [] });
      } catch (err) {
        report({ id: kase.id, result: "cannot run", why: `${err.code || "error"}: ${err.message}` });
        exit = 2;
        if (["AI_DISABLED", "AI_MODULE_DISABLED", "AI_CAP_REACHED"].includes(err.code)) break;
        continue;
      }
      if (out.stub) {
        report({ id: kase.id, result: "cannot run", why: "only the stub answered: set up a provider in AI Control" });
        exit = 2;
        break;
      }
      // As Ask does it: a card its action cannot be drawn without becomes that question first (decision 29).
      const draft = await answer.withOptions(answer.askFirst({ draft: out.draft, actions: out.actions, history: [], shows: kase.shows || [] }), out.actions, { actor, db: pool });
      const shown = answer.build({ draft, reads: out.reads, routes: out.routes, screens: out.screens, shows: kase.shows || [] });
      // A card is drafted and checked, never stored: nothing is written by an evaluation.
      const card = kase.action || kase.no_action || kase.ask ? await answer.draftCard({ draft, actions: out.actions, actor, db: pool }) : null;
      const g = grade(kase, { reads: out.reads, shown, card, ask: answer.askOf(draft.ask) });
      if (!g.pass) failed += 1;
      report({
        id: kase.id,
        result: g.pass ? "pass" : "fail",
        as: kase.as,
        question,
        reads: out.reads.map((r) => `${r.key}${r.ok ? ` ${r.rows.length}` : r.declined ? " refused" : " failed"}`),
        declined: shown.declined,
        link: shown.link && shown.link.path,
        answer: shown.content.slice(0, 200),
        problems: g.problems,
        run_id: out.run_id,
      });
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
  return exit || (failed ? 1 : 0);

  function report(r) {
    if (asJson) return void process.stdout.write(`${JSON.stringify(r)}\n`);
    process.stdout.write(`${r.result.toUpperCase().padEnd(10)} ${r.id}${r.why ? `  (${r.why})` : ""}\n`);
    if (r.question) process.stdout.write(`           ${r.as}: ${r.question}\n           reads: ${r.reads.join(", ") || "none"}\n           ${r.answer}\n`);
    for (const p of r.problems || []) process.stdout.write(`           ✗ ${p}\n`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`eval-assistant: ${err.stack || err.message}\n`);
      process.exit(2);
    },
  );
}

module.exports = { CASES, FILLS, grade, screenOf, waiting, placeholdersOf, cardPlaceholder, fill };

"use strict";
/**
 * Try Asking (docs/guides/praxis-ai.md §6.8): one example question per read, offered only when
 * the person may run that read, so nobody is shown a question about people they cannot see. A
 * read every login may run but that answers only for holders of a capability (the Team tab's
 * roster, the alerts one may clear) names it, and its question waits for it too. In the order
 * they are most useful.
 *
 * Beside them, one chart question for each area a summary answers (CHARTS, Appendix B PR 8), each
 * naming its summary and offered only when the person is offered that summary. Of the six shown, the
 * first four are the questions their reads allow, then the first two charts their summaries allow,
 * and the rest of the six from whichever list has more.
 */
const QUESTIONS = Object.freeze([
  ["team.today", "Who is in today, and who is late?", "home.team"],
  ["activity.list", "What happened today?"],
  ["approvals.mine", "What is waiting on my approval?"],
  ["leave.requests", "Which leave requests are waiting?"],
  ["attendance.exceptions", "Who came in late this week?"],
  ["my_leave.balances", "How many leave days do I have left?"],
  ["tasks.list", "Which of my tasks are overdue?"],
  ["attendance.my_days", "Was I late at all this month?"],
  ["policies.mine", "Which policies do I still need to acknowledge?"],
  ["alerts.mine", "Which alerts are open right now?", "alerts.clear"],
  ["holidays.list", "When is the next public holiday?"],
  ["calendar.month", "What is on my calendar this week?"],
  ["announcements.list", "What was announced this week?"],
  ["employees.list", "Who joined us this month?"],
]);

/**
 * A chart for each area, by its summary, most useful first: People, Workspace, My Leave, Finance, Pay,
 * Recruitment, Partnerships, Performance, Queries, Knowledge Hub, Staff Community, Home and Settings.
 * A summary that answers only the holders of a capability names it (policies, alerts, report files).
 */
const CHARTS = Object.freeze([
  ["attendance.summary", "Chart lateness by department this month"],
  ["tasks.summary", "Chart my tasks by status"],
  ["my_leave.summary", "Show my leave this year by type as a chart"],
  ["expenses.summary", "Chart our expense requests by category"],
  ["my_pay.summary", "Chart my pay this year month by month"],
  ["candidates.summary", "Chart our candidates by stage"],
  ["leads.summary", "Chart our leads by stage"],
  ["kpis.summary", "Chart our KPIs by function: met and not met"],
  ["queries.summary", "Chart our queries by department"],
  ["training.summary", "Chart training by course: completed and overdue"],
  ["policies.summary", "Chart who has acknowledged each policy", "policies.manage"],
  ["projects.summary", "Chart our projects: done, open and overdue tasks"],
  ["announcements.summary", "Chart the latest announcements: read and not read"],
  ["activity.summary", "Chart today's activity by hour"],
  ["alerts.summary", "Chart open alerts by category and severity", "alerts.clear"],
  ["imports.summary", "Chart our imports by importer"],
]);

const SHOWN = 6;
/** How many of the six are the reads' questions while charts remain; the rest are charts. */
const PLAIN = 4;

/**
 * @param {Array<{key: string}>} reads  the reads this person may run (authorise.allowedReads)
 * @param {{capabilities?: string[], is_ceo?: boolean}} [holds]  the capabilities they hold; the CEO holds every one
 * @param {Array<{key: string}>} [summaries]  the summaries this person may run (authorise.allowedSummaries)
 * @returns {string[]}
 */
function forReads(reads, { capabilities = [], is_ceo: ceo = false } = {}, summaries = []) {
  const held = new Set(capabilities);
  const may = (allowed) => ([key, , capability]) => allowed.has(key) && (!capability || ceo || held.has(capability));
  const plain = QUESTIONS.filter(may(new Set(reads.map((r) => r.key)))).map(([, question]) => question);
  const charts = CHARTS.filter(may(new Set(summaries.map((s) => s.key)))).map(([, question]) => question);
  const first = plain.slice(0, Math.max(PLAIN, SHOWN - charts.length));
  return [...first, ...charts.slice(0, SHOWN - first.length)];
}

module.exports = { QUESTIONS, CHARTS, SHOWN, forReads };

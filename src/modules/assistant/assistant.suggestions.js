"use strict";
/**
 * Try Asking (docs/guides/praxis-ai.md §6.8): one example question per read, offered only when
 * the person may run that read, so nobody is shown a question about people they cannot see. A
 * read every login may run but that answers only for holders of a capability (the Team tab's
 * roster, the alerts one may clear) names it, and its question waits for it too. In the order
 * they are most useful; the first six a person's reads allow are shown.
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

const SHOWN = 6;

/**
 * @param {Array<{key: string}>} reads  the reads this person may run (authorise.allowedReads)
 * @param {{capabilities?: string[], is_ceo?: boolean}} [holds]  the capabilities they hold; the CEO holds every one
 * @returns {string[]}
 */
function forReads(reads, { capabilities = [], is_ceo: ceo = false } = {}) {
  const allowed = new Set(reads.map((r) => r.key));
  const held = new Set(capabilities);
  return QUESTIONS.filter(([key, , capability]) => allowed.has(key) && (!capability || ceo || held.has(capability)))
    .slice(0, SHOWN)
    .map(([, question]) => question);
}

module.exports = { QUESTIONS, SHOWN, forReads };

"use strict";
/**
 * Today: the reader's day on one screen (docs/guides/workspace.md §2, §6).
 *
 *   due_today, overdue, in_review, done_this_week   the four figures, the reader's own
 *   my_day          their open tasks due today or overdue, overdue first
 *   set_by_manager  their open tasks someone else set, soonest due first
 *   diary           today's entries on their calendar
 *   since           what other people did to their tasks since the start of the
 *                   previous working day, newest first
 * Each list is its first page of 25 with its total; Tasks and the Calendar hold the rest.
 */
const { pool } = require("../../config/db");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const tasks = require("../tasks/tasks.service");
const tasksRepo = require("../tasks/tasks.repo");
const calendar = require("../calendar/calendar.service");

const first = (page) => ({ data: page.data, total: page.page.total });

/** The start of the working day before today, as an instant. */
function sinceOf(day, cal) {
  let d = lagos.addDays(day, -1);
  for (let i = 0; i < 14 && !workingWeek.isWorkingDay(d, cal); i += 1) d = lagos.addDays(d, -1);
  return lagos.instant(d);
}

/**
 * @param {{user_id: string, employee_id: string}} user
 * @param {{scope: string, scope_ids: string[]|null, employee_id: string}} scope
 */
async function today(user, scope, now = new Date()) {
  const day = lagos.today(now);
  const cal = await workingWeek.loadCalendar(pool);
  const at = tasks.windows(now);
  const mine = { ...scope, employee_id: user.employee_id };
  const own = { scope: "mine", assignee_id: user.employee_id };

  const [summary, dueToday, overdue, inReview, setByOthers, diary, since] = await Promise.all([
    tasksRepo.summary(pool, "mine", mine, at),
    tasks.list({ ...own, due: "today", sort: { field: "due_at", dir: "asc" }, page: 1 }, mine),
    tasks.list({ ...own, due: "overdue", sort: { field: "due_at", dir: "asc" }, page: 1 }, mine),
    tasks.list({ ...own, status: "in_review", page: 1 }, mine),
    tasks.list({ ...own, sort: { field: "due_at", dir: "asc" }, page: 1 }, mine),
    calendar.month(user.employee_id, { month: day.slice(0, 7), page: 1, sort: { field: "starts_at", dir: "asc" } }),
    tasksRepo.activitySince(pool, user.employee_id, user.user_id, sinceOf(day, cal)),
  ]);

  const seen = new Set();
  const myDay = [...overdue.data, ...dueToday.data].filter((t) => {
    if (seen.has(t.task_id) || t.status === "done") return false;
    seen.add(t.task_id);
    return true;
  });
  const fromOthers = setByOthers.data.filter(
    (t) => t.status !== "done" && t.set_by && t.set_by.employee_id !== user.employee_id,
  );
  const start = lagos.instant(day);
  const end = lagos.instant(lagos.addDays(day, 1));
  const todays = diary.data.filter((i) => new Date(i.starts_at) < end && new Date(i.ends_at) > start);

  return {
    date: day,
    due_today: dueToday.page.total,
    overdue: overdue.page.total,
    in_review: inReview.page.total,
    done_this_week: summary.done_this_week,
    my_day: { data: myDay.slice(0, 25), total: overdue.page.total + dueToday.page.total },
    set_by_manager: { data: fromOthers, total: fromOthers.length },
    diary: { data: todays, total: todays.length },
    since: first({
      data: since.data.map((a) => ({
        task_id: a.task_id,
        task_title: a.task_title,
        actor: a.actor,
        kind: a.kind,
        to_status: a.to_status,
        created_at: a.created_at instanceof Date ? a.created_at.toISOString() : a.created_at,
      })),
      page: since.page,
    }),
  };
}

module.exports = { today, sinceOf };

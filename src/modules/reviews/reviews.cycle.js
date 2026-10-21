"use strict";
/**
 * Opening a cycle (docs/guides/performance.md §3 step 8, §6 Who is reviewed): every employee
 * active on the opening day gets a self review, and a manager review by their line manager that
 * day; someone with no line manager is reviewed by the CEO; the CEO, with nobody above, writes
 * only a self review. Running it twice makes nothing twice.
 */
const repo = require("./reviews.repo");

/**
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{performance_cycle_id: string, starts_on: string, ends_on: string}} cycle
 * @param {string} opensOn  YYYY-MM-DD
 * @returns {Promise<number>} the reviews made
 */
async function populate(client, cycle, opensOn) {
  const people = await repo.roster(client, opensOn);
  const ceo = await repo.ceoEmployee(client);
  let made = 0;
  const base = { cycleId: cycle.performance_cycle_id, from: cycle.starts_on, to: cycle.ends_on };
  for (const p of people) {
    if (await repo.ensureReview(client, { ...base, employeeId: p.employee_id, reviewerId: p.employee_id, type: "self" })) made += 1;
    const reviewer = p.manager_id || (p.is_ceo ? null : ceo);
    if (!reviewer || reviewer === p.employee_id) continue;
    if (await repo.ensureReview(client, { ...base, employeeId: p.employee_id, reviewerId: reviewer, type: "manager" })) made += 1;
  }
  return made;
}

module.exports = { populate };

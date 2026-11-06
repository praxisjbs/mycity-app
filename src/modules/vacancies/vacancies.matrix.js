"use strict";
/**
 * Recruitment's scope probes for the access matrix (docs/guides/praxis-ai.md §1.2 decision 26, §6.17;
 * tests/integration/ai-matrix.test.js). Every Recruitment read is scoped by a vacancy's hiring manager
 * (docs/guides/recruitment.md §8), so each probe makes a vacancy managed by the person asking (inside
 * their reach) or by the matrix's outsider (outside it), and what the read lists under it. Records are
 * made through the modules' own services and repos, never by hand.
 *
 *   probeFor(make)   { inside, outside } for a read: `make(vacancy, ctx)` returns the record the read
 *                    must list, as { type, id }
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const numbering = require("../../shared/numbering/numbering");
const lagos = require("../../shared/time/lagos");

const ALL = { scope: "all", scope_ids: null };

const employeeOf = (who) => who.employee_id || (who.user && who.user.employee_id);

/** A remote vacancy (no place to pick) managed by `hiringManagerId`, made and published by `actor`. */
async function vacancyFor(actor, hiringManagerId, title) {
  const service = require("./vacancies.service");
  const { rows } = await pool.query("SELECT department_id FROM department ORDER BY created_at, department_id LIMIT 1");
  // A hiring manager must hold `recruitment` (guide §6.1), and the matrix's outsider holds nothing: the
  // role is made under the asker, who reads Recruitment, then handed to whoever the probe names.
  const own = employeeOf(actor);
  const v = await service.create(actor, ALL, {
    title,
    department_id: rows[0].department_id,
    hiring_manager_id: own || hiringManagerId,
    positions: 1,
    employment_type: "full_time",
    work_pattern: "remote",
    description: `${title}: a role made by the access matrix to check who may read it, with enough words to publish it.`,
    requirements: "Made by the access matrix to test scope.",
    closes_on: lagos.addDays(lagos.today(), 30),
    publish: true,
  });
  if (hiringManagerId && hiringManagerId !== v.hiring_manager?.employee_id)
    await pool.query("UPDATE vacancy SET hiring_manager_id = $2 WHERE vacancy_id = $1", [v.vacancy_id, hiringManagerId]);
  return { ...v, hiring_manager_id: hiringManagerId };
}

/** An application to `vacancy` from an invented candidate, through the candidates repo. */
async function applicationFor(vacancy, tag) {
  const repo = require("../candidates/candidates.repo");
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const candidateId = await repo.insertCandidate(client, {
        first_name: "Matrix",
        last_name: tag,
        email: `matrix-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}@example.test`,
      });
      const { number } = await numbering.allocate(client, "application");
      const made = await repo.insertApplication(client, {
        number,
        vacancy_id: vacancy.vacancy_id,
        candidate_id: candidateId,
        source: "careers",
        cover_letter: null,
        cv_document_id: null,
        answers: {},
        years_experience: 2,
        consented_at: new Date(),
        provisional_score: 50,
      });
      return { application_id: made.application_id, number, candidate_id: candidateId };
    });
  } finally {
    client.release();
  }
}

/** One switched-on assessment for the whole run, made through the library's own functions. */
let assessment = null;
function assessmentFor(actor) {
  if (!assessment) {
    const authoring = require("../assessments/assessments.authoring");
    assessment = (async () => {
      const made = await authoring.create(actor, {
        name: "Matrix Assessment",
        assessment_type: "technical",
        duration_minutes: 30,
        instructions: "Made by the access matrix to check who may read a sitting.",
      });
      await authoring.saveQuestions(actor, made.assessment_definition_id, {
        questions: [{ question_type: "text", prompt: "Say anything at all here.", max_score: 5 }],
      });
      await authoring.activate(actor, made.assessment_definition_id);
      return made.assessment_definition_id;
    })();
  }
  return assessment;
}

/** A sitting of that assessment sent to a new application to `vacancy`, through the sittings service. */
async function sittingFor(vacancy, ctx) {
  const service = require("../assessments/assessments.service");
  const a = await applicationFor(vacancy, `Sitting ${ctx.role}`);
  const sent = await service.send(ctx.actor, ALL, {
    application_id: a.application_id,
    assessment_definition_id: await assessmentFor(ctx.actor),
    start_within_days: 3,
  });
  return { sitting: sent, application: a };
}


/** { inside, outside } for a Recruitment read. */
function probeFor(make) {
  return {
    inside: async (ctx) => make(await vacancyFor(ctx.actor, employeeOf(ctx.actor), `Matrix Role of ${ctx.role}`), ctx),
    outside: async (ctx) => make(await vacancyFor(ctx.actor, employeeOf(ctx.outsider), `Outsider Role seen by ${ctx.role}`), ctx),
  };
}

module.exports = { probeFor, vacancyFor, applicationFor, sittingFor };

"use strict";
/**
 * ESS · My Performance: the caller's quarter, their check-in and their reviews
 * (docs/guides/performance.md §3.3, §5, §10; docs/guides/ess.md §5).
 *
 * Everything here is the caller's own record, taken from the session (meOf), never from the
 * request. The check-in is the reviews module's: this file is its door from Self-Service, so the
 * employee fills, dictates, evidences and submits their own and nothing else. The reviewer's scores,
 * comments and actions reach them only once their review is closed (reviews.sequence.js).
 */
const reviews = require("../reviews/reviews.service");
const dictation = require("../reviews/reviews.dictation");
const { meOf } = require("./ess.documents");

/** The caller, checked to be an employee. */
const me = (user) => {
  meOf(user);
  return user;
};

const overview = (user) => reviews.myPerformance(me(user));

const checkIn = (user) => reviews.myCheckIn(me(user));

const saveCheckIn = (user, body) => reviews.saveCheckIn(me(user), body);

const submitCheckIn = (user) => reviews.submitCheckIn(me(user));

const dictate = (user, body, file) => dictation.dictateCheckIn(me(user), body, file);

const addEvidence = (user, file, body) => reviews.addEvidence(me(user), file, body);

const myReviews = (user, query) => reviews.myReviews(me(user), query);

module.exports = { overview, checkIn, saveCheckIn, submitCheckIn, dictate, addEvidence, myReviews };

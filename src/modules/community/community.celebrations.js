"use strict";
/**
 * Celebrations (MILESTONES A20): each morning at 05:00 Lagos the scheduler posts one card
 * to #general for every active employee whose birthday or start-date anniversary is that
 * day, read from the employee record. Nothing is entered in Community for it.
 *
 * The card's line is rotated from a fixed list, picked by the person and the year, so a
 * colleague is not wished the same words two years running.
 */
const { pick } = require("./community.recognition");

const BIRTHDAY = [
  "Wishing you a year of good work and better rest.",
  "Here is to another year around the sun, from all of us.",
  "May the year ahead be your best one yet.",
  "Today is yours. Enjoy every minute of it.",
];
const ANNIVERSARY = [
  "Thank you for every one of them.",
  "Here is to the next one.",
  "The work shows. Thank you.",
];

function wishFor(employeeId, occasion, year = new Date().getUTCFullYear()) {
  return pick(
    `${employeeId}:${year}`,
    occasion === "anniversary" ? ANNIVERSARY : BIRTHDAY,
  );
}

module.exports = { BIRTHDAY, ANNIVERSARY, wishFor };

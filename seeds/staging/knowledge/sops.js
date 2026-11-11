"use strict";
/**
 * The staging seed's SOPs (90_knowledge.js; docs/guides/knowledge.md §6.2, §6.3): two for each of
 * MyCity's five departments, as their heads would write them for MyCity's work: listing places,
 * events and things to do across Nigeria's cities, with the businesses behind them. A step that
 * names a screen links it, so the procedure is listed under Procedures on that screen's section of
 * the User Guide.
 *
 * Each SOP is { department, title, purpose, scope, roles, steps: [{ text, who, screen }] } and,
 * for one, `next`: the changes and the note of its Version 2, so Versions has history to show.
 * The departments are named as seeds/staff/nomenclature.json names them.
 */

const step = (text, who = null, screen = null) => ({ text, who, screen });

const SOPS = Object.freeze([
  /* General Management */
  {
    department: "General Management",
    title: "Monthly Management Review",
    purpose:
      "Review how each department did in the month against its goals, agree what changes next month, and give every decision one owner and a date.",
    scope: "The Chief Executive Officer, the Program Manager and every head of department, in the first week of each month, for the month just ended.",
    roles: ["Chief Executive Officer", "Program Manager", "Head of Department"],
    steps: [
      step("Report your department's month against its goals by the third working day of the new month.", "Head of Department", "performance/goals"),
      step("Collect the reports and the month's scorecards, and list every goal that is off track.", "Program Manager", "performance/analytics"),
      step("Check each department's spend for the month against its budget, and note anything over.", "Program Manager", "expenses/budgets"),
      step("Book the review and send the heads the list and the reports two working days before it.", "Program Manager", "workspace/calendar"),
      step("Hold the review: each head takes ten minutes on results, blockers and next month's priorities.", "Chief Executive Officer"),
      step("Agree each decision with one owner and a due date before the meeting closes.", "Chief Executive Officer"),
      step("Set each decision as a task for its owner, due on the agreed date, the same day.", "Program Manager", "workspace/tasks"),
      step("Open the review with the decisions still open from the month before.", "Program Manager"),
    ],
  },
  {
    department: "General Management",
    title: "Company-Wide Announcement",
    purpose:
      "Tell every member of staff about a decision, a change or good news once, in clear words, and in a place they can find it again.",
    scope: "News for the whole company: new partners and cities, changes to how we work, events and holidays. A department's own news stays in its channel.",
    roles: ["Chief Executive Officer", "Program Manager", "Operations & People Lead"],
    steps: [
      step("Write the announcement: what is happening, when, who it affects and what anyone needs to do.", "Program Manager"),
      step("Keep it short and plain, with the date written out in full and no internal jargon.", "Program Manager"),
      step("Get the wording approved before it goes out.", "Chief Executive Officer"),
      step("Post it as an announcement, with the attachment or link it refers to.", "Operations & People Lead", "community/announcements"),
      step("Ask the heads to raise it at their next team meeting and to answer their team's questions.", "Chief Executive Officer"),
      step("Answer questions in the announcement's thread, and post a correction there if anything changes.", "Operations & People Lead"),
    ],
  },

  /* Technology & Back-office Ops */
  {
    department: "Technology & Back-office Ops",
    title: "New Listing Publication",
    purpose:
      "Make sure every place, event or activity we list on MyCityApp is accurate, has permission for its photos and reads well before it goes live.",
    scope: "Every new listing, and any change to a listing's name, address, prices or photos, in every city we cover.",
    roles: ["Content & Listing Associate", "Backend Operations Manager", "Growth Officer"],
    steps: [
      step("Take the listing request from the partner's record, with the growth officer's notes.", "Content & Listing Associate", "partnerships/partners"),
      step("Confirm the name, address, opening hours, prices and contact number with the business itself.", "Content & Listing Associate"),
      step("Use photos the business sent, or took with the owner's permission. Never use pictures from another website.", "Content & Listing Associate"),
      step("Write the description in at most 120 words: what it is, what it is known for and who it suits.", "Content & Listing Associate"),
      step("Pick the category and the area, enter the listing in the content dashboard and save it as a draft.", "Content & Listing Associate"),
      step("Check the draft against the business's details, then approve it or send it back with every fix in one note.", "Backend Operations Manager"),
      step("Publish the listing, then open it in the app on a phone to check it shows correctly.", "Content & Listing Associate"),
      step("Tell the growth officer who brought the business that the listing is live.", "Content & Listing Associate"),
    ],
  },
  {
    department: "Technology & Back-office Ops",
    title: "App Incident Response",
    purpose:
      "Restore MyCityApp quickly when it fails or misbehaves for users, keep everyone told while it is fixed, and learn from every incident.",
    scope: "Any outage, error or data problem in MyCityApp that users or partners notice, at any hour of any day.",
    roles: ["Chief Technology Officer", "Backend Operations Manager", "Content & Listing Associate"],
    steps: [
      step("Report the problem at once in the team's channel: what you saw, where, and when it started.", "Anyone", "community/channels"),
      step("Acknowledge the report within 15 minutes and take charge of the incident.", "Backend Operations Manager"),
      step("Set its severity: High if users cannot open the app, sign in or see listings; Medium if one feature fails; Low for the rest.", "Backend Operations Manager"),
      step("For a High incident, call the Chief Technology Officer and tell Branding & Marketing, so users and partners get one answer.", "Backend Operations Manager"),
      step("Fix it or roll back, and post an update in the channel every 30 minutes until it is resolved.", "Backend Operations Manager"),
      step("If personal data may have been exposed, tell the Chief Executive Officer at once: the company has 72 hours to report a breach to the NDPC.", "Chief Technology Officer"),
      step("Confirm the fix in the app on a phone, then close the incident in the channel.", "Backend Operations Manager"),
      step("Within two working days, write up what happened, why, and what stops it happening again, and set those actions as tasks.", "Chief Technology Officer", "workspace/tasks"),
    ],
  },

  /* Branding & Marketing */
  {
    department: "Branding & Marketing",
    title: "Social Media Post Approval",
    purpose:
      "Keep every post on MyCityApp's and MyLagosApp's social media pages on brand, accurate about the places and events it names, and approved before it goes out.",
    scope: "Every scheduled or live post, story and reel on the company's social media pages, including posts made with partners.",
    roles: ["Social Media Manager", "Graphics Designer", "Head, PR, Marketing & Brand Strategy"],
    steps: [
      step("Plan the next week's posts in the content calendar by Thursday.", "Social Media Manager", "workspace/calendar"),
      step("Write each post's caption and brief the design: the message, the sizes and the deadline.", "Social Media Manager", "workspace/tasks"),
      step("Design the visual in the brand's colours, fonts and logo, and share it for review.", "Graphics Designer"),
      step("Check every name, date, price and venue against the partner or the listing.", "Social Media Manager"),
      step("Approve the post, or send it back once with every change in one note.", "Head, PR, Marketing & Brand Strategy"),
      step("Schedule the approved post, and tag the partner only where they have agreed to it.", "Social Media Manager"),
      step("Answer comments and messages within the working day, and pass complaints to the right team the same day.", "Social Media Manager"),
    ],
  },
  {
    department: "Branding & Marketing",
    title: "Campaign Launch",
    purpose: "Plan, fund and launch a marketing campaign so that it reaches its audience on time and its results can be measured.",
    scope: "Any paid or partner campaign, in one city or many, from the brief to the report after it ends.",
    roles: ["Head, PR, Marketing & Brand Strategy", "PR & Marketing Lead", "Graphics Designer", "Social Media Manager"],
    steps: [
      step("Write the brief: the aim, the audience, the cities, the dates, the message and how success is measured.", "PR & Marketing Lead"),
      step("Agree the brief and its budget.", "Head, PR, Marketing & Brand Strategy"),
      step("Raise the request for the campaign's spend, with the brief attached.", "PR & Marketing Lead", "ess/my-requests"),
      step("Set the campaign's tasks with an owner and a date each: creative, copy, partners, media and launch.", "PR & Marketing Lead", "workspace/tasks"),
      step("Produce the creative and the copy, and approve them as any social media post is approved.", "Graphics Designer"),
      step("Confirm each partner's part in writing, and keep it on the partner's record.", "PR & Marketing Lead", "partnerships/partners"),
      step("Launch on the agreed date, and check that every link and code works.", "Social Media Manager"),
      step("Track results each week while it runs, and move spend away from what is not working.", "PR & Marketing Lead"),
      step("Within a week of the end, report results against the brief's measures and what to do differently.", "PR & Marketing Lead"),
    ],
  },

  /* Partnership & Growth */
  {
    department: "Partnership & Growth",
    title: "Lead Outreach",
    purpose: "Approach new businesses in a way that wins meetings, respects their time and keeps a full record of every contact we make.",
    scope: "Every restaurant, venue, event organiser or other business a growth officer or marketing lead approaches, in any city.",
    roles: ["Growth Officer", "Marketing Lead", "Head, Strategy, Partnerships & Growth"],
    steps: [
      step("Check the business is not already a lead or a partner before you contact it.", "Growth Officer", "partnerships/leads"),
      step("Research it first: its website, social pages and reviews. Note one reason to contact it now.", "Growth Officer"),
      step("Add it as a lead, with its contact person and its first deal at Prospect Identified.", "Growth Officer", "partnerships/leads"),
      step("Send a short, personal first message: who you are, why them, what MyCityApp offers them and one clear ask.", "Growth Officer"),
      step("Follow up a few times over two to three weeks, each time with something new, then pause.", "Growth Officer"),
      step("Log every call, message and meeting on the lead, and move its deal through the stages as it goes.", "Growth Officer", "partnerships/pipeline"),
      step("If the person asks not to be contacted again, stop at once and note it on the lead.", "Growth Officer"),
      step("After the first meeting, send thanks, a short recap and the next step within one working day.", "Growth Officer"),
      step("Send the proposal from the lead's record once the business is ready.", "Marketing Lead", "partnerships/proposals"),
    ],
  },
  {
    department: "Partnership & Growth",
    title: "Partner Onboarding",
    purpose: "Turn a newly signed business into a live, well presented partner on MyCityApp within ten working days of signing.",
    scope: "Every partner from the day its agreement is signed to its first review, 30 days after its listing goes live.",
    roles: ["Growth Officer", "Marketing Lead", "Content & Listing Associate"],
    steps: [
      step("Keep the signed agreement on the partner's record and move the deal to Partnership Signed.", "Growth Officer", "partnerships/contracts-and-mous"),
      step("Send the partner a welcome message the same day, with your contact details and what happens next.", "Growth Officer"),
      step("Collect the business's details, logo, photos and offers for its listing, using its category's checklist.", "Growth Officer", "partnerships/partners"),
      step("Hand the details to Content & Listing to publish the listing.", "Growth Officer"),
      step("Check the live listing with the partner and agree any changes.", "Growth Officer"),
      step("Plan the partner's first promotion with Branding & Marketing.", "Marketing Lead"),
      step("Move the deal to Active Partnership once the listing is live.", "Growth Officer", "partnerships/pipeline"),
      step("Call the partner 30 days after the listing went live to review results, and log the call on their record.", "Growth Officer", "partnerships/partners"),
    ],
  },

  /* People & Culture */
  {
    department: "People & Culture",
    title: "New Employee Onboarding",
    purpose: "Give every new employee a complete record, a working login and what they need to start well on their first day.",
    scope: "Every new employee, from the signed offer to the end of their first month.",
    roles: ["Operations & People Lead", "Line Manager", "Chief Technology Officer"],
    steps: [
      step("Before the first day, add the employee with their job, pay, bank details and next of kin.", "Operations & People Lead", "people/employees"),
      step("Give them a login with the roles their post needs.", "Operations & People Lead", "settings/users"),
      step("Check that the policies that apply to them, and their training, have reached them.", "Operations & People Lead", "knowledge/training"),
      step("Ask the Technology team for their devices and work email in time for the first day.", "Operations & People Lead"),
      step("On the first day, welcome them, register their phone in My Devices and show them how to clock in.", "Line Manager", "ess/my-devices"),
      step("Agree their goals for the first month with them in their first week.", "Line Manager", "ess/my-performance"),
      step("Check in with them after 30 days and note anything they still need.", "Line Manager"),
      step("Confirm they have acknowledged their policies and finished their assigned training.", "Operations & People Lead", "knowledge/training"),
    ],
  },
  {
    department: "People & Culture",
    title: "Leave Request Handling",
    purpose: "Answer every leave request quickly and fairly, keep work covered while people are away, and keep leave records right.",
    scope: "Every kind of leave, for every employee, from the request to their return.",
    roles: ["Employee", "Line Manager", "Operations & People Lead"],
    steps: [
      step("Request leave in My Leave as early as you can, and for annual leave at least five working days before the first day.", "Employee", "ess/my-leave"),
      step("Check who else in the team is away on the same days before you decide.", "Line Manager", "people/leave"),
      step("Approve or reject the request within three working days, with a reason for a rejection.", "Line Manager", "people/leave"),
      step("Agree who covers the person's work while they are away.", "Line Manager"),
      step("After sick leave of more than two days, send a doctor's note to Operations & People.", "Employee"),
      step("Each month, check the leave records and follow up any request still waiting.", "Operations & People Lead", "people/leave"),
    ],
    next: {
      note: "Line managers now answer within two working days, not three, so people can plan sooner.",
      change: [2, "Approve or reject the request within two working days, with a reason for a rejection."],
    },
  },
]);

module.exports = { SOPS };

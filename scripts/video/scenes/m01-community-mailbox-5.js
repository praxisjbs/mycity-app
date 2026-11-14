"use strict";
/**
 * Milestones 0 and 1, part 5 of 5: Staff Community and Mailbox. docs/runbooks/training-videos.md says
 * how a scene is written and filmed, and §8 the plan of the five.
 *
 * MyCity's own people by their real names (an internal video). Aaron Agama, the Social Media Manager,
 * reads and posts in the channels, recognises Precious Iyeserhen, answers her on his phone, connects
 * his mailbox, summarises a thread, replies with Write With AI and schedules a message to Ifeoma
 * Mbonu. Cynthia Osakunih, Operations & People, starts a poll and publishes an announcement.
 *
 * `prepare` is the ground, run once after parts 1 to 3 on the same development database: a few days
 * of ordinary posts in #general, the Brand Team channel Chinyere Elechi starts, a message from
 * Precious, and the mail waiting in Aaron's mailbox, delivered to the filming machine's own mail
 * server (runbook §1.8), never anywhere else. Every post goes through Staff Community's own service;
 * only its time is moved back, on the filming database, so the history reads as days, not seconds.
 * The words are written for the video. The two AI answers are the filming stand-in's (runbook §6.30):
 * their words are written here, the screens that show them are the hub's own.
 */
const fs = require("node:fs");
const path = require("node:path");
const h = require("../helpers");

const src = (p) => require(path.join(__dirname, "..", "..", "..", "src", p));

const CHANNELS = "/community?tab=channels";
const DIRECT = "/community?tab=direct-messages";
const ANNOUNCE = "/community?tab=announcements";
const INBOX = "/mailbox?tab=inbox";

/** Posts in #general, by post (never a name), each `at` [days before the prepare runs, Lagos time]. */
const GENERAL = Object.freeze([
  { post: "Chief Executive Officer", at: [3, "08:47"], body: "Good morning, team. The hub is live. Please set your password and ask here if anything is unclear." },
  { post: "Operations & People Lead", at: [3, "09:12"], body: "Leave requests now go through Self-Service, on My Leave. Your manager is told at once." },
  { post: "Content & Listing Associate", at: [2, "11:05"], body: "The listing team has cleared the backlog of partner updates. Thank you all for the quick replies." },
  { post: "Marketing Lead - Abuja", at: [1, "16:40"], body: "Abuja team: venue photos for the December calendar are in the shared drive." },
  { post: "Program Manager", at: [0, "08:52"], body: "Morning all. Remember to clock in from your phone when you arrive." },
]);

/** The Brand Team channel Chinyere starts, its people by post, and its first posts. */
const BRAND = Object.freeze({
  name: "Brand Team",
  description: "Briefs and approvals for social and design.",
  owner: "Head, PR, Marketing & Brand Strategy",
  members: ["Social Media Manager", "Graphics Designer", "Graphics Associate", "PR & Marketing Lead - MyLagosApp"],
  posts: [
    { post: "Head, PR, Marketing & Brand Strategy", at: [2, "10:20"], body: "Welcome to the Brand Team channel. Briefs and approvals for social and design go here." },
    { post: "Graphics Designer", at: [1, "15:30"], body: "The Lagos poster set is with Aaron for a copy check." },
    { post: "Graphics Associate", at: [0, "10:15"], body: "Story templates for the weekend are ready in the shared drive." },
  ],
});

/** Mail waiting in Aaron's inbox: the poster thread is the one he summarises and answers. */
const MAIL = Object.freeze([
  {
    from: "Operations & People Lead",
    at: [3, "09:30"],
    subject: "Your first week on the hub",
    text: "Hi Aaron,\n\nWelcome to the hub. Your record, leave and payslips are all in Employee Self-Service now, and the User Guide in the Knowledge Hub shows every step.\n\nAsk me if anything looks wrong on your record.\n\nCynthia",
  },
  {
    from: "Graphics Designer",
    cc: ["Marketing Lead - Abuja"],
    at: [3, "11:40"],
    subject: "Detty December poster set",
    id: "posters-1",
    text: "Hi Aaron,\n\nThe Detty December poster set for Lagos is ready: six posters for the calendar's first two weekends, sized for the Instagram feed and stories. They are in the shared drive under Posters, December.\n\nCan you check the copy before Thursday, so they can go into next week's schedule?\n\nPrecious",
  },
  {
    from: "Marketing Lead - Abuja",
    to: ["Graphics Designer"],
    ccAaron: true,
    at: [2, "10:05"],
    subject: "Re: Detty December poster set",
    replyTo: "posters-1",
    id: "posters-2",
    text: "These look great. Could we have Abuja versions too? Same layout, with the Abuja venues and the Jabi Lake pop-up on the 13th. Friday would work for us.\n\nTochukwu",
  },
  {
    from: "Graphics Designer",
    cc: ["Marketing Lead - Abuja"],
    at: [1, "14:25"],
    subject: "Re: Detty December poster set",
    replyTo: "posters-2",
    id: "posters-3",
    text: "Abuja versions are doable by Friday if Aaron signs off the Lagos copy first, since the Abuja set reuses it.\n\nAaron, could you confirm by Wednesday?\n\nPrecious",
  },
  {
    from: "Chief Executive Officer",
    at: [1, "16:10"],
    subject: "December social calendar",
    text: "Aaron,\n\nPlease send me the December posting schedule when it is ready, so we can go through it together.\n\nIfeoma",
  },
  {
    external: { name: "Tolu Bankole", email: "tolu@eventsng.example" },
    at: [0, "09:20"],
    subject: "Listing for our food festival",
    text: "Hello,\n\nWe would like our December food festival listed on MyCityApp. Who should we send the details to?\n\nTolu Bankole",
  },
]);

/** The two answers the filming stand-in gives (runbook §6.30), from the thread above. */
const REPLIES = Object.freeze([
  {
    match: "gist",
    delay: 2.5,
    reply: {
      gist: "Precious has finished the six Lagos Detty December posters, and Tochukwu has asked for Abuja versions.",
      key_points: [
        "The six Lagos posters are sized for the Instagram feed and stories, in the shared drive under Posters, December.",
        "Tochukwu wants Abuja versions with the Jabi Lake pop-up on the 13th, by Friday.",
        "The Abuja set reuses the Lagos copy, so it waits on the Lagos sign-off.",
      ],
      asked_of_you: ["Check the Lagos poster copy and confirm it by Wednesday."],
    },
  },
  {
    match: "body_markdown",
    delay: 3,
    reply: {
      kind: "draft",
      subject: null,
      body_markdown:
        "Hi Precious,\n\nThank you, the Lagos set looks great. I have checked the copy and it is approved, so it can go into next week's schedule.\n\nPlease go ahead with the Abuja versions for Tochukwu by Friday.\n\nThanks,\nAaron",
      questions: [],
    },
  },
]);

async function prepare({ log = console.log } = {}) {
  const { config } = src("config/env");
  require("../people").guard(config);
  const { pool } = src("config/db");
  const requestContext = src("config/request-context");
  const grants = src("shared/rbac/grants-cache");
  const community = src("modules/community/community.service");
  const { realStaff } = require("../../../seeds/staging/lib/staff");
  const nodemailer = require("nodemailer");

  const staff = await realStaff(pool);
  const by = (post) => staff.everyone.find((p) => p.job_title === post);
  const as = async (person) => ({ ...(await grants.getAuthUser(pool, person.user_id)), ip: null });
  const lagos = src("shared/time/lagos");
  /** [days before today, "HH:MM" in Lagos] as an instant. */
  const when = ([days, time]) => lagos.instant(lagos.addDays(lagos.today(new Date()), -days), time);
  /** Move a message just posted back to when it was written (the filming database only). */
  const backdate = (id, at) =>
    pool.query("UPDATE community_message SET sent_at = $2, created_at = $2, updated_at = $2 WHERE community_message_id = $1", [id, when(at)]);

  const { rows: had } = await pool.query("SELECT count(*)::int AS n FROM community_channel WHERE name = $1", [BRAND.name]);
  if (had[0].n) throw new Error("The Brand Team channel exists: prepare runs once, after parts 1 to 3 (runbook §4.1).");

  await requestContext.run({ requestId: "video-m01-5", surface: "script" }, async () => {
    await community.joinEveryone();
    const general = (await pool.query("SELECT community_channel_id FROM community_channel WHERE system_key = 'general'")).rows[0];
    for (const p of GENERAL) {
      const m = await community.postMessage(general.community_channel_id, { message_type: "text", body: p.body }, await as(by(p.post)));
      await backdate(m.community_message_id, p.at);
    }
    const owner = await as(by(BRAND.owner));
    const channel = await community.createChannel(
      { name: BRAND.name, description: BRAND.description, post_policy: "everyone", member_ids: BRAND.members.map((p) => by(p).employee_id), department_ids: [] },
      owner,
    );
    await pool.query("UPDATE community_channel SET created_at = $2 WHERE community_channel_id = $1", [channel.community_channel_id, when([2, "10:15"])]);
    for (const p of BRAND.posts) {
      const m = await community.postMessage(channel.community_channel_id, { message_type: "text", body: p.body }, await as(by(p.post)));
      await backdate(m.community_message_id, p.at);
    }
    const dm = await community.sendDirect(by("Social Media Manager").employee_id, "Morning Aaron, did you get a chance to look at the poster copy?", await as(by("Graphics Designer")));
    await backdate(dm.community_message_id, [0, "09:05"]);
    log("community: #general, Brand Team and a direct message");
  });

  // The mail, delivered to the filming machine's own mail server (MAILBOX_SMTP_HOST, runbook §1.8).
  const smtp = nodemailer.createTransport({ host: config.MAILBOX_SMTP_HOST, port: config.MAILBOX_SMTP_PORT, secure: false, ignoreTLS: true });
  const aaron = by("Social Media Manager");
  const address = (p) => ({ name: `${p.first_name} ${p.last_name}`, address: p.work_email });
  const ids = {};
  for (const m of MAIL) {
    const from = m.external ? { name: m.external.name, address: m.external.email } : address(by(m.from));
    const messageId = `<${m.id || Math.random().toString(36).slice(2)}.video@mycityapp.io>`;
    if (m.id) ids[m.id] = messageId;
    await smtp.sendMail({
      from,
      to: m.to ? [...m.to.map((p) => address(by(p))), ...(m.ccAaron ? [] : [address(aaron)])] : [address(aaron)],
      cc: [...(m.cc || []).map((p) => address(by(p))), ...(m.ccAaron ? [address(aaron)] : [])],
      subject: m.subject,
      text: m.text,
      date: when(m.at),
      messageId,
      ...(m.replyTo ? { inReplyTo: ids[m.replyTo], references: [ids["posters-1"], ...(ids[m.replyTo] !== ids["posters-1"] ? [ids[m.replyTo]] : [])] } : {}),
    });
  }
  log(`mail: ${MAIL.length} messages to ${aaron.work_email}`);
}

/** Write the stand-in's answers for the shots that ask the AI. */
const answers = () => fs.writeFileSync(process.env.VIDEO_AI_REPLIES, JSON.stringify(REPLIES));

const composer = (s) => s.page.getByRole("dialog").last();
/** A channel in the list, a button named by its name ("# general ..."). */
const channel = (s, name) => s.page.getByRole("button", { name: new RegExp(`^# ${name}\\b`) }).first();

module.exports = {
  id: "m01-community-mailbox-5",
  file: "MyCity-M0-M1-Part-5-Community-and-Mailbox",
  meta: { title: "MyCity App · Getting Started, Part 5: Community and Mailbox (Milestones 0 and 1)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestones 0 and 1 · Part 5 of 5",
    title: "Community and Mail",
    subtitle: "Channels, recognition, announcements and your mailbox",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestones 0 and 1 · Part 5 · Community and Mail",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  prepare,
  people: {
    aaron: (staff) => staff.everyone.find((p) => p.job_title === "Social Media Manager").work_email,
    cynthia: (staff) => staff.operations.work_email,
  },
  chapters: [
    {
      name: "Welcome",
      shots: [
        {
          kind: "card",
          card: "opening",
          lines: [
            "Welcome to the last of five videos on Milestones 0 and 1 of the MyCity hub.",
            "This part is MyCity talking to itself: Staff Community, and your own mailbox inside the hub.",
          ],
        },
        {
          kind: "desktop",
          as: "aaron",
          start: CHANNELS,
          lines: [
            { say: "Staff Community is in the menu, under Work. Its tabs are Channels, Direct Messages and Announcements.", do: (s) => h.soft(s, s.page.getByRole("link", { name: /^Staff Community/ })) },
            "Everyone is in general and announcements. Other channels list only the people added to them.",
            "We follow Aaron Agama, and Cynthia Osakunih, who posts for People and Operations.",
          ],
        },
      ],
    },
    {
      name: "Channels",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: CHANNELS,
          lines: [
            { say: "Each row shows the channel's last message, its time, and how many are unread.", do: (s) => h.soft(s, channel(s, "general")) },
            { say: "He opens general. It opens beside the list, at his first unread message.", do: (s) => s.click(channel(s, "general")) },
            { say: "Ifeoma's welcome, Cynthia on leave requests, and the rest of the week's news.", do: (s) => s.scroll(-400, s.page.getByText(/hub is live/).first()) },
            { say: "Chinyere Elechi has started a Brand Team channel, with Aaron in it.", do: (s) => s.click(channel(s, "Brand Team")) },
            "Older messages load as he scrolls up. The round arrow takes him back to the newest.",
          ],
        },
      ],
    },
    {
      name: "Posting a Message",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: CHANNELS,
          setup: (s) => s.click(channel(s, "Brand Team")),
          lines: [
            { say: "He types in the box at the bottom.", do: (s) => s.type(s.page.getByRole("textbox", { name: /^Message/ }).first(), "Thanks Similoluwa. I will use the templates for Saturday's stories.", { delay: 40 }) },
            { say: "Enter sends it. Shift with Enter starts a new line.", do: (s) => s.page.keyboard.press("Enter") },
            { say: "The plus beside the box holds more: Attach a File, Recognise a Colleague, and Start a Poll.", do: (s) => s.click(h.button(s, "Add to message")) },
            "Photos, videos and documents go up to ten at a time. A voice note records from the microphone.",
            { say: "A link he pastes shows a small card with its page's title.", do: (s) => s.page.keyboard.press("Escape") },
          ],
        },
      ],
    },
    {
      name: "Recognising a Colleague",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: CHANNELS,
          setup: (s) => s.click(channel(s, "Brand Team")),
          lines: [
            "Precious Iyeserhen turned the poster set round in two days. Aaron thanks her in front of the company.",
            { say: "The plus, then Recognise a Colleague.", do: async (s) => { await s.click(h.button(s, "Add to message")); await s.click("Recognise a Colleague"); } },
            { say: "He picks Precious as the Colleague.", do: async (s) => { await s.type(h.named(s, "Recognise a Colleague").getByRole("searchbox").first(), "Precious", { delay: 80 }); await s.click(s.page.getByRole("option", { name: /Precious Iyeserhen/ }).first()); } },
            { say: "A Note is optional. Left empty, the hub writes a thank you for him.", do: (s) => s.type(h.named(s, "Recognise a Colleague").getByRole("textbox", { name: "Note" }), "Six Detty December posters in two days, and every one on brand. Thank you!", { delay: 30 }) },
            { say: "Post Recognition. Posted to general: a recognition always goes where everyone sees it.", do: async (s) => { await s.click(h.button(s, "Post Recognition")); await h.toastOf(s, "Posted to"); } },
            { say: "In general, colleagues add their thumbs up. There are no rewards and no votes: just thanks.", do: async (s) => { await s.click(channel(s, "general")); await s.wait(1); } },
          ],
        },
      ],
    },
    {
      name: "Polls and Celebrations",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: CHANNELS,
          setup: (s) => s.click(channel(s, "general")),
          lines: [
            "In general, only People and the CEO start a poll. In other channels, anyone who may post can.",
            { say: "Cynthia presses the plus, then Start a Poll.", do: async (s) => { await s.click(h.button(s, "Add to message")); await s.click("Start a Poll"); } },
            { say: "The Question, and at least two options.", do: async (s) => { const d = h.named(s, "Start a Poll"); await s.type(d.getByRole("textbox", { name: "Question" }), "When should the weekly hub tip go out?", { delay: 35 }); await s.type(d.getByLabel("Option 1", { exact: true }), "Monday morning", { delay: 45 }); await s.type(d.getByLabel("Option 2", { exact: true }), "Friday afternoon", { delay: 45 }); } },
            { say: "Post Poll. Each person has one vote, and can change it.", do: async (s) => { await s.click(h.button(s, "Post Poll")); await s.wait(1); } },
            { say: "She votes Monday morning. Each option shows its share.", do: async (s) => { await s.click(s.page.getByRole("button", { name: /^Monday morning/ }).last()); await s.wait(1); } },
            "At eight each morning, the hub posts a card here for each birthday and work anniversary.",
            "Colleagues press Celebrate, or Send Wishes, and the person is told.",
          ],
        },
      ],
    },
    {
      name: "Direct Messages",
      shots: [
        {
          kind: "phone",
          as: "aaron",
          start: DIRECT,
          label: { eyebrow: "On Aaron's phone", title: "Direct Messages", subtitle: "One to one, with a colleague" },
          setup: (s) => h.clearOffers(s),
          lines: [
            { say: "Direct Messages are one to one. Precious has written to Aaron.", do: (s) => s.wait(0.5) },
            { say: "He taps her conversation.", do: (s) => s.click(s.page.getByRole("button", { name: /Precious Iyeserhen/ }).first()) },
            { say: "He answers.", do: async (s) => { await s.type(s.page.getByRole("textbox", { name: /^Message/ }).first(), "Yes, I'm on it. You'll have it today.", { delay: 45 }); await s.click(h.button(s, "Send")); } },
            "One tick means sent, two grey ticks delivered, and two blue ticks read. A green dot means she's online.",
            { say: "New Message starts a conversation with anyone who has a login.", do: (s) => s.click(h.button(s, "Back to conversations")) },
          ],
        },
      ],
    },
    {
      name: "Announcements",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ANNOUNCE,
          lines: [
            "People and the CEO post announcements to everyone, or to chosen departments, and see who has read them.",
            { say: "Cynthia presses New Announcement.", do: (s) => s.click(h.button(s, "New Announcement")) },
            { say: "A Headline, and the Message.", do: async (s) => { const d = h.named(s, "New Announcement"); await s.type(d.getByLabel("Headline", { exact: true }), "Welcome to the MyCity Hub", { delay: 35 }); await s.type(d.getByLabel("Message", { exact: true }), "Every step of the hub is written up in the User Guide, in the Knowledge Hub. Ask People if anything is unclear.", { delay: 18 }); } },
            { say: "The Level: Normal, Important, or Urgent, which stays red on everyone's screen until they acknowledge it.", do: (s) => s.click(h.named(s, "New Announcement").getByRole("radio", { name: "Important" })) },
            "Important reminds anyone who hasn't read it after four hours. The Audience is All Staff, and it goes Now.",
            { say: "Publish Announcement.", do: async (s) => { await s.click(h.button(s, "Publish Announcement")); await h.toastOf(s, "Published"); } },
            { say: "Published to announcements. Everyone is told, and the card counts who has read it.", do: (s) => s.wait(1) },
          ],
        },
      ],
    },
    {
      name: "Connecting Your Mailbox",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: INBOX,
          lines: [
            "Mailbox is Aaron's own MyCity email, inside the hub. The first time, it asks to connect.",
            { say: "His work address is already in Email Address. He types his email password.", do: (s) => h.typePassword(s, "Password", s.password, h.named(s, "Connect Mailbox")) },
            { say: "Connect.", do: async (s) => { await s.click(h.button(s, "Connect", h.named(s, "Connect Mailbox"))); await h.toastOf(s, "Mailbox connected"); } },
            { say: "Mailbox connected. The first time, it reads the mail already there, which takes a moment.", do: (s) => h.soft(s, s.page.getByRole("button", { name: /Detty December poster set/ }).first(), 8000) },
            "The tabs are the folders: Inbox, Sent, Drafts, Archive, Spam and Trash, and his Signature.",
            "New mail arrives by itself, and the bell tells him.",
          ],
        },
      ],
    },
    {
      name: "Reading and Replying",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: INBOX,
          setup: answers,
          lines: [
            { say: "The Detty December poster set has three messages. He opens it.", do: (s) => s.click(s.page.getByRole("button", { name: /Detty December poster set/ }).first()) },
            { say: "Summarise Thread reads it for him.", do: (s) => s.click(h.button(s, "Summarise Thread")) },
            { say: "The Summary: the gist, the Key Points, and what is Asked of You: confirm the copy by Wednesday.", do: (s) => h.soft(s, s.page.getByText("Asked of You").first(), 15000) },
            { say: "He presses Reply, then Write With AI.", do: async (s) => { await s.click(h.button(s, "Close Summary")); await s.click(h.button(s, "Reply")); await s.click(h.button(s, "Write With AI")); } },
            { say: "In What To Say: approve the Lagos copy, and ask for the Abuja versions by Friday.", do: (s) => s.type(composer(s).getByLabel("What To Say", { exact: true }), "approve the Lagos copy, ask Precious for the Abuja versions by Friday", { delay: 30 }) },
            { say: "Write Draft. The draft comes from the conversation and his line.", do: (s) => s.click(h.button(s, "Write Draft")) },
            { say: "He reads it, and presses Use Draft. Nothing is sent until he presses Send himself.", do: async (s) => { await h.soft(s, h.button(s, "Use Draft"), 15000); await s.click(h.button(s, "Use Draft")); } },
            { say: "Send.", do: async (s) => { await s.click(h.button(s, "Send", composer(s))); await s.wait(1.2); } },
          ],
        },
      ],
    },
    {
      name: "Writing and Sending Later",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: INBOX,
          lines: [
            { say: "Ifeoma asked for the December posting schedule. He presses Compose.", do: (s) => s.click(h.button(s, "Compose")) },
            { say: "Her address in To, then the Subject.", do: async (s) => { await s.type(composer(s).getByLabel("To", { exact: true }), "ifeoma@mycityapp.io,", { delay: 35 }); await s.type(composer(s).getByLabel("Subject", { exact: true }), "December posting schedule", { delay: 35 }); } },
            { say: "He writes the message.", do: (s) => s.type(composer(s).getByRole("textbox", { name: "Message Body" }), "Hi Ifeoma, the December posting schedule is ready for us to go through. Aaron", { delay: 25 }) },
            { say: "It saves as he writes. Show Signature shows what his message will carry.", do: (s) => s.click(h.button(s, "Show Signature")) },
            { say: "Schedule, beside Send, sends it later: Monday at 08:00.", do: async (s) => { await s.click(h.button(s, "Schedule", composer(s))); await s.click(s.page.getByRole("menuitem", { name: /^Monday/ }).or(s.page.getByRole("button", { name: /^Monday/ })).first()); await s.wait(1); } },
            { say: "It waits in Drafts, marked Scheduled, and goes by itself.", do: (s) => s.click(h.tab(s, "Drafts")) },
            { say: "The Signature tab shows the signature every message carries, built from his record.", do: (s) => s.click(h.tab(s, "Signature")) },
          ],
        },
      ],
    },
    {
      name: "Wrapping Up",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: CHANNELS,
          lines: [
            { say: "That's Staff Community and Mailbox, from a channel to a scheduled email.", do: (s) => s.wait(0.4) },
            "That also ends Milestones 0 and 1: signing in, finding your way, Home, Self-Service, Community and Mail.",
          ],
        },
        {
          kind: "card",
          card: "closing",
          lines: ["Every step is also written up in the User Guide, in the Knowledge Hub. Thank you for watching."],
        },
      ],
    },
  ],
};

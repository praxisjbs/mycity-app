"use strict";
/**
 * The staging seed's courses (90_knowledge.js; docs/guides/knowledge.md §6.5 to §6.8): two real
 * courses, built from public material that was checked on 11/11/2026.
 *
 *   NDPA Data Protection Essentials   Nigeria's Data Protection Act 2023 for everyone: the
 *                                     regulator's own video, two Nigerian news explainers, a
 *                                     phishing short, two lessons, our PDF summary and the Act's
 *                                     official text. In the Library, and assigned to the
 *                                     Implementation department only (90_knowledge.js says why).
 *   Partner Outreach                  Approaching a business lead, for Partnership & Growth and
 *                                     Branding & Marketing: four videos, two lessons, our PDF
 *                                     checklist and HubSpot Academy's free Inbound Sales course,
 *                                     whose certificate is the proof. In the Library.
 *
 * Every video is embedded through YouTube's own player (youtube-nocookie.com) and every outside
 * course is a link: nothing is downloaded or re-hosted. Each video's owner allowed embedding
 * (YouTube's oEmbed answered for each), and its title is the one its channel gave it. The lessons
 * and the two PDFs are our own words: they cite the Act's sections and name HubSpot where an idea
 * or a figure is theirs. A lesson is a training aid, not legal advice.
 *
 * An item is { kind, title, minutes } with `url` (video, link), `lesson_html` (lesson) or `pdf`
 * (file: the name of the HTML page in this folder that the seed prints to a PDF).
 */

const NDPA_URL = "https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf";
const yt = (id) => `https://www.youtube.com/watch?v=${id}`;

const NDPA_SCOPE = `
<h2>Why the Act exists</h2>
<p>The Nigeria Data Protection Act 2023 (Act No. 37) protects people's personal data. It came into force on 12 June 2023. It sets rules for anyone who collects or uses personal data, gives people rights over their data, and set up an independent regulator, the <strong>Nigeria Data Protection Commission (NDPC)</strong>.</p>
<p>Its aims include fair, lawful and accountable use of personal data, remedies for people whose rights are breached, and a digital economy people can trust (section 1).</p>

<h2>Does it apply to us?</h2>
<p>Yes. The Act applies to a company that operates in Nigeria or uses personal data in Nigeria, whether on a computer or on paper (section 2). MyCityApp holds personal data about our users, our partners' contacts, candidates and our own staff, so every one of us handles data the Act protects.</p>

<h2>Five words to know</h2>
<ul>
<li><strong>Personal data</strong>: any information about a person who can be identified, such as a name, a phone number, an ID number, a location or an online identifier.</li>
<li><strong>Sensitive personal data</strong>: data that needs extra care, such as health, religion, ethnic origin, political opinions, biometrics and trade union membership.</li>
<li><strong>Data controller</strong>: the organisation that decides why and how data is used. For our users and staff, that is MyCityApp.</li>
<li><strong>Data processor</strong>: an organisation that uses data on a controller's behalf, such as a cloud or messaging provider.</li>
<li><strong>Processing</strong>: anything done with personal data: collecting, storing, using, sharing, changing or deleting it.</li>
</ul>

<h2>The six principles</h2>
<p>Section 24 says personal data must be:</p>
<ol>
<li>used fairly, lawfully and openly;</li>
<li>collected for a clear purpose, and not used for another purpose that does not fit it;</li>
<li>limited to what the purpose needs;</li>
<li>kept no longer than needed;</li>
<li>accurate and up to date;</li>
<li>kept secure against loss, misuse and unauthorised access.</li>
</ol>
<p>The organisation must also be able to show that it follows these principles. The Act calls this accountability.</p>

<h2>A lawful reason for every use</h2>
<p>Section 25 allows personal data to be used only with one of these reasons:</p>
<ul>
<li><strong>Consent</strong>: the person agreed, for that purpose. Example: a user who opts in to our newsletter.</li>
<li><strong>Contract</strong>: it is needed to give the person what they signed up for. Example: a user's account in the app.</li>
<li><strong>Legal obligation</strong>: a law requires it. Example: tax and pension records for staff.</li>
<li><strong>Vital interests</strong>: it protects someone's life.</li>
<li><strong>Public interest</strong>: a task in the public interest or under official authority.</li>
<li><strong>Legitimate interests</strong>: a genuine business need that does not override the person's rights, and that they would reasonably expect.</li>
</ul>

<h2>What good consent looks like</h2>
<p>Consent must be freely given, specific, informed and clear (sections 26 and 65). Silence or a pre-ticked box is not consent. People must be told they can withdraw it, and withdrawing must be as easy as giving it. Before we collect data from someone, we tell them who we are, why we want it, who will see it, how long we keep it and what their rights are (section 27). Our privacy policy does this for our users.</p>

<p><em>A training summary, not legal advice. Read the Act itself for the exact words.</em></p>
`;

const NDPA_DUTIES = `
<h2>People's rights</h2>
<p>The Act gives every person rights over their own data (sections 34 to 38). A user, a partner's contact, a candidate or a colleague may ask us to:</p>
<ul>
<li><strong>tell them</strong> whether we hold their data, why, and who we share it with;</li>
<li><strong>give them a copy</strong> of it in a common electronic format;</li>
<li><strong>correct</strong> data that is wrong, out of date or incomplete;</li>
<li><strong>delete</strong> data we no longer need or have no lawful reason to keep;</li>
<li><strong>pause</strong> its use while a question about it is settled;</li>
<li><strong>stop</strong> using it for marketing. This right is absolute: once someone objects, we stop (section 36);</li>
<li><strong>withdraw consent</strong> at any time;</li>
<li><strong>move it</strong> to another service in a machine-readable format.</li>
</ul>
<p>People may also complain to the NDPC (section 46). If someone asks you for any of these, do not handle it alone: write down the request, the date and who asked, and pass it on the same day.</p>

<h2>Your duties, every day</h2>
<ul>
<li><strong>Collect only what you need.</strong> If a form or a sheet asks for more than the task needs, say so.</li>
<li><strong>Keep it where it belongs.</strong> Use the company's systems, never a personal email, a personal phone gallery or a private WhatsApp group.</li>
<li><strong>Lock it.</strong> Lock your screen when you step away, use strong passwords and two-step sign-in, and never share your login.</li>
<li><strong>Share with care.</strong> Before sending personal data outside the company, or to a service abroad, check that it is allowed. Data may leave Nigeria only under the conditions in sections 41 to 43, and the reason must be recorded.</li>
<li><strong>Do not keep it forever.</strong> Delete or archive what the purpose no longer needs.</li>
<li><strong>Watch for phishing.</strong> Most breaches start with a message that tricks someone into giving away a password or opening a file.</li>
</ul>

<h2>When something goes wrong</h2>
<p>A personal data breach is any security failure that destroys, loses, changes or exposes personal data, by accident or on purpose: a lost phone, an email to the wrong person, a hacked account, a shared spreadsheet open to anyone with the link.</p>
<ol>
<li><strong>Report it at once</strong> to your line manager and the Technology team, even if you are not sure it is a breach.</li>
<li>The company must tell the NDPC <strong>within 72 hours</strong> of becoming aware of a breach that is likely to put people at risk (section 40(2)). The clock starts when anyone in the company knows, which is why every minute you wait counts.</li>
<li>When the risk to people is high, the company must also tell them <strong>immediately</strong>, in plain words, with advice on protecting themselves (section 40(3)).</li>
<li>Every breach is recorded, whether or not it is reported (section 40(8)).</li>
</ol>

<h2>Why it matters</h2>
<p>The NDPC can order a company to fix a breach, compensate the people harmed and pay a penalty. For a company the NDPC treats as of major importance, the penalty can reach the greater of <strong>₦10 million or 2% of its annual gross revenue</strong>; for others, the greater of ₦2 million or 2% (section 48). An employer is answerable for what its employees do in the course of its business (section 53). Above all, users and partners trust us with their data, and that trust is what MyCityApp is built on.</p>

<p><em>A training summary, not legal advice. If you are unsure whether you may use or share personal data, ask before you do.</em></p>
`;

const OUTREACH_RESEARCH = `
<h2>Find the right businesses</h2>
<p>MyCityApp lists the places people eat, the events they go to and the things they do. The businesses behind them are our partners: restaurants, lounges, venues, event organisers, hotels and attractions. A good lead is a business our users would want to find, in a city we cover, with a reason to work with us now.</p>
<p>HubSpot's Inbound Sales course describes four stages: <strong>identify</strong> businesses that need help, <strong>connect</strong> with them personally, <strong>explore</strong> their goals in a conversation, and <strong>advise</strong> them while they decide. This lesson covers the first two.</p>

<h2>Fit before contact</h2>
<p>Before you reach out, ask two questions:</p>
<ul>
<li><strong>Fit</strong>: does this business match the partners we want? Think of its category, its area, its quality and its audience.</li>
<li><strong>Timing</strong>: is there a reason to talk now? A new opening, an upcoming event, a new menu, or a listing elsewhere that is out of date.</li>
</ul>
<p>Sort your list into three: contact now, research further, and later. Spend your time on the first.</p>

<h2>Research first</h2>
<p>Spend ten minutes on each business before contacting it:</p>
<ol>
<li>Read its website, its social pages and its recent reviews.</li>
<li>Note who decides: the owner, the manager or the marketing lead.</li>
<li>Find one specific thing to mention: an event it is running, a dish people rave about, a review it answered well.</li>
<li>Check whether it is already a lead or a partner in Partnerships, so two of us never approach the same business.</li>
<li>Write what you found on the lead, so a colleague never has to repeat the work.</li>
</ol>

<h2>Respect people's data and time</h2>
<p>A business owner's name, phone number and email are personal data under the Nigeria Data Protection Act. Contact people for a clear business reason, keep only what you need, and record how they prefer to be reached. If someone asks not to be contacted again, stop at once and note it on the lead: the Act makes that right absolute for marketing (section 36).</p>
<p>Be persistent, but set yourself limits: a few contacts over a few weeks, each with something new to say, never a stream of the same message.</p>
`;

const OUTREACH_FOLLOW_UP = `
<h2>The first message</h2>
<p>Your first message decides whether you get a meeting. Keep it short and about them:</p>
<ul>
<li><strong>Use their name</strong>, never "Dear Sir or Madam".</li>
<li><strong>Open with your reason</strong>: the specific thing you found in your research.</li>
<li><strong>Say what is in it for them</strong>: more people finding them, filling a quiet night, selling tickets to an event.</li>
<li><strong>Ask for one thing</strong>: a fifteen-minute call or a visit, with two times to choose from.</li>
</ul>
<p>An example, in our own words:</p>
<p><em>Good afternoon, Mrs Adeyemi. Congratulations on opening your second branch in Yaba; the suya platter is already getting great reviews. I'm with MyCityApp, where people in Lagos discover where to eat and what to do. I'd love to show you how listing the new branch could bring in more weekday diners. Could I visit on Tuesday or Thursday afternoon for fifteen minutes?</em></p>
<p>Pick the channel that suits the business: a personal email or a WhatsApp Business message for a note, a call to qualify quickly, a visit for a business that prefers to meet. Treat a manager or a front desk as an ally: be friendly, ask for the best time to reach the owner, and do not pitch to them.</p>

<h2>Follow up with something new</h2>
<p>Most replies come after the first message. HubSpot's guidance is that most outreach runs six to eight touches over two to three weeks, then pauses. Each follow-up should add something: a partner's result, an upcoming event, an idea for them. Never send a bare "just following up". After the pause, move the lead to later and come back when something changes.</p>

<h2>The first meeting</h2>
<p>Listen more than you talk. Ask about their goals, their busiest and quietest times, who their customers are and what they have tried before. Only then show how MyCityApp could help, with examples from similar partners. Agree a next step before you leave.</p>

<h2>After the meeting</h2>
<p>Send a follow-up within one working day:</p>
<ol>
<li>Thank them, and mention something specific from the conversation.</li>
<li>Recap the main points in a short list, and invite them to correct anything you got wrong.</li>
<li>Share one useful thing: an example listing, or the results of a similar partner.</li>
<li>Propose the next step with a date and a time.</li>
</ol>

<h2>Log everything</h2>
<p>After every call, message and meeting, log it on the lead in Partnerships and move its deal to the stage it has reached. A full record means anyone on the team can pick up the conversation, and our pipeline shows what is really happening.</p>
`;

const COURSES = Object.freeze([
  {
    key: "ndpa",
    title: "NDPA Data Protection Essentials",
    summary:
      "Nigeria's Data Protection Act 2023 in plain words: what personal data is, the rules for using it, people's rights, and what to do when something goes wrong.",
    library: true,
    proof_required: false,
    proof_prompt: null,
    assign: { department: "Implementation", due_within_days: 14 },
    items: [
      { kind: "video", title: "NDPC Announces Implementation of Data Protection Act 2023", url: yt("D_jI9YNRoBs"), minutes: 3 },
      { kind: "lesson", title: "What the NDPA Covers", lesson_html: NDPA_SCOPE, minutes: 6 },
      { kind: "video", title: "Understanding the Nigeria Data Protection Act", url: yt("LfnlK-4viSo"), minutes: 9 },
      { kind: "lesson", title: "Your Rights and Duties at Work", lesson_html: NDPA_DUTIES, minutes: 7 },
      { kind: "video", title: "Data Protection Law and Implications for Individuals and Businesses", url: yt("a8QqTOL7_ig"), minutes: 10 },
      { kind: "video", title: "Recognize and Report Phishing", url: yt("JlQovysQBn0"), minutes: 1 },
      { kind: "file", title: "NDPA at a Glance", pdf: "ndpa-at-a-glance", minutes: 5 },
      { kind: "link", title: "The Act's Official Text (NDPC)", url: NDPA_URL, minutes: 15 },
    ],
  },
  {
    key: "outreach",
    title: "Partner Outreach",
    summary:
      "How to find, approach and follow up a business that could partner with MyCityApp: research, the first message, the first meeting and the record you keep.",
    library: true,
    proof_required: true,
    proof_prompt: "Link to your HubSpot Inbound Sales certificate",
    assign: null,
    items: [
      { kind: "video", title: "Tips for Partnering With Other Local Businesses", url: yt("Tfg5Plhsod4"), minutes: 6 },
      { kind: "lesson", title: "Choose and Research the Lead", lesson_html: OUTREACH_RESEARCH, minutes: 5 },
      { kind: "video", title: "Why These Cold Email Techniques Will Land You a Reply", url: yt("q21qQ3HOBaY"), minutes: 5 },
      { kind: "video", title: "The Sales Playbook for Founders (Y Combinator)", url: yt("DH7REvnQ1y4"), minutes: 19 },
      { kind: "lesson", title: "First Message, Meeting and Follow-Up", lesson_html: OUTREACH_FOLLOW_UP, minutes: 6 },
      { kind: "video", title: "Event Partnerships: How to Pick, Pitch and Execute", url: yt("GY0JZ0EWRfE"), minutes: 8 },
      { kind: "file", title: "Partner Outreach Checklist", pdf: "partner-outreach-checklist", minutes: 3 },
      { kind: "link", title: "Inbound Sales Certification (HubSpot Academy)", url: "https://academy.hubspot.com/courses/inbound-sales", minutes: 186 },
    ],
  },
]);

module.exports = { COURSES, NDPA_URL };

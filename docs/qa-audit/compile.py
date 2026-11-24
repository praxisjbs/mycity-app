"""Compiles the verdict files (verdicts/a.md to e.md) into items.json for build.py.

    python3 docs/qa-audit/compile.py docs/qa-audit/items.json

Every verdict block is parsed; a block repeated later wins. The routing rules:
  Bugs & Gaps     BUG, GAP, IMPROVEMENT, SEED_DATA, FIXED_SINCE_AUDIT (ticked, with its PR)
  Change Report   OUT_OF_SCOPE, plus the BY_DESIGN parts listed in CHANGE (they ask to change
                  an agreed decision); F03, F04 and F47 were ruled out of scope by the lead
  MyCity Actions  CLIENT_ACTION (the hand-written rows in CLIENT)
  Closed          the other BY_DESIGN parts, and NOT_REPRODUCED
The hand-written tables below say what a block cannot: the milestone and owner of each module,
each Change Report row, and where in the hub each MyCity action is done.
"""
import json
import os
import re
import sys
from collections import OrderedDict, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
OUT = ARGS[0] if ARGS else os.path.join(HERE, "items.json")
FIELDS = ["ID", "Title", "Verdict", "Severity", "Module", "Evidence", "Scope ref", "Fix", "Effort",
          "For MyCity"]
FIELD_RE = re.compile(r"^\s*(%s):\s?(.*)$" % "|".join(re.escape(k) for k in FIELDS))


def parse(path):
    out, cur, last = [], None, None
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        m = FIELD_RE.match(line)
        if m:
            k, v = m.groups()
            if k == "ID":
                cur = {"ID": v.strip()}
                out.append(cur)
            elif cur is not None:
                cur[k] = v.strip()
            last = k
        elif cur is not None and line.strip() and last and not line.startswith(("#", "```")):
            cur[last] = cur.get(last, "") + " " + line.strip()
        else:
            last = None
    return out


blocks = OrderedDict()
for g in "abcde":
    for b in parse(os.path.join(HERE, "verdicts", f"{g}.md")):
        b["Verdict"] = b["Verdict"].split()[0].strip()
        blocks[b["ID"]] = b  # a later block for the same ID wins

# The lead's out-of-scope rulings (TB, 24/11/2026) have no verifier block.
RULED = {
    "F03": ("No finance core (invoicing, receivables, payables, ledger)", "Finance"),
    "F04": ("No products, inventory, orders or revenue capture", "Sales and inventory"),
    "F47": ("Mailbox makes failing calls before an account is connected", "Mailbox"),
}
for fid, (title, mod) in RULED.items():
    blocks.setdefault(fid, {"ID": fid, "Title": title, "Verdict": "OUT_OF_SCOPE", "Severity": "Low",
                            "Module": mod, "Evidence": "Lead's ruling, 24/11/2026.", "Scope ref": "",
                            "Fix": "None under contract.", "Effort": "L", "For MyCity": ""})

for b in blocks.values():
    missing = [k for k in FIELDS if not b.get(k)]
    if missing and b["ID"] not in RULED:
        sys.exit(f"{b['ID']} is missing {missing}")

# ---------------------------------------------------------------- findings (MyCity's own)
FINDINGS = OrderedDict()
for line in open(os.path.join(HERE, "source", "findings.txt"), encoding="utf-8"):
    if line.startswith("=== F"):
        parts = [p.strip() for p in line[4:].split("|")]
        FINDINGS[parts[0]] = {"title": parts[-1], "sev": parts[-2]}
assert len(FINDINGS) == 83, len(FINDINGS)

# ---------------------------------------------------------------- modules: name, milestone, owner
MODULES = {
    "Partnerships": ("Partnerships", "M7", "LA"),
    "Payroll": ("Payroll", "M6", "LA"),
    "Expenses": ("Expenses", "M8", "AJ"),
    "Attendance": ("Attendance", "M1", "LA"),
    "Offers": ("Offers", "M5", "AJ"),
    "People": ("People", "M1", "TB"),
    "My Workspace": ("My Workspace", "M2", "AJ"),
    "Home": ("Home", "M1", "TB"),
    "Recruitment": ("Recruitment", "M4", "GE"),
    "Self-Service": ("Self-Service", "M1", "AJ"),
    "Policies": ("Policies", "M1", "TB"),
    "Platform": ("Platform", "M0", "AJ"),
    "Notifications": ("Notifications", "M0", "TB"),
    "Approvals": ("Approvals", "M0", "TB"),
    "Queries & Sanctions": ("Queries & Sanctions", "M3", "GE"),
    "Performance": ("Performance", "M2", "TB"),
    "Praxis AI": ("Praxis AI", "M10", "TB"),
    "Settings": ("Settings", "M9", "TB"),
    "Knowledge Hub": ("Knowledge Hub", "M10", "TB"),
    "Community": ("Community", "M1", "GE"),
    "Search": ("Search", "M0", "TB"),
    "Organogram": ("People", "M1", "TB"),
    "Finance": ("Finance", "None", ""),
    "Sales and inventory": ("Sales and inventory", "None", ""),
    "Mailbox": ("Mailbox", "None", ""),
}
# A verifier's free-text module, matched by its start (first match wins).
MODULE_PREFIX = [
    ("Approvals engine", "Approvals"), ("Notifications / Performance", "Notifications"),
    ("Notifications", "Notifications"), ("Navigation", "Platform"), ("Platform", "Platform"),
    ("Public site", "Offers"), ("Partnerships", "Partnerships"), ("Payroll", "Payroll"),
    ("Expenses", "Expenses"), ("Attendance", "Attendance"), ("Offers", "Offers"),
    ("People", "People"), ("My Workspace", "My Workspace"), ("Workspace", "My Workspace"),
    ("Home", "Home"), ("Recruitment", "Recruitment"), ("Self-Service", "Self-Service"),
    ("ESS", "Self-Service"), ("Policies", "Policies"), ("Queries", "Queries & Sanctions"),
    ("Performance", "Performance"), ("Praxis AI", "Praxis AI"), ("AI", "Praxis AI"),
    ("Settings", "Settings"), ("Knowledge", "Knowledge Hub"), ("Community", "Community"),
    ("Search", "Search"), ("Organogram", "Organogram"), ("Mobile", "Platform"),
    ("Finance", "Finance"), ("Sales", "Sales and inventory"), ("Mailbox", "Mailbox"),
]


def module_of(b):
    for prefix, key in MODULE_PREFIX:
        if b["Module"].startswith(prefix):
            return MODULES[key]
    sys.exit(f"{b['ID']}: no module mapping for {b['Module']!r}")


# ---------------------------------------------------------------- fixed since the audit
COMMITS = {  # commit: (PR, merged)
    "4978ae8": ("#170", "2026-11-17"), "3945405": ("#165", "2026-11-16"),
    "9793ccf": ("#168", "2026-11-18"), "264eaee": ("#169", "2026-11-18"),
    "697f1db": ("#171", "2026-11-24"),
}


def fixed_in(b):
    for c, (pr, day) in COMMITS.items():
        if c in b["Evidence"]:
            return pr, day
    m = re.search(r"#(1[5-9]\d)", b["Evidence"])
    if m:
        return "#" + m.group(1), ""
    sys.exit(f"{b['ID']}: FIXED_SINCE_AUDIT names no known commit")


def how_verified(e):
    low = e.lower()
    if "throwaway" in low or "zz-audit" in low or "reproduction test" in low:
        return "Reproduction test"
    if re.search(r"tests/integration/|jest|\.test\.js", e) and re.search(r"pass|ran|run|assert|fail", low):
        return "Existing test run"
    if re.search(r"vitest|\.test\.tsx", e):
        return "Frontend test"
    if "node check" in low or "node -e" in low or "contract check" in low:
        return "Contract check"
    if "seeds/" in e or "staff-list" in e:
        return "Seed file read"
    return "Code reading"


TYPE = {"BUG": "Bug", "GAP": "Gap", "IMPROVEMENT": "Improvement", "SEED_DATA": "Seed data",
        "FIXED_SINCE_AUDIT": "Bug"}
TYPE_OVERRIDE = {"F06a": "Seed data"}  # ID: type, where the verdict alone does not say
HOW_OVERRIDE = {"F06a": "Seed file read", "F79c": "Code reading", "F81d": "Code reading",
                "F24": "Code reading", "F02f": "Code reading"}

# ---------------------------------------------------------------- Change Report rows
# BY_DESIGN parts that ask MyCity's way to change an agreed decision; and every OUT_OF_SCOPE part.
AGREED = "Changes an agreed decision"
OUTSIDE = "Outside the agreed scope"
CHANGE = [
    dict(ids=["F03"], area="Finance", kind=OUTSIDE, size="L",
         ask="A finance core: invoices, receivables, bills and payables, a chart of accounts and "
             "general ledger, bank reconciliation, VAT and WHT; or an accounting system the hub posts to.",
         why="No milestone (M0 to M11, MILESTONES.md) includes accounting. Money in the hub is limited "
             "to payroll (M6), expense requests and budgets (M8) and partnership returns (M7); none "
             "keeps a ledger. Ruled out of scope by JBS Praxis, 24/11/2026.",
         cover="Build or integrate. If integrate: the accounting system chosen, what the hub posts to "
               "it (payroll journals, paid expenses, partnership returns), how often, who reconciles, "
               "and the permissions on both sides.",
         recommend="Integrate an accounting package rather than build a ledger in the hub. Scope it "
                   "after go-live."),
    dict(ids=["F04"], area="Sales and inventory", kind=OUTSIDE, size="L",
         ask="Products, stock, orders, ticket sales and revenue recorded in the hub, so revenue goals "
             "can be measured.",
         why="No milestone covers products, inventory, orders or ticket sales. Performance goals (M2) "
             "hold targets and progress; they do not record sales. Ruled out of scope by JBS Praxis, "
             "24/11/2026.",
         cover="Which revenue streams to measure, their source (the MyCity apps' own transaction data "
               "rather than typing), ticket and listing inventory, partner settlements, and which "
               "goals each figure feeds.",
         recommend="Feed revenue figures from the apps' own data into Performance goals; do not build "
                   "inventory in the hub."),
    dict(ids=["F47"], area="Mailbox", kind=OUTSIDE, size="S",
         ask="Stop the Mailbox making three failing calls on each folder visit before an account is "
             "connected.",
         why="Mailbox was offered as a change request, which MyCity declined, so it is not part of the "
             "go-live scope (JBS Praxis, 24/11/2026).",
         cover="Only if MyCity takes Mailbox up again: this fix goes in with it (check the connection "
               "first and skip the folder calls).",
         recommend="Decide whether Mailbox stays visible at go-live. If it is taken up later, include "
                   "this fix."),
    dict(ids=["F08"], area="Partnerships", kind=OUTSIDE, size="L",
         ask="Customer records, a support ticket queue and marketing campaign records.",
         why="The CRM contracted in Milestone 7 is a partner CRM (MILESTONES §12 and its Definition "
             "of done). No milestone has customers, tickets or campaigns.",
         cover="A customer record linked to app transactions and enquiries (data source and privacy "
               "basis), a ticket queue (channels, response times, assignment, statuses), campaign "
               "records feeding the Branding & Marketing KPIs, and the app integrations behind them.",
         recommend="Discuss after go-live; most of this belongs in the MyCity apps' own support tools."),
    dict(ids=["F06b"], area="People", kind=OUTSIDE, size="M",
         ask="An offboarding step that forces every record a leaver owns to a new owner before the "
             "employee is archived.",
         why="No milestone has an offboarding workflow. Records are handed over one by one on each "
             "screen, as agreed (partnerships guide §11).",
         cover="An Offboard step on Archive Record listing everything the person owns (partnership "
               "records, projects and tasks, department headship, report audiences, waiting "
               "approvals, open proposals), with a new owner required for each, in one transaction.",
         recommend="Worth doing: it prevents the stranded records found in F06. Small enough to "
                   "agree quickly."),
    dict(ids=["F01c"], area="Payroll", kind=OUTSIDE, size="M",
         ask="A per-employee exemption from pension or PAYE, with a reason and evidence.",
         why="Not part of the agreed payroll scope (MILESTONES §11 and its amendments of 08/11, 11/11 "
             "and 12/11/2026; payroll guide §13.1 items 41 to 46).",
         cover="Which exemptions apply, each with its legal source; a per-employee switch with reason, "
               "evidence document and dates; how the run and the statutory report treat it.",
         recommend="Confirm first whether any MyCity employee qualifies. If none does, decline."),
    dict(ids=["F09d", "F09b"], area="Expenses", kind=OUTSIDE + "; " + AGREED, size="M",
         ask="A supplier list kept by Finance with checked bank details, payees picked from it; an "
             "invoice required above a set amount; purchase orders for capital spending.",
         why="The contract has payee bank details typed on each request (MILESTONES §13 amended "
             "04/11/2026). The invoice is asked for but optional, and there is no amount threshold "
             "anywhere, by decision (expenses guide §6.1 rule 2; 04/11/2026). Purchase orders are "
             "procurement, part of the finance core ruled out of scope.",
         cover="A supplier register (name, verified bank details, who may edit it, audit), picking a "
               "payee from it on New Request; an invoice rule by amount; a purchase order record, its "
               "approval, and matching an invoice and payment to it.",
         recommend="The supplier list is the most useful part; consider it with the finance core "
                   "decision (CR for F03)."),
    dict(ids=["F09a"], area="Expenses", kind=AGREED, size="S",
         ask="Stop staff adding new bank names that everyone is then offered.",
         why="Typing a bank not on the list was agreed at the 11/11/2026 review, because the list "
             "cannot hold every microfinance bank (expenses guide §6.1 rule 7).",
         cover="Offer only the common list plus banks named on requests that were paid, so a name "
               "typed on a draft, cancelled or rejected request is never suggested to others.",
         recommend="Accept: small, and it keeps the agreed freedom to type a bank."),
    dict(ids=["F54a"], area="Partnerships", kind=AGREED, size="S",
         ask="Make a duplicate organisation require an explicit Create Anyway with a reason.",
         why="A duplicate is warned, never blocked, by decision (partnerships guide §6.2, §11), so a "
             "genuinely separate organisation with a similar name can be added.",
         cover="A Create Anyway confirmation with a reason, kept on the record's history.",
         recommend="Accept if MyCity wants it; it pairs with the better matching in F54b."),
    dict(ids=["F56a", "F56c"], area="Expenses", kind=AGREED, size="M",
         ask="Reserve a request's amount as Committed when it is sent, and refuse spending against a "
             "project with no budget.",
         why="Committed counts approved requests only, and a project's budget is optional, both by "
             "decision (expenses guide §6.6 rules 2 and 6; handoff decision 7). The department "
             "budget check applies to every request.",
         cover="A Pending column (or Committed from sending), and a rule that a project with spending "
               "must have a budget, with what happens to existing projects.",
         recommend="Pair with F56b (warn on the form). A separate Pending figure is clearer than "
                   "changing what Committed means."),
    dict(ids=["F57a"], area="Expenses", kind=AGREED, size="S",
         ask="Send a manager's own expense request to their line manager before Operations & People.",
         why="A request from anyone who manages people goes straight to Operations & People, as "
             "agreed at the 04/11/2026 review (handoff m8-expenses §1 item 1).",
         cover="A change to the expense route on Settings · Approvals; no code, since the route is "
               "configurable (A11).",
         recommend="MyCity's call; it can be changed on Settings · Approvals without a release."),
    dict(ids=["F43c"], area="My Workspace", kind=AGREED, size="S",
         ask="Require a due date and a budget when a project becomes Active.",
         why="Due dates and budgets are optional on projects by decision (workspace guide §3 step 14; "
             "expenses guide §6.6 rule 6); budgets are set on Expenses · Projects.",
         cover="A required due date on Active projects; a budget rule as in the F56 row.",
         recommend="Require the due date only; leave budgets to Expenses."),
    dict(ids=["F79a"], area="My Workspace", kind=AGREED, size="S",
         ask="Confirm before completing a project that still has open tasks, and offer to close or "
             "move them.",
         why="Completing a project leaves its open tasks in place and it can be reopened, by decision "
             "(workspace guide §11).",
         cover="A confirmation naming how many tasks stay open.",
         recommend="Accept: small and avoids surprise."),
    dict(ids=["F28b"], area="My Workspace", kind=AGREED, size="S",
         ask="Require a reason the moment a task goes overdue.",
         why="The reason is asked when an overdue task is opened or completed, and Analytics reports "
             "overdue tasks by reason (workspace guide §3 step 12; A24).",
         cover="A daily reminder to the assignee asking for a reason, and the reason's place on the "
               "task.",
         recommend="Decline for now; the Overdue Tasks rule on Queries & Sanctions covers repeat "
                   "lateness (see MyCity Actions)."),
    dict(ids=["F71"], area="Recruitment", kind=AGREED, size="S",
         ask="Block or require a reason when a candidate moves on with a failed screening, an "
             "unfinished test or no interview card.",
         why="Free movement between stages was agreed for M4: scores and tests inform the recruiter "
             "but never move or block anyone (recruitment guide §6.3, §6.4; MILESTONES §9).",
         cover="A required reason (kept in Stage History) when a card leaves a stage with an "
               "unfinished sitting, no submitted interview card or a screening score under a "
               "threshold MyCity sets.",
         recommend="Accept the reason prompt; do not block moves."),
    dict(ids=["F72b"], area="Recruitment", kind=AGREED, size="S",
         ask="Require a pay range on every vacancy.",
         why="A band is optional on purpose, since some roles are advertised before pay is settled "
             "(recruitment guide §6.1, §10.1). Offers outside a set band are flagged to the approver.",
         cover="A required band on publishing, or a minimum wage floor on offers once MyCity enters "
               "the minimum wage on Payroll · Configurations.",
         recommend="Take the minimum wage floor on offers instead of a required band."),
    dict(ids=["F15a"], area="Policies", kind=AGREED, size="S",
         ask="One combined, non-blocking prompt for every policy waiting to be acknowledged.",
         why="One acknowledgement sheet per owed policy, one after another, was agreed (policies "
             "guide P3, §6.7).",
         cover="A combined prompt linking to Self-Service · Policy Updates, and how long before the "
               "screen is blocked.",
         recommend="MyCity's call; either works."),
    dict(ids=["F60b"], area="Self-Service", kind=AGREED, size="M",
         ask="Count a Saturday as half a day of leave.",
         why="Leave is counted in working days and Saturday is a working day (A22; ess guide §6).",
         cover="Half-day leave units, the leave balance precision, and every report that shows days.",
         recommend="Only if MyCity's written leave policy says so."),
    dict(ids=["F66b"], area="Attendance", kind=AGREED, size="S",
         ask="Refuse or flag a clock-in after the shift has ended.",
         why="A late arrival is recorded, never refused, and counted late from the start time "
             "(attendance guide §1.1 T2, §6.14).",
         cover="A new Attendance policy rule (flag or refuse) and its exception.",
         recommend="Flag, do not refuse, if MyCity wants it."),
    dict(ids=["F34a"], area="Praxis AI", kind=AGREED, size="S",
         ask="Stop showing staff the tokens and naira cost of their own AI questions.",
         why="Each person sees what their own questions cost, as decided when History was built "
             "(praxis-ai guide §1.1 decision 7, §10.1; 22/10/2026).",
         cover="Show the Tokens and Cost columns and Your Spend to AI Control holders only.",
         recommend="Accept: small, and cost belongs on AI Control."),
]

# ---------------------------------------------------------------- MyCity Actions rows
CLIENT = OrderedDict([
    ("F01a", dict(area="Payroll", golive="Yes, before the first statutory run",
                  action="Enter each statutory item that applies to MyCity (PAYE bands, pension, NHF, "
                         "NSITF, ITF, rent relief, minimum wage) with its legal source, then switch "
                         "Advanced Payroll on from a date.",
                  where="Payroll · Configurations (Operations & People)",
                  why="No PAYE, pension or other statutory deduction is made until the figures are "
                      "entered and Advanced Payroll is on.")),
    ("F01d", dict(area="Payroll", golive="No (staging only)",
                  action="Replace the test PAYE band (₦0 to ₦200 at 10%) typed on staging with the real "
                         "table, or remove it while it is not in force.",
                  where="Payroll · Configurations; Settings · Audit Log shows who saved it",
                  why="It was typed by hand during testing; it does not exist on production.")),
    ("F11b", dict(area="Payroll", golive="Yes",
                  action="Decide whether everyone paid must have bank details. If so, switch on Bank "
                         "Details Required and enter the bank and account number for each person.",
                  where="Payroll · Configurations; People · Employees",
                  why="With the switch off, a missing bank account is only a warning on the run.")),
    ("F06d", dict(area="People", golive="Yes",
                  action="Hand the departed Operations & People lead's remaining items to new owners: "
                         "department head, two projects, two report audiences and her role.",
                  where="People · Departments; My Workspace · Projects; Home · Reports; Settings · "
                        "Roles & Permissions",
                  why="Items still held by a leaver wait on someone who will not act on them.")),
    ("F07d", dict(area="Partnerships", golive="Yes",
                  action="Add an agreement template for Vendor and each other category you sign, by "
                         "pasting your existing agreement into Tidy With AI.",
                  where="Partnerships · Categories · Templates",
                  why="A category with no template cannot produce its agreement in the hub.")),
    ("F21b", dict(area="Partnerships", golive="Recommended",
                  action="Review the 13 pipeline stages: rename, merge or retire any you do not use "
                         "(for example Active Partnership).",
                  where="Partnerships · Categories · Pipeline Settings",
                  why="The stage list is MyCity's own tracker; unused stages make the pipeline look "
                      "longer than it is.")),
    ("F62b", dict(area="Partnerships", golive="Yes, if AI is used at go-live",
                  action="Fund MyCity's Anthropic account, enter its key and confirm the Gemini key, "
                         "then retry proposal PRO-0003.",
                  where="Settings · Integrations",
                  why="AI proposals and other AI features cannot run without a funded provider "
                      "account.")),
    ("F14a", dict(area="Attendance", golive="Yes (the decision); sanctions after adoption",
                  action="Decide who must clock in, run a two-week adoption push, then publish an "
                         "Attendance policy version that switches lateness and absence rules on.",
                  where="Knowledge Hub · Policies · Attendance",
                  why="Most staff are not clocking in yet; switching sanctions on first would punish "
                      "a habit not yet formed.")),
    ("F66c", dict(area="Attendance", golive="Recommended",
                  action="Decide whether remote staff must clock in from an approved home location; "
                         "if so, switch Home Location on in a new policy version.",
                  where="Knowledge Hub · Policies · Attendance",
                  why="While Home Location is off, remote clock-ins read Not Checked.")),
    ("F73b", dict(area="Offers", golive="Yes",
                  action="Fill Working Hours on each offer, or change the letter's fallback sentence "
                         "to the company's working week.",
                  where="Recruitment · Offers (New Offer); Offer Settings · letter wording",
                  why="A blank Working Hours field prints the Monday to Friday sentence from your "
                      "sample letter.")),
    ("F28c", dict(area="Queries & Sanctions", golive="No, after go-live once tasks are in use",
                  action="Set the Overdue Tasks rule's threshold (how many overdue tasks in how many "
                         "days) and press Activate.",
                  where="Queries & Sanctions · Rules",
                  why="The rule exists but stays in Draft until MyCity sets it.")),
    ("F29b", dict(area="Performance", golive="Recommended",
                  action="Replace each [TBC] and \"approved ceiling\" target in the Q4 plan with its "
                         "final figure (Change Target on the key result, approved by the CEO).",
                  where="Performance · Goals (the key result's sheet)",
                  why="The headline score cannot be read against provisional targets.")),
    ("F80a", dict(area="Recruitment", golive="Yes, before interviews are rated",
                  action="On each vacancy, drop or replace the interview traits that do not fit the "
                         "role; optionally change the Default Traits.",
                  where="Recruitment · Vacancies (the vacancy's Questions); Careers Settings",
                  why="Every vacancy starts from the same ten standard traits.")),
    ("F82b", dict(area="People", golive="Yes",
                  action="Confirm which department the CTO belongs to (Technology & Back-office Ops on "
                         "the staff list, General Management on staging) and set his record to match.",
                  where="People · Employees (the CTO's record)",
                  why="His scorecard and his record name different departments.")),
    ("F82e", dict(area="Performance", golive="No (staging only)",
                  action="Delete the test goals \"test run\" and \"another test\".",
                  where="Performance · Goals (Delete Goal on the goal's sheet)",
                  why="They were typed on staging during testing; production starts clean.")),
    ("F43a", dict(area="My Workspace", golive="No (staging only)",
                  action="Move the tasks of each duplicate project to the one you keep, then complete "
                         "the spare.",
                  where="My Workspace · Projects",
                  why="The duplicates were typed on staging during testing; production starts "
                      "clean.")),
    ("F17", dict(area="Home", golive="No (staging only)",
                 action="Delete the QA and test records typed on staging if they get in the way.",
                 where="The screen each was created on (for example Performance · Goals, Delete Goal)",
                 why="They are not in our seed files; production starts clean.")),
])

# ---------------------------------------------------------------- compile
SEV_ORDER = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
LABEL = {"BUG": "Bug", "GAP": "Gap", "IMPROVEMENT": "Improvement", "FIXED_SINCE_AUDIT": "Fixed since audit",
         "BY_DESIGN": "By design", "SEED_DATA": "Seed data", "CLIENT_ACTION": "MyCity action",
         "NOT_REPRODUCED": "Not reproduced", "OUT_OF_SCOPE": "Out of scope"}


def finding_of(pid):
    return re.match(r"F\d+", pid).group()


def clean(s):
    return s.replace("—", ",").replace("–", " to ").strip()


change_ids = {i for c in CHANGE for i in c["ids"]}
for pid, b in blocks.items():
    v = b["Verdict"]
    if v == "OUT_OF_SCOPE" and pid not in change_ids:
        sys.exit(f"{pid} is OUT_OF_SCOPE but has no Change Report row")
    if v == "CLIENT_ACTION" and pid not in CLIENT:
        sys.exit(f"{pid} is CLIENT_ACTION but has no MyCity Actions row")
for i in change_ids:
    if i not in blocks or blocks[i]["Verdict"] not in ("OUT_OF_SCOPE", "BY_DESIGN"):
        sys.exit(f"Change Report row {i} is not an OUT_OF_SCOPE or BY_DESIGN block")

# tracker: open first by severity, then fixed; module and finding order inside
track = [b for b in blocks.values() if b["Verdict"] in TYPE]
track.sort(key=lambda b: (b["Verdict"] == "FIXED_SINCE_AUDIT", SEV_ORDER[b["Severity"]],
                          module_of(b)[0], int(finding_of(b["ID"])[1:]), b["ID"]))
tracker, dest = [], defaultdict(list)  # dest: part ID -> (bucket, ref)
for n, b in enumerate(track, start=1):
    ref = f"BG-{n:03d}"
    mod, ms, owner = module_of(b)
    row = dict(ref=ref, audit=b["ID"], module=mod, type=TYPE_OVERRIDE.get(b["ID"], TYPE[b["Verdict"]]),
               severity=b["Severity"], title=clean(b["Title"]), found=clean(b["Evidence"]),
               how=HOW_OVERRIDE.get(b["ID"]) or how_verified(b["Evidence"]), fix=clean(b["Fix"]), scope=clean(b["Scope ref"]),
               milestone=ms, effort=b["Effort"], owner=owner, mycity=clean(b["For MyCity"]))
    if b["Verdict"] == "FIXED_SINCE_AUDIT":
        pr, day = fixed_in(b)
        row.update(done="✓", pr=pr, fixed_on=day)
        dest[b["ID"]].append(("Fixed since audit", ref))
    else:
        dest[b["ID"]].append(("Bugs & Gaps", ref))
    tracker.append(row)

change = []
for n, c in enumerate(CHANGE, start=1):
    ref = f"CR-{n:02d}"
    change.append(dict(ref=ref, audit=", ".join(c["ids"]), area=c["area"], kind=c["kind"], ask=c["ask"],
                       why=c["why"], cover=c["cover"], size=c["size"], recommend=c["recommend"]))
    for i in c["ids"]:
        dest[i].append(("Change Report", ref))

client = []
for n, (pid, k) in enumerate(CLIENT.items(), start=1):
    if pid not in blocks or blocks[pid]["Verdict"] != "CLIENT_ACTION":
        sys.exit(f"MyCity Actions row {pid} is not a CLIENT_ACTION block")
    ref = f"MA-{n:02d}"
    client.append(dict(ref=ref, audit=pid, **k))
    dest[pid].append(("MyCity Actions", ref))

for pid, b in blocks.items():
    if not dest[pid]:
        if b["Verdict"] == "BY_DESIGN":
            dest[pid].append(("Closed: works as agreed", ""))
        elif b["Verdict"] == "NOT_REPRODUCED":
            dest[pid].append(("Closed: not reproduced", ""))
        else:
            sys.exit(f"{pid} ({b['Verdict']}) went nowhere")

BUCKETS = ["Bugs & Gaps", "Fixed since audit", "Change Report", "MyCity Actions",
           "Closed: works as agreed", "Closed: not reproduced"]
parts_of = defaultdict(list)
for pid in blocks:
    parts_of[finding_of(pid)].append(pid)
recon = []
for fid, fx in FINDINGS.items():
    pids = sorted(parts_of.get(fid, []))
    if not pids:
        if "--partial" in sys.argv:
            continue
        sys.exit(f"{fid} has no verdict")
    places = [d for p in pids for d in dest[p]]
    primary = min(places, key=lambda d: BUCKETS.index(d[0]))[0]
    refs = defaultdict(list)
    for bucket, ref in places:
        if ref and ref not in refs[bucket]:
            refs[bucket].append(ref)
    went = primary + (": " + ", ".join(refs[primary]) if refs[primary] else "")
    also = [r for bkt in BUCKETS if bkt != primary for r in refs[bkt]]
    if also:
        went += "; also " + ", ".join(also)
    labels = list(OrderedDict.fromkeys(LABEL[blocks[p]["Verdict"]] for p in pids))
    verdict = labels[0] if len(labels) == 1 else "Split: " + ", ".join(labels)
    if len(pids) == 1:
        b = blocks[pids[0]]
        reason = clean(b["Title"]) + ". " + clean(b["For MyCity"])
    else:
        reason = " ".join(f"{p}: {clean(blocks[p]['Title'])} ({LABEL[blocks[p]['Verdict']]})." for p in pids)
    recon.append(dict(audit=fid, title=fx["title"], auditor_sev=fx["sev"], verdict=verdict, went=went,
                      reason=reason.strip()))

meta = dict(
    subtitle="JBS Praxis response to MyCity's QA audit of staging (16 and 17/11/2026, findings F01 to F83). "
             "Every finding was tested or read against the code on main (697f1db) between 24 and "
             "25/11/2026.",
    howto=[
        "Bugs & Gaps is the fix tracker: only verified bugs, gaps, improvements and seed-data fixes. "
        "JBS Praxis ticks Fixed ✓ with the PR and date as each fix merges; MyCity records its retest.",
        "Items fixed after the audit are already ticked, with the PR that fixed them, so MyCity can retest them.",
        "To be Discussed (Change Report) holds requests outside the signed milestones, or that change a "
        "decision already agreed. Nothing there is built until a change request is agreed.",
        "MyCity Actions are setup, data and policy tasks the hub already supports and MyCity does itself.",
        "Audit Reconciliation shows every one of the 83 findings, our verdict and the sheet it went to.",
    ],
    sheets=[
        ("Bugs & Gaps", "The fix tracker. Severity is ours, for go-live. Yellow columns are edited as work proceeds."),
        ("To be Discussed (Change Report)", "Out of scope, or a change to an agreed decision. Record the decision in the yellow columns."),
        ("MyCity Actions", "Settings, data and decisions for MyCity, with where in the hub and whether it is needed before go-live."),
        ("Audit Reconciliation", "F01 to F83, MyCity's title and severity, our verdict, and where each went."),
    ],
    footnotes=[
        "Verdicts: Bug (wrong against its own specification), Gap (in scope, not built or incomplete), "
        "Improvement (works as specified, worth improving), Seed data (our demonstration or staff data), "
        "By design (works as agreed, with the decision cited), Not reproduced (tested, the claim did not hold).",
        "A finding may be split into parts (for example F09a, F09b) where only part of it is a bug.",
        "Staging data typed by testers does not reach production: production starts with MyCity's real "
        "staff list only.",
    ],
    recon_buckets=[(b, b + "*") for b in BUCKETS],
)

json.dump(dict(tracker=tracker, change=change, client=client, recon=recon, meta=meta),
          open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
open_ch = [t for t in tracker if t.get("done") != "✓" and t["severity"] in ("Critical", "High")]
print(f"{len(blocks)} verdict parts -> tracker {len(tracker)} (open Critical+High {len(open_ch)}), "
      f"change {len(change)}, client {len(client)}, recon {len(recon)}")

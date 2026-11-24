"""Builds the MyCity QA audit response workbook from items.json.

items.json holds four lists:
  tracker   - verified bugs, gaps, improvements and seed-data fixes (JBS Praxis fixes these)
  change    - out of scope, or a change to an agreed decision (To be Discussed)
  client    - setup, data and policy tasks MyCity does in the hub
  recon     - one row per audit finding F01..F83: our verdict and where it went
"""
import json
import sys
from datetime import date
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.formatting.rule import FormulaRule, CellIsRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter
from openpyxl.comments import Comment

SRC, OUT = sys.argv[1], sys.argv[2]
data = json.load(open(SRC, encoding="utf-8"))

FONT = "Arial"
BRAND = "0B2A22"      # MyCity deep green
ACCENT = "F5D547"     # MyCity yellow
INK = "14211C"
MUTED = "5D6B66"
LINE = "D5DDD9"
ZEBRA = "F6F8F7"
INPUT = "FFF7D1"      # pale yellow: columns the team edits
DONE = "E3F2E8"

SEV_FILL = {"Critical": ("B42318", "FDE8E7"), "High": ("B54708", "FEF0E1"),
            "Medium": ("8A6D00", "FFF7D1"), "Low": ("1F6F43", "E6F4EC")}

thin = Side(style="thin", color=LINE)
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="top", wrap_text=True)


def f(size=10, bold=False, color=INK, italic=False):
    return Font(name=FONT, size=size, bold=bold, color=color, italic=italic)


def fill(hex_):
    return PatternFill("solid", start_color=hex_, end_color=hex_)


def title_block(ws, title, subtitle, width_cols):
    ws["A1"] = title
    ws["A1"].font = f(15, True, "FFFFFF")
    ws["A2"] = subtitle
    ws["A2"].font = f(10, False, "DCE6E2")
    for r in (1, 2):
        for c in range(1, width_cols + 1):
            ws.cell(row=r, column=c).fill = fill(BRAND)
    ws.row_dimensions[1].height = 26
    ws.row_dimensions[2].height = 30
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=width_cols)


def header_row(ws, row, headers, input_cols=()):
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=row, column=i, value=h)
        c.font = f(10, True, "FFFFFF" if i not in input_cols else INK)
        c.fill = fill("1D4A3D" if i not in input_cols else ACCENT)
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="left")
        c.border = BOX
    ws.row_dimensions[row].height = 32


def body(ws, start_row, rows, center_cols=(), input_cols=()):
    for r_off, values in enumerate(rows):
        r = start_row + r_off
        for c_idx, v in enumerate(values, start=1):
            cell = ws.cell(row=r, column=c_idx, value=v)
            cell.font = f(10)
            cell.alignment = CENTER if c_idx in center_cols else WRAP
            cell.border = BOX
            if c_idx in input_cols:
                cell.fill = fill(INPUT)
            elif r_off % 2 == 1:
                cell.fill = fill(ZEBRA)


def widths(ws, ws_widths):
    for i, w in enumerate(ws_widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def est_height(values, col_widths, line_h=12.5, min_h=30):
    lines = 1
    for v, w in zip(values, col_widths):
        if v is None:
            continue
        s = str(v)
        chars = max(int(w * 1.15), 8)
        n = sum(max(1, -(-len(part) // chars)) for part in s.split("\n"))
        lines = max(lines, n)
    return max(min_h, min(lines * line_h + 6, 400))


def severity_format(ws, col_letter, first, last):
    rng = f"{col_letter}{first}:{col_letter}{last}"
    for sev, (fg, bg) in SEV_FILL.items():
        ws.conditional_formatting.add(
            rng, CellIsRule(operator="equal", formula=[f'"{sev}"'],
                            fill=fill(bg), font=Font(name=FONT, bold=True, color=fg)))


wb = Workbook()

# ------------------------------------------------------------------ Bugs & Gaps
T = data["tracker"]
ws = wb.active
ws.title = "Bugs & Gaps"
TH = ["Ref", "Audit ref", "Module", "Type", "Severity", "Title", "What we verified",
      "How verified", "Fix to make", "Scope basis", "Milestone", "Effort", "Owner",
      "Fixed ✓", "Fixed in (PR)", "Fixed on", "MyCity retest", "Note for MyCity"]
TW = [8, 9, 14, 12, 10, 34, 52, 16, 46, 26, 9, 7, 8, 8, 13, 11, 11, 46]
INPUTS_T = (13, 14, 15, 16, 17)
title_block(ws, "Bugs & Gaps · fix tracker",
            "Verified against the code on main (697f1db, 24/11/2026). Tick 'Fixed ✓' when the fix is merged, "
            "with its PR and date. MyCity fills 'MyCity retest'. Yellow columns are the ones to edit.",
            len(TH))
HR = 4
header_row(ws, HR, TH, input_cols=INPUTS_T)
rows = []
for i, it in enumerate(T, start=1):
    rows.append([it["ref"], it["audit"], it["module"], it["type"], it["severity"], it["title"],
                 it["found"], it["how"], it["fix"], it["scope"], it["milestone"], it["effort"],
                 it.get("owner", ""), it.get("done", ""), it.get("pr", ""),
                 date.fromisoformat(it["fixed_on"]) if it.get("fixed_on") else "",
                 "", it["mycity"]])
body(ws, HR + 1, rows, center_cols=(1, 2, 4, 5, 8, 11, 12, 13, 14, 15, 16, 17), input_cols=INPUTS_T)
last_t = HR + len(rows)
for r_off, values in enumerate(rows):
    ws.row_dimensions[HR + 1 + r_off].height = est_height(values, TW)
    c = ws.cell(row=HR + 1 + r_off, column=16)
    c.number_format = "dd/mm/yyyy"
widths(ws, TW)
ws.freeze_panes = ws.cell(row=HR + 1, column=7)
ws.auto_filter.ref = f"A{HR}:{get_column_letter(len(TH))}{last_t}"
severity_format(ws, "E", HR + 1, last_t)
# a ticked row turns green
ws.conditional_formatting.add(
    f"A{HR+1}:{get_column_letter(len(TH))}{last_t}",
    FormulaRule(formula=[f'$N{HR+1}="✓"'], fill=fill(DONE)))
dv_tick = DataValidation(type="list", formula1='"✓"', allow_blank=True,
                         error="Choose ✓ or leave blank", errorTitle="Fixed")
dv_retest = DataValidation(type="list", formula1='"Pass,Fail,Not retested"', allow_blank=True)
dv_type = DataValidation(type="list", formula1='"Bug,Gap,Improvement,Seed data"', allow_blank=False)
dv_sev = DataValidation(type="list", formula1='"Critical,High,Medium,Low"', allow_blank=False)
dv_owner = DataValidation(type="list", formula1='"GE,TB,LA,AJ"', allow_blank=True)
dv_date = DataValidation(type="date", operator="greaterThan", formula1="46000", allow_blank=True,
                         error="Enter a date (dd/mm/yyyy)")
for dv, col in ((dv_tick, "N"), (dv_retest, "Q"), (dv_type, "D"), (dv_sev, "E"),
                (dv_owner, "M"), (dv_date, "P")):
    ws.add_data_validation(dv)
    dv.add(f"{col}{HR+1}:{col}{last_t + 200}")
ws.cell(row=HR, column=14).comment = Comment("Pick ✓ once the fix is merged. The row turns green "
                                             "and the Summary counts it.", "JBS Praxis")
ws.sheet_view.zoomScale = 90

# ------------------------------------------------------------------ Change Report
C = data["change"]
wc = wb.create_sheet("To be Discussed (Change Report)")
CH = ["CR ref", "Audit ref", "Area", "Kind", "What MyCity asked for", "Why it is outside the agreed scope",
      "What a change request would cover", "Rough size", "Our recommendation", "Decision", "Decided on", "Notes"]
CW = [8, 10, 16, 16, 44, 50, 46, 9, 40, 14, 11, 30]
INPUTS_C = (10, 11, 12)
title_block(wc, "To be Discussed · Change Report",
            "Requests outside the signed milestones (MILESTONES.md), or that change a decision already agreed "
            "with MyCity. Nothing here is built until a change request is agreed. Yellow columns record the decision.",
            len(CH))
header_row(wc, HR, CH, input_cols=INPUTS_C)
rows = [[c["ref"], c["audit"], c["area"], c["kind"], c["ask"], c["why"], c["cover"], c["size"],
         c["recommend"], "To discuss", "", ""] for c in C]
body(wc, HR + 1, rows, center_cols=(1, 2, 4, 8, 10, 11), input_cols=INPUTS_C)
last_c = HR + len(rows)
for r_off, values in enumerate(rows):
    wc.row_dimensions[HR + 1 + r_off].height = est_height(values, CW)
    wc.cell(row=HR + 1 + r_off, column=11).number_format = "dd/mm/yyyy"
widths(wc, CW)
wc.freeze_panes = wc.cell(row=HR + 1, column=5)
wc.auto_filter.ref = f"A{HR}:{get_column_letter(len(CH))}{last_c}"
dv_dec = DataValidation(type="list", formula1='"To discuss,Accept as change request,Decline,Defer to phase 2"',
                        allow_blank=False)
wc.add_data_validation(dv_dec)
dv_dec.add(f"J{HR+1}:J{last_c + 100}")
wc.sheet_view.zoomScale = 90

# ------------------------------------------------------------------ MyCity Actions
K = data["client"]
wk = wb.create_sheet("MyCity Actions")
KH = ["Ref", "Audit ref", "Area", "Action for MyCity", "Where in the hub", "Why it matters",
      "Before go-live?", "Done ✓", "Notes"]
KW = [8, 10, 16, 52, 30, 44, 10, 8, 30]
INPUTS_K = (8, 9)
title_block(wk, "MyCity Actions · setup, data and decisions",
            "The hub already supports these. They need MyCity's own settings, data or a policy decision, "
            "made by a person with the right role. Tick 'Done ✓' when complete.", len(KH))
header_row(wk, HR, KH, input_cols=INPUTS_K)
rows = [[k["ref"], k["audit"], k["area"], k["action"], k["where"], k["why"], k["golive"], "", ""] for k in K]
body(wk, HR + 1, rows, center_cols=(1, 2, 7, 8), input_cols=INPUTS_K)
last_k = HR + len(rows)
for r_off, values in enumerate(rows):
    wk.row_dimensions[HR + 1 + r_off].height = est_height(values, KW)
widths(wk, KW)
wk.freeze_panes = wk.cell(row=HR + 1, column=4)
wk.auto_filter.ref = f"A{HR}:{get_column_letter(len(KH))}{last_k}"
dv_tick2 = DataValidation(type="list", formula1='"✓"', allow_blank=True)
wk.add_data_validation(dv_tick2)
dv_tick2.add(f"H{HR+1}:H{last_k + 100}")
wk.conditional_formatting.add(f"A{HR+1}:{get_column_letter(len(KH))}{last_k}",
                              FormulaRule(formula=[f'$H{HR+1}="✓"'], fill=fill(DONE)))
wk.sheet_view.zoomScale = 90

# ------------------------------------------------------------------ Audit Reconciliation
R = data["recon"]
wr = wb.create_sheet("Audit Reconciliation")
RH = ["Audit ref", "MyCity's title", "MyCity severity", "Our verdict", "Where it went", "Reason, in short"]
RW = [10, 52, 11, 20, 26, 80]
title_block(wr, "Audit Reconciliation · every finding accounted for",
            "Each of MyCity's 83 findings (F01 to F83) with our verdict after testing, and the sheet and "
            "reference it now lives under.", len(RH))
header_row(wr, HR, RH)
rows = [[x["audit"], x["title"], x["auditor_sev"], x["verdict"], x["went"], x["reason"]] for x in R]
body(wr, HR + 1, rows, center_cols=(1, 3, 4))
last_r = HR + len(rows)
for r_off, values in enumerate(rows):
    wr.row_dimensions[HR + 1 + r_off].height = est_height(values, RW)
widths(wr, RW)
wr.freeze_panes = wr.cell(row=HR + 1, column=3)
wr.auto_filter.ref = f"A{HR}:{get_column_letter(len(RH))}{last_r}"
severity_format(wr, "C", HR + 1, last_r)
wr.sheet_view.zoomScale = 90

# ------------------------------------------------------------------ Summary (first sheet)
s = wb.create_sheet("Summary", 0)
SW = [30, 13, 13, 13, 13, 4, 30, 13, 13]
widths(s, SW)
title_block(s, "MyCity Hub · QA audit response",
            data["meta"]["subtitle"], 9)
row = 4
s.cell(row=row, column=1, value="How to use this workbook").font = f(12, True, BRAND)
row += 1
for line in data["meta"]["howto"]:
    c = s.cell(row=row, column=1, value=line)
    c.font = f(10)
    c.alignment = Alignment(wrap_text=True, vertical="top")
    s.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
    s.row_dimensions[row].height = 28
    row += 1

TB = "'Bugs & Gaps'"
rng = lambda col: f"{TB}!${col}${HR+1}:${col}${last_t + 200}"

row += 1
s.cell(row=row, column=1, value="Fix progress (Bugs & Gaps)").font = f(12, True, BRAND)
row += 1
kpis = [
    ("Items to fix", f'=COUNTA({rng("A")})', "0"),
    ("Fixed ✓", f'=COUNTIF({rng("N")},"✓")', "0"),
    ("Still open", None, "0"),
    ("% fixed", None, "0%"),
    ("Open Critical + High (go-live blockers)",
     f'=COUNTIFS({rng("E")},"Critical",{rng("N")},"<>✓")+COUNTIFS({rng("E")},"High",{rng("N")},"<>✓")', "0"),
]
kpi_row0 = row
for i, (label, formula, fmt) in enumerate(kpis):
    s.cell(row=row, column=1, value=label).font = f(10, True)
    if label == "Still open":
        formula = f"=B{kpi_row0}-B{kpi_row0+1}"
    if label == "% fixed":
        formula = f"=IF(B{kpi_row0}=0,0,B{kpi_row0+1}/B{kpi_row0})"
    c = s.cell(row=row, column=2, value=formula)
    c.number_format = fmt
    c.font = f(11, True, BRAND)
    c.alignment = Alignment(horizontal="right")
    for col in (1, 2):
        s.cell(row=row, column=col).border = BOX
    row += 1

row += 1
s.cell(row=row, column=1, value="By severity").font = f(12, True, BRAND)
row += 1
for i, h in enumerate(["Severity", "Total", "Fixed ✓", "Open", "% fixed"], start=1):
    c = s.cell(row=row, column=i, value=h)
    c.font = f(10, True, "FFFFFF")
    c.fill = fill("1D4A3D")
    c.border = BOX
row += 1
sev_first = row
for sev in ["Critical", "High", "Medium", "Low"]:
    s.cell(row=row, column=1, value=sev)
    s.cell(row=row, column=2, value=f'=COUNTIF({rng("E")},A{row})')
    s.cell(row=row, column=3, value=f'=COUNTIFS({rng("E")},A{row},{rng("N")},"✓")')
    s.cell(row=row, column=4, value=f"=B{row}-C{row}")
    s.cell(row=row, column=5, value=f"=IF(B{row}=0,0,C{row}/B{row})")
    s.cell(row=row, column=5).number_format = "0%"
    fg, bg = SEV_FILL[sev]
    s.cell(row=row, column=1).font = Font(name=FONT, bold=True, color=fg)
    s.cell(row=row, column=1).fill = fill(bg)
    for col in range(1, 6):
        s.cell(row=row, column=col).border = BOX
        if col > 1:
            s.cell(row=row, column=col).font = f(10)
    row += 1
s.cell(row=row, column=1, value="Total").font = f(10, True)
for col, L in ((2, "B"), (3, "C"), (4, "D")):
    s.cell(row=row, column=col, value=f"=SUM({L}{sev_first}:{L}{row-1})").font = f(10, True)
s.cell(row=row, column=5, value=f"=IF(B{row}=0,0,C{row}/B{row})").number_format = "0%"
s.cell(row=row, column=5).font = f(10, True)
for col in range(1, 6):
    s.cell(row=row, column=col).border = BOX
sev_total_row = row

# By type, at the right of severity
trow = sev_first - 1
for i, h in enumerate(["Type", "Total", "Fixed ✓"], start=7):
    c = s.cell(row=trow, column=i, value=h)
    c.font = f(10, True, "FFFFFF")
    c.fill = fill("1D4A3D")
    c.border = BOX
for j, typ in enumerate(["Bug", "Gap", "Improvement", "Seed data"]):
    r = sev_first + j
    s.cell(row=r, column=7, value=typ)
    s.cell(row=r, column=8, value=f'=COUNTIF({rng("D")},G{r})')
    s.cell(row=r, column=9, value=f'=COUNTIFS({rng("D")},G{r},{rng("N")},"✓")')
    for col in (7, 8, 9):
        s.cell(row=r, column=col).border = BOX
        s.cell(row=r, column=col).font = f(10)

row += 2
s.cell(row=row, column=1, value="By module").font = f(12, True, BRAND)
row += 1
for i, h in enumerate(["Module", "Total", "Fixed ✓", "Open", "Critical + High open"], start=1):
    c = s.cell(row=row, column=i, value=h)
    c.font = f(10, True, "FFFFFF")
    c.fill = fill("1D4A3D")
    c.border = BOX
    c.alignment = Alignment(wrap_text=True)
s.row_dimensions[row].height = 28
row += 1
modules = sorted({it["module"] for it in T})
mod_first = row
for m in modules:
    s.cell(row=row, column=1, value=m)
    s.cell(row=row, column=2, value=f'=COUNTIF({rng("C")},A{row})')
    s.cell(row=row, column=3, value=f'=COUNTIFS({rng("C")},A{row},{rng("N")},"✓")')
    s.cell(row=row, column=4, value=f"=B{row}-C{row}")
    s.cell(row=row, column=5, value=(f'=COUNTIFS({rng("C")},A{row},{rng("E")},"Critical",{rng("N")},"<>✓")'
                                     f'+COUNTIFS({rng("C")},A{row},{rng("E")},"High",{rng("N")},"<>✓")'))
    for col in range(1, 6):
        s.cell(row=row, column=col).border = BOX
        s.cell(row=row, column=col).font = f(10)
    row += 1

row += 1
s.cell(row=row, column=1, value="Where MyCity's 83 findings went").font = f(12, True, BRAND)
row += 1
for i, h in enumerate(["Outcome", "Findings"], start=1):
    c = s.cell(row=row, column=i, value=h)
    c.font = f(10, True, "FFFFFF")
    c.fill = fill("1D4A3D")
    c.border = BOX
row += 1
RR = "'Audit Reconciliation'"
rec_rng = f"{RR}!$E${HR+1}:$E${last_r}"
rec_first = row
for label, crit in data["meta"]["recon_buckets"]:
    s.cell(row=row, column=1, value=label)
    s.cell(row=row, column=2, value=f'=COUNTIF({rec_rng},"{crit}")')
    for col in (1, 2):
        s.cell(row=row, column=col).border = BOX
        s.cell(row=row, column=col).font = f(10)
    row += 1
s.cell(row=row, column=1, value="Total findings").font = f(10, True)
s.cell(row=row, column=2, value=f"=SUM(B{rec_first}:B{row-1})").font = f(10, True)
for col in (1, 2):
    s.cell(row=row, column=col).border = BOX
row += 1
s.cell(row=row, column=1, value="Check: findings in the audit").font = f(9, False, MUTED, True)
s.cell(row=row, column=2, value=f"=COUNTA({RR}!$A${HR+1}:$A${last_r})").font = f(9, False, MUTED, True)
row += 2
s.cell(row=row, column=1, value="Sheets").font = f(12, True, BRAND)
row += 1
for name, desc in data["meta"]["sheets"]:
    s.cell(row=row, column=1, value=name).font = f(10, True)
    c = s.cell(row=row, column=2, value=desc)
    c.font = f(10)
    c.alignment = Alignment(wrap_text=True, vertical="top")
    s.merge_cells(start_row=row, start_column=2, end_row=row, end_column=9)
    s.row_dimensions[row].height = 28
    row += 1
row += 1
for line in data["meta"]["footnotes"]:
    c = s.cell(row=row, column=1, value=line)
    c.font = f(9, False, MUTED, True)
    c.alignment = Alignment(wrap_text=True, vertical="top")
    s.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
    s.row_dimensions[row].height = 26
    row += 1
s.sheet_view.showGridLines = False

for sheet in wb.worksheets:
    sheet.sheet_properties.tabColor = {"Summary": BRAND, "Bugs & Gaps": "B54708",
                                       "To be Discussed (Change Report)": "6941C6",
                                       "MyCity Actions": "1F6F43",
                                       "Audit Reconciliation": "5D6B66"}[sheet.title]
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.print_options.gridLines = False
    if sheet.title != "Summary":
        sheet.print_title_rows = f"{HR}:{HR}"

wb.save(OUT)
print("saved", OUT, "tracker", len(T), "change", len(C), "client", len(K), "recon", len(R))

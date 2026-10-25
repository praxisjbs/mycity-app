"use strict";
/**
 * The User Guide's chapters: read from Markdown, cut to a reader (docs/guides/user-guide.md §6).
 *
 * One copy, used by the API (src/modules/user_guide), the in-browser mock and the gate
 * (scripts/check/user-guide.js), so what the gate checks is what the API sends and what a
 * laptop shows.
 *
 *   const { parseChapter, filterChapter } = require("@mycity/contract/guide");
 *   const { chapter, problems } = parseChapter(markdown, "people.md");
 *   const mine = filterChapter(chapter, { screen: (m, t) => ..., holds: (need) => ... });
 *
 * The Markdown is a small, strict subset (§6.2): front matter; `##` sections and `###` tasks
 * with `{#slug key=value}` attributes; paragraphs; numbered steps; bullets; `>` notes; pipe
 * tables; `![alt](shot:id)` pictures; fenced `shot <id>` specs for the picture script. Inline:
 * **bold** (a name on screen), *italic*, `code`, [links](/module?tab=x | #slug | https://...).
 * Anything else is a problem, so a chapter never renders differently from how it was written.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHOT_ID = SLUG;
const SCREEN = /^([a-z_]+)\/([a-z0-9-]+)$/;
const DEVICES = ["desktop", "phone"];
/** The demo accounts a picture is taken as; `guest` is nobody signed in (the sign-in screen, a link). */
const ACCOUNTS = ["operations", "ceo", "manager", "staff", "admin", "guest"];
/** Why the lock screen shows (app/src/auth/LockSheet.tsx): Session Locked, Session Ended, Signed Out. */
const LOCKS = ["idle", "time", "ended"];
const ROLES = ["Everyone", "Line Managers", "People & HR", "Administrators"];
const NOTE_TONES = { "Tip:": "tip", "Important:": "important" };
const FRONT_KEYS = ["title", "module", "order", "milestones", "summary", "covers", "kind", "icon"];
const SECTION_KEYS = ["screen", "needs", "role", "icon"];
const TASK_KEYS = ["needs"];

/* ------------------------------------------------------------------ *
 * Needs: who may receive a part of the guide
 * ------------------------------------------------------------------ */

/**
 * `"people create, cap home.team, manager, ceo"` as a list of needs.
 * @param {string} text
 * @returns {{needs: Array<{kind: "grant", module: string, action: string}|{kind: "cap", code: string}|{kind: "manager"}|{kind: "ceo"}>, problems: string[]}}
 */
function parseNeeds(text) {
  const needs = [];
  const problems = [];
  for (const raw of String(text).split(",")) {
    const part = raw.trim();
    if (!part) continue;
    if (part === "manager" || part === "ceo") {
      needs.push({ kind: part });
      continue;
    }
    const cap = /^cap ([a-z_]+\.[a-z_]+)$/.exec(part);
    if (cap) {
      needs.push({ kind: "cap", code: cap[1] });
      continue;
    }
    const grant = /^([a-z_]+) ([a-z]+)$/.exec(part);
    if (grant) {
      needs.push({ kind: "grant", module: grant[1], action: grant[2] });
      continue;
    }
    problems.push(`needs "${part}" reads "<module> <action>", "cap <code>", "manager" or "ceo"`);
  }
  return { needs, problems };
}

/* ------------------------------------------------------------------ *
 * Inline text
 * ------------------------------------------------------------------ */

/**
 * A run of text with its marks. `href` is a screen ("/people?tab=employees"), a section of the
 * guide ("#people-add-employee") or a page outside ("https://..."); null for plain text.
 */
const span = (text, marks = {}) => ({
  text,
  bold: Boolean(marks.bold),
  italic: Boolean(marks.italic),
  code: Boolean(marks.code),
  href: marks.href || null,
});

/**
 * Inline Markdown as spans, with the pictures it names taken out.
 * @param {string} text
 * @returns {{spans: ReturnType<typeof span>[], shots: Array<{id: string, alt: string}>, problems: string[]}}
 */
function parseInline(text) {
  const spans = [];
  const shots = [];
  const problems = [];
  let plain = "";
  const flush = () => {
    if (plain) spans.push(span(plain));
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let m;
    if (rest[0] === "\\" && rest.length > 1) {
      plain += rest[1];
      i += 2;
    } else if ((m = /^!\[([^\]]*)\]\(shot:([^)\s]+)\)/.exec(rest))) {
      flush();
      if (!SHOT_ID.test(m[2])) problems.push(`picture "${m[2]}" is not a shot id (lower-case words and hyphens)`);
      if (!m[1].trim()) problems.push(`picture "${m[2]}" needs its text: ![What it shows](shot:${m[2]})`);
      shots.push({ id: m[2], alt: m[1].trim() });
      i += m[0].length;
    } else if (rest.startsWith("![")) {
      problems.push(`a picture is written ![What it shows](shot:<id>): "${rest.slice(0, 40)}"`);
      plain += "!";
      i += 1;
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      const href = m[2];
      if (!/^(\/[a-z-]+(\?[^#\s]*)?|#[a-z0-9-]+|https:\/\/\S+|mailto:\S+)$/.test(href))
        problems.push(`link "${href}" is not a screen (/module?tab=x), a section (#slug) or an https address`);
      const inner = /^\*\*(.+)\*\*$/.exec(m[1]);
      spans.push(span(inner ? inner[1] : m[1], { href, bold: Boolean(inner) }));
      i += m[0].length;
    } else if ((m = /^\*\*([^*]+)\*\*/.exec(rest))) {
      flush();
      spans.push(span(m[1], { bold: true }));
      i += m[0].length;
    } else if ((m = /^\*([^*\s][^*]*)\*/.exec(rest))) {
      flush();
      spans.push(span(m[1], { italic: true }));
      i += m[0].length;
    } else if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      spans.push(span(m[1], { code: true }));
      i += m[0].length;
    } else {
      plain += rest[0];
      i += 1;
    }
  }
  flush();
  return { spans: mergePlain(spans), shots, problems };
}

/** Neighbouring plain runs as one. */
function mergePlain(spans) {
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && !last.bold && !last.italic && !last.code && !last.href && !s.bold && !s.italic && !s.code && !s.href) last.text += s.text;
    else out.push({ ...s });
  }
  // Text around a picture taken out of a line leaves loose spaces at the edges.
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, "");
  }
  return out.filter((s) => s.text !== "");
}

/* ------------------------------------------------------------------ *
 * Attributes: {#slug key=value key="two words"} and a line's own {needs="..."}
 * ------------------------------------------------------------------ */

function parseAttributes(text) {
  const out = { slug: null, values: {} };
  const re = /#([a-z0-9-]+)|([a-z]+)=("([^"]*)"|[^\s}]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) out.slug = m[1];
    else out.values[m[2]] = m[4] !== undefined ? m[4] : m[3];
  }
  out.leftover = text.replace(re, "").trim();
  return out;
}

/** A heading's title and its `{...}` attributes. */
function splitHeading(text) {
  const m = /^(.*?)\s*\{([^}]*)\}\s*$/.exec(text);
  if (!m) return { title: text.trim(), attrs: { slug: null, values: {}, leftover: "" } };
  return { title: m[1].trim(), attrs: parseAttributes(m[2]) };
}

/** A line that opens with `{needs="..."}`: its needs and the rest of the line. */
function lineNeeds(text) {
  const m = /^\{needs="([^"]*)"\}\s*/.exec(text);
  if (!m) return { text, needs: [], problems: [] };
  const { needs, problems } = parseNeeds(m[1]);
  return { text: text.slice(m[0].length), needs, problems };
}

/* ------------------------------------------------------------------ *
 * Shot specs: what the picture script does (scripts/guide/shoot.js)
 * ------------------------------------------------------------------ */

const TARGET = /^(button|link|tab|label|text|heading|searchbox|row|css|role)\b(.*)$/;

function parseTarget(text) {
  const m = TARGET.exec(text.trim());
  if (!m) return null;
  const kind = m[1];
  const rest = m[2].trim();
  if (kind === "searchbox") return { kind, name: null };
  if (kind === "css") return rest ? { kind, selector: rest } : null;
  if (kind === "row") return /^\d+$/.test(rest) ? { kind, index: Number(rest) } : null;
  if (kind === "role") {
    const r = /^([a-z]+)\s+"([^"]+)"$/.exec(rest);
    return r ? { kind, role: r[1], name: r[2] } : null;
  }
  const q = /^"([^"]+)"$/.exec(rest);
  return q ? { kind, name: q[1] } : null;
}

function parseShot(id, lines, at) {
  const problems = [];
  const spec = { id, open: null, as: "operations", devices: [...DEVICES], crop: "page", do: [], marks: [], sources: [], line: at };
  let list = null;
  for (const [n, raw] of lines.entries()) {
    const where = `shot ${id}, line ${at + n + 1}`;
    if (!raw.trim()) continue;
    const item = /^\s+(?:- )?(.+)$/.exec(raw);
    if (item && list) {
      const body = item[1];
      if (list === "do") {
        // A step may name one device ("phone click: ..."): the phone reaches some controls another
        // way, through a menu or Quick Actions, while the picture shows the same thing.
        const m = /^(?:(desktop|phone) )?(click|fill|press|wait|scroll|lock):\s*(.+)$/.exec(body);
        if (!m) {
          problems.push(`${where}: a do step reads "click: <target>", "fill: <target> = <text>", "press: <key>", "wait: <target>", "scroll: <target>" or "lock: <reason>", after "phone " or "desktop " for one device only`);
          continue;
        }
        const [, only, act, arg] = m;
        const before = spec.do.length;
        if (act === "press") spec.do.push({ action: "press", key: arg.trim() });
        // The lock screen, as another tab or the session's clock would bring it: idle, time or ended.
        else if (act === "lock") {
          if (LOCKS.includes(arg.trim())) spec.do.push({ action: "lock", reason: arg.trim() });
          else problems.push(`${where}: lock reads "lock: idle", "lock: time" or "lock: ended"`);
        }
        else if (act === "fill") {
          const f = /^(.+?)\s+=\s+(.*)$/.exec(arg);
          const target = f && parseTarget(f[1]);
          if (!target) problems.push(`${where}: fill reads "fill: <target> = <text>"`);
          else spec.do.push({ action: "fill", target, value: f[2] });
        } else {
          const target = parseTarget(arg);
          if (!target) problems.push(`${where}: "${arg}" is not a target (button "X", label "X", text "X", css ...)`);
          else spec.do.push({ action: act, target });
        }
        if (only && spec.do.length > before) spec.do[before].device = only;
      } else if (list === "marks") {
        const k = /^(\d+):\s*(.+?)\s*(?:\|\s*(.+))?$/.exec(body);
        const target = k && parseTarget(k[2]);
        if (!k || !target) problems.push(`${where}: a mark reads "<number>: <target> | <what it is>"`);
        else {
          if (!k[3]) problems.push(`${where}: mark ${k[1]} needs what it is, after a |`);
          spec.marks.push({ n: Number(k[1]), target, text: (k[3] || "").trim() });
        }
      } else if (list === "sources") spec.sources.push(body.trim());
      continue;
    }
    const kv = /^([a-z]+):\s*(.*)$/.exec(raw.trim());
    if (!kv) {
      problems.push(`${where}: "${raw.trim()}" is not "key: value"`);
      continue;
    }
    const [, key, value] = kv;
    list = null;
    if (key === "open") spec.open = value;
    else if (key === "as") {
      if (!ACCOUNTS.includes(value)) problems.push(`${where}: as is one of ${ACCOUNTS.join(", ")}`);
      spec.as = value;
    } else if (key === "device") {
      if (value === "both") spec.devices = [...DEVICES];
      else if (DEVICES.includes(value)) spec.devices = [value];
      else problems.push(`${where}: device is both, desktop or phone`);
    } else if (key === "crop") spec.crop = value;
    else if (key === "do" || key === "marks" || key === "sources") {
      list = key;
      if (value) problems.push(`${where}: ${key} lists its items on the lines under it`);
    } else problems.push(`${where}: unknown key "${key}"`);
  }
  if (!spec.open || !/^\/([a-z-]+)?(\?\S*)?$/.test(spec.open)) problems.push(`shot ${id}: open is the screen's address, like /people?tab=employees (or / for the sign-in screen)`);
  const ns = spec.marks.map((m) => m.n);
  if (ns.some((n, i) => n !== i + 1)) problems.push(`shot ${id}: marks are numbered 1, 2, 3 in order`);
  return { spec, problems };
}

/* ------------------------------------------------------------------ *
 * A chapter
 * ------------------------------------------------------------------ */

function parseFront(lines) {
  const front = {};
  const problems = [];
  if (lines[0] !== "---") return { front, body: 0, problems: ["a chapter opens with its front matter between --- lines"] };
  let end = 1;
  for (; end < lines.length && lines[end] !== "---"; end += 1) {
    const m = /^([a-z]+):\s*(.*)$/.exec(lines[end]);
    if (!m) problems.push(`front matter line ${end + 1} is not "key: value"`);
    else if (!FRONT_KEYS.includes(m[1])) problems.push(`front matter: unknown key "${m[1]}"`);
    else front[m[1]] = m[2].trim();
  }
  if (end >= lines.length) problems.push("front matter is not closed with ---");
  return { front, body: end + 1, problems };
}

const splitList = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);

/**
 * One chapter file, as it was written: front matter, sections with their tasks and blocks,
 * the needs on each part, and the picture specs. Nothing is cut yet.
 * @param {string} text  the file's Markdown
 * @param {string} file  its name, for problems ("people.md")
 */
function parseChapter(text, file) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const problems = [];
  const where = (n) => `${file}:${n + 1}`;
  const { front, body, problems: frontProblems } = parseFront(lines);
  problems.push(...frontProblems.map((p) => `${file}: ${p}`));
  if (!front.title) problems.push(`${file}: front matter needs a title`);
  if (front.module && !/^[a-z_]+$/.test(front.module)) problems.push(`${file}: module is a module key, like people`);
  const kind = front.kind || "chapter";
  if (!["chapter", "quick-start"].includes(kind)) problems.push(`${file}: kind is chapter or quick-start`);
  const milestones = splitList(front.milestones);
  for (const m of milestones) if (!/^M\d{1,2}$/.test(m)) problems.push(`${file}: milestone "${m}" reads like M0, M1`);

  const chapter = {
    slug: file.replace(/\.md$/, ""),
    file,
    kind,
    title: front.title || "",
    module: front.module || null,
    order: front.order !== undefined && front.order !== "" ? Number(front.order) : null,
    icon: front.icon || null,
    summary: front.summary || "",
    milestones,
    covers: splitList(front.covers),
    intro: [],
    sections: [],
    shots: {},
  };
  if (chapter.order !== null && !Number.isFinite(chapter.order)) problems.push(`${file}: order is a number`);

  let section = null;
  let task = null;
  /** Where the next block goes: the task, else the section, else the chapter's own intro. */
  const target = () => (task ? task.blocks : section ? section.blocks : chapter.intro);
  const shotRefs = [];

  const inline = (raw, n) => {
    const r = parseInline(raw);
    problems.push(...r.problems.map((p) => `${where(n)}: ${p}`));
    for (const s of r.shots) shotRefs.push({ ...s, line: n });
    return r;
  };
  const figureOf = (shots, n) => {
    if (shots.length > 1) problems.push(`${where(n)}: one picture to a line or a step`);
    return shots[0] ? { shot: shots[0].id, alt: shots[0].alt } : null;
  };

  let i = body;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    // A picture spec: ```shot <id> ... ```
    const fence = /^```(\S*)\s*(\S*)\s*$/.exec(line);
    if (fence) {
      let end = i + 1;
      while (end < lines.length && !/^```\s*$/.test(lines[end])) end += 1;
      if (end >= lines.length) problems.push(`${where(i)}: a fenced block is not closed`);
      if (fence[1] !== "shot") problems.push(`${where(i)}: the only fenced block is a picture spec: \`\`\`shot <id>`);
      else if (!SHOT_ID.test(fence[2])) problems.push(`${where(i)}: \`\`\`shot needs the picture's id`);
      else if (chapter.shots[fence[2]]) problems.push(`${where(i)}: picture spec ${fence[2]} is written twice`);
      else {
        const { spec, problems: p } = parseShot(fence[2], lines.slice(i + 1, end), i + 1);
        problems.push(...p.map((x) => `${file}: ${x}`));
        chapter.shots[fence[2]] = spec;
      }
      i = end + 1;
      continue;
    }
    if (/^# /.test(line)) {
      problems.push(`${where(i)}: the chapter's title is its front matter's title; start sections with ##`);
      i += 1;
      continue;
    }
    const h = /^(#{2,3}) (.+)$/.exec(line);
    if (h) {
      const { title, attrs } = splitHeading(h[2]);
      const allowed = h[1] === "##" ? SECTION_KEYS : TASK_KEYS;
      if (!attrs.slug) problems.push(`${where(i)}: give the heading its slug: ${h[1]} ${title} {#a-slug}`);
      else if (!SLUG.test(attrs.slug)) problems.push(`${where(i)}: slug "${attrs.slug}" is lower-case words and hyphens`);
      if (attrs.leftover) problems.push(`${where(i)}: "${attrs.leftover}" is not an attribute`);
      for (const k of Object.keys(attrs.values)) if (!allowed.includes(k)) problems.push(`${where(i)}: ${h[1]} takes ${allowed.join(", ")}, not ${k}`);
      const { needs, problems: np } = parseNeeds(attrs.values.needs || "");
      problems.push(...np.map((p) => `${where(i)}: ${p}`));
      if (h[1] === "##") {
        let screen = null;
        if (attrs.values.screen) {
          const s = SCREEN.exec(attrs.values.screen);
          if (!s) problems.push(`${where(i)}: screen reads <module>/<tab>, like people/employees`);
          else screen = { module: s[1], tab: s[2] };
        }
        if (kind === "quick-start" && attrs.values.role && !ROLES.includes(attrs.values.role))
          problems.push(`${where(i)}: role is one of ${ROLES.join(", ")}`);
        if (kind === "quick-start" && !attrs.values.role) problems.push(`${where(i)}: a Quick Start card names its role`);
        section = { slug: attrs.slug || "", title, screen, needs, role: attrs.values.role || null, icon: attrs.values.icon || null, line: i, blocks: [], tasks: [] };
        task = null;
        chapter.sections.push(section);
      } else {
        if (!section) problems.push(`${where(i)}: a ### task sits inside a ## section`);
        task = { slug: attrs.slug || "", title, needs, line: i, blocks: [] };
        if (section) section.tasks.push(task);
      }
      i += 1;
      continue;
    }
    if (/^#{4,} /.test(line)) {
      problems.push(`${where(i)}: headings go no deeper than ### (a task)`);
      i += 1;
      continue;
    }
    // Numbered steps; indented lines continue the step above.
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && (/^\d+\. /.test(lines[i]) || (/^ {2,}\S/.test(lines[i]) && items.length))) {
        if (/^\d+\. /.test(lines[i])) items.push({ raw: lines[i].replace(/^\d+\. /, ""), line: i });
        else items[items.length - 1].raw += ` ${lines[i].trim()}`;
        i += 1;
      }
      const steps = items.map(({ raw, line: n }) => {
        const own = lineNeeds(raw);
        problems.push(...own.problems.map((p) => `${where(n)}: ${p}`));
        const r = inline(own.text, n);
        return { spans: r.spans, figure: figureOf(r.shots, n), needs: own.needs, line: n };
      });
      target().push({ kind: "steps", items: steps });
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && (/^- /.test(lines[i]) || (/^ {2,}\S/.test(lines[i]) && items.length))) {
        if (/^- /.test(lines[i])) items.push({ raw: lines[i].slice(2), line: i });
        else items[items.length - 1].raw += ` ${lines[i].trim()}`;
        i += 1;
      }
      const bullets = items.map(({ raw, line: n }) => {
        const own = lineNeeds(raw);
        problems.push(...own.problems.map((p) => `${where(n)}: ${p}`));
        const r = inline(own.text, n);
        if (r.shots.length) problems.push(`${where(n)}: a picture sits on its own line or on a step, not in a bullet`);
        return { spans: r.spans, needs: own.needs };
      });
      target().push({ kind: "bullets", items: bullets });
      continue;
    }
    if (/^> /.test(line) || line === ">") {
      let raw = "";
      const start = i;
      while (i < lines.length && (/^> /.test(lines[i]) || lines[i] === ">")) {
        raw += ` ${lines[i].replace(/^>\s?/, "")}`;
        i += 1;
      }
      const own = lineNeeds(raw.trim());
      problems.push(...own.problems.map((p) => `${where(start)}: ${p}`));
      let tone = "note";
      let said = own.text;
      for (const [lead, t] of Object.entries(NOTE_TONES)) {
        if (said.startsWith(`**${lead}**`)) {
          tone = t;
          said = said.slice(lead.length + 4).trim();
        }
      }
      const r = inline(said, start);
      if (r.shots.length) problems.push(`${where(start)}: a picture sits on its own line or on a step, not in a note`);
      target().push({ kind: "note", tone, spans: r.spans, needs: own.needs });
      continue;
    }
    if (/^\|/.test(line)) {
      const rows = [];
      const start = i;
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push({ raw: lines[i], line: i });
        i += 1;
      }
      const cells = (raw) => raw.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      if (rows.length < 3 || !/^\|(\s*:?-+:?\s*\|)+\s*$/.test(rows[1].raw)) {
        problems.push(`${where(start)}: a table has a header row, a --- row and at least one row`);
        continue;
      }
      const head = cells(rows[0].raw).map((c) => inline(c, start).spans);
      const body2 = rows.slice(2).map(({ raw, line: n }) => {
        const all = cells(raw);
        const own = lineNeeds(all[0] || "");
        problems.push(...own.problems.map((p) => `${where(n)}: ${p}`));
        all[0] = own.text;
        if (all.length !== head.length) problems.push(`${where(n)}: this row has ${all.length} cells, the header ${head.length}`);
        return { cells: all.map((c) => inline(c, n).spans), needs: own.needs };
      });
      target().push({ kind: "table", head, rows: body2 });
      continue;
    }
    if (/^ {2,}\S/.test(line) || /^\t/.test(line)) {
      problems.push(`${where(i)}: an indented line belongs under a step or a bullet`);
      i += 1;
      continue;
    }
    // A paragraph: lines until a blank line or another block.
    const start = i;
    let raw = "";
    while (i < lines.length && lines[i].trim() && !/^(#{1,6} |\d+\. |- |> |>$|\||```)/.test(lines[i])) {
      raw += ` ${lines[i].trim()}`;
      i += 1;
    }
    const own = lineNeeds(raw.trim());
    problems.push(...own.problems.map((p) => `${where(start)}: ${p}`));
    const r = inline(own.text, start);
    if (r.shots.length && r.spans.length) problems.push(`${where(start)}: a picture sits on a line of its own`);
    if (r.shots.length) target().push({ kind: "figure", figure: figureOf(r.shots, start), needs: own.needs });
    else target().push({ kind: "paragraph", spans: r.spans, needs: own.needs });
  }

  // Every picture named has its spec, and every spec is used.
  for (const ref of shotRefs) if (!chapter.shots[ref.id]) problems.push(`${where(ref.line)}: picture ${ref.id} has no \`\`\`shot ${ref.id} spec in this file`);
  for (const id of Object.keys(chapter.shots)) if (!shotRefs.some((r) => r.id === id)) problems.push(`${file}: picture spec ${id} is not shown anywhere`);
  if (!chapter.sections.length) problems.push(`${file}: a chapter has at least one ## section`);
  return { chapter, problems };
}

/* ------------------------------------------------------------------ *
 * Cutting a chapter to a reader (§6.3)
 * ------------------------------------------------------------------ */

/**
 * What a reader may receive of a chapter, in the wire shape (no needs, steps numbered after
 * cutting, links to what they may not open made plain), or null when nothing is left.
 * @param {ReturnType<typeof parseChapter>["chapter"]} chapter
 * @param {{screen: (module: string, tab: string) => boolean, holds: (need: object) => boolean}} reader
 * @param {{slugs?: Set<string>}} [known]  the slugs this reader may read across every chapter, so a link to one they may not is made plain
 */
function filterChapter(chapter, reader, known = {}) {
  const allowed = (needs) => needs.every((n) => reader.holds(n));
  const screenOk = (href) => {
    const m = /^\/([a-z-]+)(?:\?(.*))?$/.exec(href);
    if (!m) return true;
    const module = m[1].replace(/-/g, "_");
    const tab = new URLSearchParams(m[2] || "").get("tab");
    return tab ? reader.screen(module, tab) : true;
  };
  const cutSpans = (spans) =>
    spans.map((s) => {
      if (!s.href) return s;
      if (s.href.startsWith("/") && !screenOk(s.href)) return { ...s, href: null };
      if (s.href.startsWith("#") && known.slugs && !known.slugs.has(s.href.slice(1))) return { ...s, href: null };
      return s;
    });
  const pictures = new Set();
  const see = (figure) => {
    if (figure) pictures.add(figure.shot);
    return figure;
  };
  const cutBlocks = (blocks) => {
    const out = [];
    for (const b of blocks) {
      if (b.kind === "steps") {
        const items = b.items.filter((s) => allowed(s.needs));
        if (items.length) out.push({ kind: "steps", items: items.map((s, n) => ({ n: n + 1, spans: cutSpans(s.spans), figure: see(s.figure) })) });
      } else if (b.kind === "bullets") {
        const items = b.items.filter((s) => allowed(s.needs));
        if (items.length) out.push({ kind: "bullets", items: items.map((s) => cutSpans(s.spans)) });
      } else if (b.kind === "table") {
        const rows = b.rows.filter((r) => allowed(r.needs));
        if (rows.length) out.push({ kind: "table", head: b.head.map(cutSpans), rows: rows.map((r) => r.cells.map(cutSpans)) });
      } else if (!allowed(b.needs)) continue;
      else if (b.kind === "paragraph") out.push({ kind: "paragraph", spans: cutSpans(b.spans) });
      else if (b.kind === "note") out.push({ kind: "note", tone: b.tone, spans: cutSpans(b.spans) });
      else if (b.kind === "figure") out.push({ kind: "figure", figure: see(b.figure) });
    }
    return out;
  };
  const sections = [];
  for (const s of chapter.sections) {
    if (s.screen && !reader.screen(s.screen.module, s.screen.tab)) continue;
    if (!allowed(s.needs)) continue;
    const tasks = s.tasks.filter((t) => allowed(t.needs)).map((t) => ({ slug: t.slug, title: t.title, blocks: cutBlocks(t.blocks) }));
    sections.push({
      slug: s.slug,
      title: s.title,
      screen: s.screen ? `${s.screen.module}/${s.screen.tab}` : null,
      role: s.role,
      icon: s.icon,
      blocks: cutBlocks(s.blocks),
      tasks,
    });
  }
  if (!sections.length) return null;
  const legend = {};
  const devices = {};
  for (const id of pictures) {
    const spec = chapter.shots[id];
    if (!spec) continue;
    legend[id] = spec.marks.map((m) => ({ n: m.n, text: m.text }));
    devices[id] = spec.devices;
  }
  return {
    slug: chapter.slug,
    kind: chapter.kind,
    title: chapter.title,
    module: chapter.module,
    icon: chapter.icon,
    summary: chapter.summary,
    intro: cutBlocks(chapter.intro),
    sections,
    pictures: [...pictures].filter((id) => chapter.shots[id]).map((id) => ({ shot: id, devices: devices[id], legend: legend[id] })),
  };
}

/** Every slug (sections and tasks) a chapter declares. */
function slugsOf(chapter) {
  return chapter.sections.flatMap((s) => [s.slug, ...s.tasks.map((t) => t.slug)]);
}

/** Every bold name a chapter uses, with its line, for the gate's look-up in the app's source. */
function boldNames(chapter) {
  const out = [];
  const fromSpans = (spans, line) => {
    for (const s of spans) if (s.bold) out.push({ text: s.text, line });
  };
  const walkBlocks = (blocks, line) => {
    for (const b of blocks) {
      if (b.kind === "steps") for (const s of b.items) fromSpans(s.spans, s.line);
      else if (b.kind === "bullets") for (const s of b.items) fromSpans(s.spans, line);
      else if (b.kind === "table") for (const r of b.rows) for (const c of r.cells) fromSpans(c, line);
      else if (b.spans) fromSpans(b.spans, line);
    }
  };
  walkBlocks(chapter.intro, 0);
  for (const s of chapter.sections) {
    walkBlocks(s.blocks, s.line);
    for (const t of s.tasks) walkBlocks(t.blocks, t.line);
  }
  return out;
}

/** Every link a chapter makes, with its line. */
function linksOf(chapter) {
  const out = [];
  const fromSpans = (spans, line) => {
    for (const s of spans) if (s.href) out.push({ href: s.href, text: s.text, line });
  };
  const walkBlocks = (blocks, line) => {
    for (const b of blocks) {
      if (b.kind === "steps") for (const s of b.items) fromSpans(s.spans, s.line);
      else if (b.kind === "bullets") for (const s of b.items) fromSpans(s.spans, line);
      else if (b.kind === "table") for (const r of b.rows) for (const c of r.cells) fromSpans(c, line);
      else if (b.spans) fromSpans(b.spans, line);
    }
  };
  walkBlocks(chapter.intro, 0);
  for (const s of chapter.sections) {
    walkBlocks(s.blocks, s.line);
    for (const t of s.tasks) walkBlocks(t.blocks, t.line);
  }
  return out;
}

module.exports = { parseChapter, filterChapter, parseNeeds, parseInline, slugsOf, boldNames, linksOf, ROLES, DEVICES, ACCOUNTS };

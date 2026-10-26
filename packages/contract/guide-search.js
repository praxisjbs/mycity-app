"use strict";
/**
 * Searching the User Guide (docs/guides/user-guide.md §6.8): the words half of the search, and
 * how its ranking and the meaning half's are put together into one list.
 *
 * One copy, used by the API (src/modules/user_guide), ⌘K's Guide group and the in-browser mock,
 * so a laptop ranks as the server does. The meaning half (vectors) is the server's alone; here it
 * arrives as a similarity for each passage, or not at all, and the words half carries on alone.
 *
 *   const { passagesOf, passageFor } = require("@mycity/contract/guide");
 *   const engine = require("@mycity/contract/guide-search");
 *   const index = engine.indexOf(chapters.flatMap(passagesOf));
 *   const visible = engine.visibleTo(index, reader, passageFor);
 *   const hits = engine.search(index, "cant get into my account", { visible, meaning: null });
 *   // → [{ anchor: "start-forgot-password", title: "Forgot your password", step: 2, snippet: [...] }, ...]
 *
 * The words half forgives what people do when they type: plurals and tenses (a stemmer), a slip
 * of a letter or two, a word half typed, and the other words people use for the same thing
 * (SYNONYMS, MyCity's own words among them). Each passage is scored with BM25, more for a title
 * and for words in the order they were typed, and a section or task takes its best passage.
 */

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

/** Lower case, no accents or apostrophes, & as "and", anything else a space. */
function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const wordsOf = (text) => {
  const f = fold(text);
  return f ? f.split(" ") : [];
};

/** Words that say nothing about what is wanted ("how do I", "my", "can't"). */
const STOP = new Set(
  (
    "a an the and or of to in on at for with by from as is are was were be been being it its this that these those " +
    "i im ive me my mine we our us you your yours he him his she her they them their there here what which who whom " +
    "whose where when why how do does did doing done can cant cannot could couldnt would wouldnt should will wont shall " +
    "may might must am not no dont doesnt didnt isnt arent wasnt please want wants wanted need needs like just also " +
    "so if then than into onto about any some way ways one thing things there able let lets get gets got getting"
  ).split(" "),
);

/**
 * Words that help a search but are not what it is about ("take time off", "see my leave"): found,
 * they count; missing, they do not stop a passage being found.
 */
const WEAK = new Set(
  (
    "take taking took make making made see seeing seen saw use using used go going went put show showing know tell " +
    "look looking keep try view someone something anyone anything everyone everything somebody person people stuff " +
    "hub app system screen page"
  ).split(" "),
);

/* The stemmer: plurals, tenses and endings down to one stem ("approving", "approved",
   "approval" → "approv"), by M. F. Porter's published algorithm (1980). */
const CONS = "[^aeiou][^aeiouy]*";
const VOW = "[aeiouy][aeiou]*";
const M_GT_0 = new RegExp(`^(${CONS})?${VOW}${CONS}`);
const M_EQ_1 = new RegExp(`^(${CONS})?${VOW}${CONS}(${VOW})?$`);
const M_GT_1 = new RegExp(`^(${CONS})?${VOW}${CONS}${VOW}${CONS}`);
const HAS_VOWEL = new RegExp(`^(${CONS})?[aeiouy]`);
const CVC = new RegExp(`^${CONS}[aeiouy][^aeiouwxy]$`);
const STEP2 = {
  ational: "ate", tional: "tion", enci: "ence", anci: "ance", izer: "ize", bli: "ble", alli: "al", entli: "ent", eli: "e",
  ousli: "ous", ization: "ize", ation: "ate", ator: "ate", alism: "al", iveness: "ive", fulness: "ful", ousness: "ous",
  aliti: "al", iviti: "ive", biliti: "ble", logi: "log",
};
const STEP3 = { icate: "ic", ative: "", alize: "al", iciti: "ic", ical: "ic", ful: "", ness: "" };
const STEP2_RE = new RegExp(`^(.+?)(${Object.keys(STEP2).join("|")})$`);
const STEP3_RE = new RegExp(`^(.+?)(${Object.keys(STEP3).join("|")})$`);
const STEP4_RE = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;

/** A folded word's stem. Words under three letters and anything with a digit are left as they are. */
function stem(word) {
  if (word.length < 3 || /\d/.test(word)) return word;
  const y = word[0] === "y";
  let w = y ? `Y${word.slice(1)}` : word;
  let m;
  // Step 1a: plurals.
  if ((m = /^(.+?)(ss|i)es$/.exec(w))) w = m[1] + m[2];
  else if ((m = /^(.+?)([^s])s$/.exec(w))) w = m[1] + m[2];
  // Step 1b: -eed, -ed, -ing.
  if ((m = /^(.+?)eed$/.exec(w))) {
    if (M_GT_0.test(m[1])) w = w.slice(0, -1);
  } else if ((m = /^(.+?)(ed|ing)$/.exec(w)) && HAS_VOWEL.test(m[1])) {
    w = m[1];
    if (/(at|bl|iz)$/.test(w)) w += "e";
    else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
    else if (CVC.test(w)) w += "e";
  }
  // Step 1c: -y after a vowel in the stem.
  if ((m = /^(.+?)y$/.exec(w)) && HAS_VOWEL.test(m[1])) w = `${m[1]}i`;
  // Steps 2 to 4: longer endings.
  if ((m = STEP2_RE.exec(w)) && M_GT_0.test(m[1])) w = m[1] + STEP2[m[2]];
  if ((m = STEP3_RE.exec(w)) && M_GT_0.test(m[1])) w = m[1] + STEP3[m[2]];
  if ((m = STEP4_RE.exec(w))) {
    if (M_GT_1.test(m[1])) w = m[1];
  } else if ((m = /^(.+?)(s|t)(ion)$/.exec(w)) && M_GT_1.test(m[1] + m[2])) w = m[1] + m[2];
  // Step 5: a final -e, and -ll.
  if ((m = /^(.+?)e$/.exec(w)) && (M_GT_1.test(m[1]) || (M_EQ_1.test(m[1]) && !CVC.test(m[1])))) w = m[1];
  if (/ll$/.test(w) && M_GT_1.test(w)) w = w.slice(0, -1);
  return y ? `y${w.slice(1)}` : w;
}

/**
 * Words people use for the same thing, each group one meaning. A phrase in a group (`time off`)
 * is matched as a phrase. MyCity's own words sit beside the guide's (`off day`, `resumption`).
 * A writer who finds a search that misses adds the reader's word to its group.
 */
const SYNONYMS = [
  ["sign in", "log in", "login", "logon", "signin", "get in", "get into", "access my account"],
  ["sign out", "log out", "logout", "log off", "signout"],
  ["password", "passcode", "passkey", "pin"],
  ["forgot", "forget", "forgotten", "reset", "lost", "recover"],
  ["employee", "staff", "worker", "colleague", "personnel", "member of staff", "new hire", "new person"],
  ["manager", "line manager", "supervisor", "boss", "team lead", "head of department"],
  ["leave", "time off", "vacation", "off day", "day off", "days off", "absence", "annual leave"],
  ["sick", "ill", "illness", "medical", "hospital"],
  ["pay", "salary", "wage", "wages", "payslip", "pay slip", "payroll", "paid", "earnings", "remuneration"],
  ["attendance", "clock in", "clock out", "check in", "check out", "punch", "resumption"],
  ["late", "lateness", "tardy"],
  ["approve", "approval", "accept", "sign off", "authorise", "authorize", "endorse"],
  ["reject", "decline", "refuse", "deny", "turn down"],
  ["delete", "remove", "erase", "get rid of", "deactivate"],
  ["add", "create", "set up", "setup", "onboard"],
  ["edit", "change", "update", "modify", "amend", "correct", "fix"],
  ["find", "search", "look up", "lookup", "locate", "look for"],
  ["picture", "photo", "image", "avatar", "profile picture", "selfie", "screenshot"],
  ["phone", "mobile", "cell", "smartphone", "android", "iphone"],
  ["computer", "desktop", "laptop", "pc"],
  ["email", "mail", "e mail", "inbox", "mailbox"],
  ["notification", "alert", "bell", "reminder"],
  ["role", "permission", "rights", "privilege", "grant", "access level"],
  ["department", "unit", "division"],
  ["task", "todo", "to do", "assignment", "action item"],
  ["goal", "objective", "target", "kpi"],
  ["review", "appraisal", "evaluation", "assessment", "feedback"],
  ["query", "disciplinary", "warning", "sanction", "discipline", "query letter"],
  ["expense", "claim", "reimbursement", "refund", "receipt", "petty cash"],
  ["policy", "rule", "handbook", "procedure", "sop"],
  ["announcement", "notice", "news", "broadcast", "memo", "circular"],
  ["document", "file", "upload", "attachment", "attach"],
  ["bank", "account number", "bank details", "nuban"],
  ["address", "location", "where i live", "home address"],
  ["birthday", "date of birth", "dob"],
  ["next of kin", "emergency contact"],
  ["device", "biometric", "fingerprint", "terminal"],
  ["worksite", "site", "office", "branch"],
  ["schedule", "roster", "shift", "rota", "work hours", "working hours"],
  ["organogram", "org chart", "organisation chart", "organization chart", "hierarchy", "reporting line", "reports to"],
  ["dark mode", "theme", "night mode", "light mode"],
  ["text size", "font size", "bigger text", "smaller text"],
  ["install", "add to home screen", "download the app", "install app"],
  ["voice note", "voice", "audio", "microphone", "dictate", "dictation", "speak", "record"],
  ["praxis ai", "assistant", "chatbot", "ai", "ask ai"],
  ["spend", "spending", "cost", "budget", "price", "cap"],
  ["settings", "preferences", "configuration", "options"],
  ["integration", "connection", "api key", "provider"],
  ["calendar", "meeting", "event", "appointment"],
  ["community", "chat", "post", "feed", "message"],
  ["exit", "resign", "resignation", "terminate", "termination", "sack", "dismiss", "offboard"],
  ["start date", "resumption date", "joining date", "hire date", "date joined"],
  ["profile", "my details", "personal details", "personal information", "bio"],
  ["help", "guide", "manual", "instructions", "tutorial"],
  ["lock", "locked", "locked out", "session ended", "session locked"],
];

/* ------------------------------------------------------------------ *
 * The index
 * ------------------------------------------------------------------ */

/** What the meaning index embeds for a passage: where it sits, what it says, its picture's words. */
const meaningText = (passage) => [passage.context, passage.text, passage.also].filter(Boolean).join("\n");

/** How much a word of the section or task a passage sits in counts against one it says... */
const CONTEXT_WEIGHT = 0.3;
/** ...and a word of its chapter's title, which every passage of the chapter shares. */
const CHAPTER_WEIGHT = 0.15;
/** A title found counts this much more than a line of text. */
const TITLE_BOOST = 1.8;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * The words index of every passage (packages/contract/guide.js passagesOf): each one's stems, the
 * stems' document frequencies, and every word the guide uses, for typos and words half typed.
 * Built once; a reader's search scores only the passages they may read. Each passage's `id` is
 * its place in the list.
 * @param {Array<object>} list  every chapter's passages, in the chapters' order
 */
function indexOf(list) {
  const passages = list.map((p, id) => ({ ...p, id }));
  const docs = [];
  const df = new Map();
  const vocab = new Map(); // folded word → { stem, df }
  let total = 0;
  let counted = 0;
  for (const p of passages) {
    const words = wordsOf(`${p.text} ${p.also || ""}`);
    const stems = words.map(stem);
    // Where it sits: a title sits in its section (a task's) or nowhere else (a section's).
    const path = p.kind === "title" ? (p.task ? [p.section_title] : []) : [p.section_title, p.task_title];
    const pathWords = path.filter(Boolean).flatMap(wordsOf);
    const chapterWords = wordsOf(p.chapter_title);
    const doc = { passage: p, stems, context: pathWords.map(stem), chapter: chapterWords.map(stem), len: stems.length };
    docs[p.id] = doc;
    // A whole section or task is the meaning index's alone: its words are its passages' already.
    if (p.kind === "whole") continue;
    // How rare a word is counts only what passages say, not the titles many of them sit under.
    for (const s of new Set(stems)) df.set(s, (df.get(s) || 0) + 1);
    for (const w of new Set([...words, ...pathWords, ...chapterWords])) {
      const v = vocab.get(w);
      if (v) v.df += 1;
      else vocab.set(w, { stem: stem(w), df: 1 });
    }
    total += doc.len;
    counted += 1;
  }
  const synonyms = SYNONYMS.map((group) => group.map((phrase) => wordsOf(phrase).map(stem)));
  return { docs, df, vocab, synonyms, n: counted, avgLen: counted ? total / counted : 1, passages };
}

/**
 * The passages this reader may read, by id, with the step's number as they read it.
 * @param {ReturnType<typeof indexOf>} index
 * @param {{screen: Function, holds: Function}} reader
 * @param {(passage: object, reader: object) => ({step: number|null}|null)} passageFor  guide.js's
 * @returns {Map<number, {step: number|null}>}
 */
function visibleTo(index, reader, passageFor) {
  const out = new Map();
  for (const p of index.passages) {
    const v = passageFor(p, reader);
    if (v) out.set(p.id, v);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The query
 * ------------------------------------------------------------------ */

/** At most this many words of a search are read. */
const MAX_WORDS = 12;
const TYPO_WEIGHT = [1, 0.75, 0.5];
const PREFIX_WEIGHT = 0.7;
const SYNONYM_WEIGHT = 0.65;

/** One letter added, dropped, changed or two swapped, counted up to `max`; more is max + 1. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const change = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + change);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d;
      if (d < best) best = d;
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j += 1) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

const sameSeq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * A search as concepts: each word (or phrase a synonym group knows) with the ways a passage may
 * say it: the word itself, the group's other words, the guide's words a slip away, and, for the
 * last word, the guide's words it starts.
 */
function parseQuery(index, q) {
  const raw = wordsOf(q).slice(0, MAX_WORDS);
  const stems = raw.map(stem);
  const concepts = [];
  let i = 0;
  while (i < raw.length) {
    // The longest phrase of a synonym group starting here, up to four words.
    let found = null;
    for (let len = Math.min(4, raw.length - i); len >= 1 && !found; len -= 1) {
      const seq = stems.slice(i, i + len);
      for (const group of index.synonyms) {
        if (group.some((ph) => sameSeq(ph, seq))) {
          found = { len, seq, group };
          break;
        }
      }
    }
    if (found && (found.len > 1 || !STOP.has(raw[i]))) {
      const variants = [{ stems: found.seq, weight: 1 }];
      // The group's first word is the one the guide uses; the rest count a little less.
      found.group.forEach((ph, k) => {
        if (!sameSeq(ph, found.seq)) variants.push({ stems: ph, weight: k === 0 ? SYNONYM_WEIGHT : SYNONYM_WEIGHT - 0.1 });
      });
      concepts.push({ words: raw.slice(i, i + found.len), variants });
      i += found.len;
      continue;
    }
    concepts.push({ words: [raw[i]], variants: [{ stems: [stems[i]], weight: 1 }], stop: STOP.has(raw[i]), weak: WEAK.has(raw[i]) });
    i += 1;
  }
  // A search of nothing but small words is still searched for them.
  const kept = concepts.every((c) => c.stop) ? concepts : concepts.filter((c) => !c.stop);
  const last = kept[kept.length - 1];
  for (const c of kept) {
    if (c.words.length !== 1) continue;
    const word = c.words[0];
    const known = index.df.has(c.variants[0].stems[0]);
    // A slip: only for a word the guide does not use.
    if (!known && word.length >= 4 && !/\d/.test(word)) {
      const max = word.length >= 8 ? 2 : 1;
      const near = [];
      for (const [w, v] of index.vocab) {
        const d = distance(word, w, max);
        if (d <= max) near.push({ stem: v.stem, d, df: v.df });
      }
      near.sort((a, b) => a.d - b.d || b.df - a.df);
      const seen = new Set();
      for (const n of near) {
        if (seen.has(n.stem) || seen.size >= 3) continue;
        seen.add(n.stem);
        c.variants.push({ stems: [n.stem], weight: TYPO_WEIGHT[n.d] });
      }
    }
    // A word still being typed: the guide's words it starts, the commonest first.
    if (c === last && word.length >= 3 && !/\d/.test(word)) {
      const starts = [];
      for (const [w, v] of index.vocab) if (w.length > word.length && w.startsWith(word)) starts.push(v);
      starts.sort((a, b) => b.df - a.df);
      const seen = new Set(c.variants.map((v) => v.stems.join(" ")));
      for (const v of starts) {
        if (seen.has(v.stem) || seen.size >= 10) continue;
        seen.add(v.stem);
        c.variants.push({ stems: [v.stem], weight: PREFIX_WEIGHT });
      }
    }
  }
  // Weak words count when found; they are needed only when nothing else was typed. A word the
  // guide never uses, nor anything a slip or a prefix away, cannot be found, so it cannot be needed
  // either ("apply for leave" is a search for leave).
  const known = (c) => c.variants.some((v) => v.stems.every((x) => index.df.has(x)));
  const strong = kept.some((c) => !c.weak && known(c));
  for (const c of kept) {
    c.optional = strong && (Boolean(c.weak) || !known(c));
    c.idf = idf(index, c.variants[0].stems);
  }
  return { concepts: kept, folded: raw.join(" "), stems: kept.flatMap((c) => c.words.map(stem)) };
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/** How often a run of stems appears in order in a list of stems. */
function countIn(list, seq) {
  let n = 0;
  for (let i = 0; i + seq.length <= list.length; i += 1) if (seq.every((s, k) => list[i + k] === s)) n += 1;
  return n;
}

/**
 * Where a run of stems is found in a passage: its weighted count (what it says, then the section
 * or task it sits in, then its chapter) and how fully that finds the word (1 when it says it).
 */
function whereFound(doc, seq) {
  const own = countIn(doc.stems, seq);
  const path = countIn(doc.context, seq);
  const chapter = countIn(doc.chapter, seq) ? 1 : 0;
  const tf = own + CONTEXT_WEIGHT * path + CHAPTER_WEIGHT * chapter;
  return { tf, fully: own ? 1 : path ? 0.8 : chapter ? 0.6 : 0 };
}

function idf(index, seq) {
  const meaningful = seq.filter((s) => index.df.has(s));
  if (!meaningful.length) return 0;
  const df = Math.min(...meaningful.map((s) => index.df.get(s)));
  return Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
}

/**
 * One passage's score for a query, and the stems it was found by (for the snippet's marks).
 * Every concept must be found for a search of one or two; half of them for a longer one, or when
 * `relaxed` (no passage held every word of a short search).
 */
function scoreDoc(index, doc, query, relaxed = false) {
  let sum = 0;
  let covered = 0;
  const matched = new Set();
  const norm = 1 - BM25_B + BM25_B * (doc.len / index.avgLen);
  for (const c of query.concepts) {
    let best = 0;
    let by = null;
    let fully = 0;
    for (const v of c.variants) {
      const f = whereFound(doc, v.stems);
      const tf = f.tf;
      if (!tf) continue;
      // Another word for it never counts for more than the word typed would.
      const own = c.idf > 0 ? Math.min(c.idf, idf(index, v.stems)) : idf(index, v.stems);
      const s = v.weight * (v.weight === 1 ? idf(index, v.stems) : own) * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm));
      if (s > best) {
        best = s;
        by = v;
        fully = f.fully;
      }
    }
    if (by) {
      if (!c.optional) covered += fully;
      sum += best;
      for (const s of by.stems) matched.add(s);
    }
  }
  const n = query.concepts.filter((c) => !c.optional).length;
  if (!n || !covered) return null;
  // Every word must be found for a search of one or two (a title may hold one); half for more.
  const coverage = covered / n;
  if (n <= 2 && !relaxed ? coverage < 0.75 : coverage < 0.5) return null;
  let score = sum * coverage * coverage;
  if (doc.passage.kind === "title") score *= TITLE_BOOST;
  // The words in the order they were typed, in what the passage says.
  if (query.stems.length > 1 && countIn(doc.stems, query.stems) > 0) score *= 1.4;
  return { score, matched };
}

/** The meaning half: a passage at least this similar to the search is a candidate... */
const MEANING_FLOOR = 0.32;
/** ...and only while it is within this much of the most similar passage. */
const MEANING_BAND = 0.1;
/** Reciprocal rank fusion's constant: lower favours the top of each list more. */
const RRF_K = 20;

/**
 * Every section and task this reader may read that answers a search, best first. `meaning` is
 * each passage's similarity to the search (cosine, from the vectors), or null when the meaning
 * index is not there (AI off, not indexed yet, the mock): then the words alone decide.
 * @param {ReturnType<typeof indexOf>} index
 * @param {string} q
 * @param {{visible: Map<number, {step: number|null}>, meaning?: Map<number, number>|null}} opts
 */
function search(index, q, { visible, meaning = null }) {
  const query = parseQuery(index, q);
  const anchors = new Map();
  const at = (p) => {
    let a = anchors.get(p.anchor);
    if (!a) {
      a = { anchor: p.anchor, first: p.id, words: [], meaning: [] };
      anchors.set(p.anchor, a);
    }
    return a;
  };
  // A short search no passage holds every word of ("apply for leave") is searched again for half.
  for (const relaxed of [false, true]) {
    if (!query.concepts.length || anchors.size) break;
    for (const [id] of visible) {
      const doc = index.docs[id];
      if (!doc || doc.passage.kind === "whole") continue;
      const s = scoreDoc(index, doc, query, relaxed);
      if (s) at(doc.passage).words.push({ id, ...s });
    }
  }
  if (meaning && meaning.size) {
    let top = 0;
    for (const [id, sim] of meaning) if (visible.has(id) && sim > top) top = sim;
    const floor = Math.max(MEANING_FLOOR, top - MEANING_BAND);
    for (const [id, sim] of meaning) {
      if (!visible.has(id) || sim < floor) continue;
      const p = index.docs[id] && index.docs[id].passage;
      if (p) at(p).meaning.push({ id, sim });
    }
  }
  const list = [...anchors.values()];
  for (const a of list) {
    a.words.sort((x, y) => y.score - x.score);
    a.meaning.sort((x, y) => y.sim - x.sim);
    const rest = a.words.slice(1).reduce((t, w) => t + w.score, 0);
    a.wordScore = a.words.length ? a.words[0].score + Math.min(rest, a.words[0].score) * 0.15 : 0;
    a.sim = a.meaning.length ? a.meaning[0].sim : 0;
  }
  const byWords = list.filter((a) => a.wordScore > 0).sort((x, y) => y.wordScore - x.wordScore);
  const byMeaning = list.filter((a) => a.sim > 0).sort((x, y) => y.sim - x.sim);
  // A description (three words or more) leans on meaning; a word or two on the words themselves.
  const meaningWeight = query.concepts.length >= 3 ? 1 : 0.6;
  byWords.forEach((a, r) => (a.score = 1 / (RRF_K + r + 1)));
  byMeaning.forEach((a, r) => (a.score = (a.score || 0) + meaningWeight / (RRF_K + r + 1)));
  const title = (a) => fold(index.docs[a.first].passage.task_title || index.docs[a.first].passage.section_title);
  for (const a of list) {
    const t = title(a);
    if (query.folded && t === query.folded) a.score += 1;
    else if (query.folded && t.startsWith(query.folded)) a.score += 0.05;
  }
  return list
    .filter((a) => a.score > 0)
    .sort((x, y) => y.score - x.score || x.first - y.first)
    .map((a) => hitOf(index, a, query, visible));
}

/* ------------------------------------------------------------------ *
 * A hit: what a result shows
 * ------------------------------------------------------------------ */

/** A snippet is at most this many characters, around the first word found. */
const SNIPPET = 200;

/** A passage's words as runs, the ones the search found marked. */
function marked(text, stems) {
  const runs = [];
  const re = /[A-Za-z0-9À-ɏ'’]+|[^A-Za-z0-9À-ɏ'’]+/g;
  let m;
  while ((m = re.exec(text))) {
    const word = fold(m[0]);
    const hit = Boolean(word) && /[a-z0-9]/.test(word) && !STOP.has(word) && stems.has(stem(word.replace(/ /g, "")));
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += m[0];
    else runs.push({ text: m[0], hit });
  }
  return runs;
}

/** The runs cut to SNIPPET characters around the first mark, with … where it was cut. */
function windowed(runs) {
  const text = runs.map((r) => r.text).join("");
  if (text.length <= SNIPPET) return runs;
  let pos = 0;
  let first = 0;
  for (const r of runs) {
    if (r.hit) {
      first = pos;
      break;
    }
    pos += r.text.length;
  }
  let start = Math.max(0, first - 60);
  if (start > 0) {
    const space = text.lastIndexOf(" ", start);
    start = space > 0 ? space + 1 : start;
  }
  let end = Math.min(text.length, start + SNIPPET);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    end = space > start ? space : end;
  }
  const out = [];
  pos = 0;
  for (const r of runs) {
    const a = Math.max(start, pos);
    const b = Math.min(end, pos + r.text.length);
    if (b > a) out.push({ text: r.text.slice(a - pos, b - pos), hit: r.hit });
    pos += r.text.length;
  }
  if (start > 0) out.unshift({ text: "…", hit: false });
  if (end < text.length) out.push({ text: "…", hit: false });
  return out;
}

function hitOf(index, a, query, visible) {
  const first = index.docs[a.first].passage;
  const shown = (id) => {
    const k = index.docs[id].passage.kind;
    return k !== "title" && k !== "whole";
  };
  // The line shown: the best line found by its words, else by its meaning, else the first line.
  const byWords = a.words.find((w) => shown(w.id));
  const byMeaning = a.meaning.find((m) => shown(m.id));
  let id = byWords ? byWords.id : byMeaning ? byMeaning.id : null;
  const found = id !== null;
  if (id === null) {
    for (const [vid] of visible) {
      const p = index.docs[vid].passage;
      if (p.anchor === a.anchor && shown(vid)) {
        id = vid;
        break;
      }
    }
  }
  const p = id !== null ? index.docs[id].passage : null;
  const stems = new Set();
  for (const w of a.words) for (const s of w.matched) stems.add(s);
  if (!stems.size) for (const s of query.stems) if (!STOP.has(s)) stems.add(s);
  const step = found && p && p.kind === "step" ? visible.get(id).step : null;
  return {
    anchor: a.anchor,
    kind: first.task ? "task" : "section",
    chapter: first.chapter,
    chapter_title: first.chapter_title,
    section: first.section,
    section_title: first.section_title,
    title: first.task_title || first.section_title,
    screen: first.screen ? `${first.screen.module}/${first.screen.tab}` : null,
    step,
    snippet: p ? windowed(marked(p.text, stems)) : [],
    by: a.words.length && a.meaning.length ? "both" : a.words.length ? "words" : "meaning",
    score: a.score,
  };
}

/**
 * What a section or task says to this reader, line by line, with its steps numbered as they read
 * them: the passages an answer is written from.
 * @returns {string[]}
 */
function linesOf(index, anchor, visible) {
  const out = [];
  for (const [id, v] of visible) {
    const p = index.docs[id].passage;
    if (p.anchor !== anchor || p.kind === "whole" || p.kind === "title") continue;
    out.push(p.kind === "step" ? `Step ${v.step}: ${p.text}` : p.text);
  }
  return out;
}

module.exports = {
  fold,
  stem,
  wordsOf,
  distance,
  meaningText,
  indexOf,
  visibleTo,
  parseQuery,
  search,
  linesOf,
  SYNONYMS,
  STOP,
  WEAK,
  MEANING_FLOOR,
  MEANING_BAND,
};

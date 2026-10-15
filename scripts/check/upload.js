#!/usr/bin/env node
"use strict";
/**
 * Gate 18, every file goes through the upload engine (FRONTEND_GUIDE §8,
 * MILESTONES §3; CLAUDE.md: files through the upload engine and the vault).
 *
 * The upload field shows progress, refuses a wrong type or size before it
 * sends a byte, resumes, and hands the form a document_id. A raw file input
 * does none of that and stores nothing in the vault. This static scan of
 * packages/ui/src, app/src and public-app/src refuses a file input outside
 * packages/ui/src/form/ (where the upload field lives) and the #18 upload
 * files still in the apps (LEGACY entries in check/components.js moving with
 * the upload engine, PR 3):
 *
 *   - a JSX attribute type="file" (also type={"file"}, type={'file'})
 *   - a DOM-built one: `input.type = "file"`, `setAttribute("type", "file")`
 *
 * Usage: node scripts/check/upload.js     exit 0 ok, 1 problems
 */
const { scan, frontendFiles, read, lineOf } = require("./lib/sources");
const { LEGACY } = require("./components");

const UPLOAD_HOME = /^packages\/ui\/src\/form\//;
const LEGACY_UPLOADS = new Set(LEGACY.filter(([, , pr]) => /upload engine/.test(pr)).map(([file]) => file));

/** Pure: file inputs in a source file, as [{ index, what }]. Comments are skipped. */
function findFileInputs(src) {
  const { code } = scan(src);
  const out = [];
  const patterns = [
    [/(?<![\w.$-])type\s*=\s*(?:\{\s*)?(["'`])file\1/g, 'type="file"'],
    [/\.type\s*=\s*(["'`])file\1/g, '.type = "file"'],
    [/setAttribute\(\s*(["'`])type\1\s*,\s*(["'`])file\2\s*\)/g, 'setAttribute("type", "file")'],
  ];
  for (const [re, what] of patterns) {
    for (let m = re.exec(code); m; m = re.exec(code)) out.push({ index: m.index, what });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Pure: may this repo-relative file hold a file input? */
const uploadHome = (file) => UPLOAD_HOME.test(file) || LEGACY_UPLOADS.has(file);

function main() {
  const problems = [];
  const files = frontendFiles();
  for (const file of files) {
    if (uploadHome(file)) continue;
    const src = read(file);
    for (const f of findFileInputs(src)) problems.push(`  ${file}:${lineOf(src, f.index)}: raw file input (${f.what})`);
  }
  if (problems.length) {
    console.error(`upload: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(p);
    console.error(
      "\nFiles go through the upload field from @mycity/ui (gate 18; docs/COMPONENTS.md, Forms), which shows progress,\n" +
        "checks type and size first and stores a document_id. A new kind of upload is built in packages/ui/src/form\n" +
        "(npm run new:component), never in a feature.",
    );
    process.exit(1);
  }
  console.log(`upload: ok (${files.length} frontend file(s); file inputs only in packages/ui/src/form and ${LEGACY_UPLOADS.size} legacy upload file(s))`);
}

module.exports = { findFileInputs, uploadHome, LEGACY_UPLOADS };

if (require.main === module) main();

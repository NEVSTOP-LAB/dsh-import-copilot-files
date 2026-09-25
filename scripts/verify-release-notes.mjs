#!/usr/bin/env node
/**
 * verify-release-notes.mjs — compose one tag's Release body and check it before it
 * is published.
 *
 * Why: `release-notes.mjs` copies the tag's `## [<version>]` CHANGELOG section
 * verbatim, so a duplicated or over-long section ships as duplicated or leaking
 * Release notes. That happened on v0.2.0: the section carried the same `###`
 * block twice and the published body repeated it, with no error anywhere.
 *
 * The checks below are exactly the two shapes that defect takes:
 *   1. the same `###` heading twice in one section (a duplicated block);
 *   2. another version's `## [x.y.z]` heading inside the body (the section did
 *      not stop at its own boundary);
 *   3. a missing section (the body fell back to the commit list).
 *
 * Usage:
 *   node scripts/verify-release-notes.mjs --version v0.2.1
 *   node scripts/verify-release-notes.mjs --version 0.2.1 --changelog CHANGELOG.md
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const version = String(arg("version", "")).trim().replace(/^v/, "");
const changelog = arg("changelog", "CHANGELOG.md");
if (version === "") {
  console.error("verify-release-notes: --version is required");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composer = path.join(root, "scripts", "release-notes.mjs");

// Compose with the real script: a parallel implementation could disagree with
// what the workflow actually publishes.
const composed = spawnSync(
  process.execPath,
  [composer, "--version", version, "--changelog", path.resolve(root, changelog), "--sha", "verify", "--out", "-"],
  { cwd: root, encoding: "utf8" },
);
if (composed.status !== 0) {
  console.error(composed.stderr.trim());
  process.exit(composed.status ?? 1);
}
const body = composed.stdout;
const saidFallback = composed.stderr.includes("falling back to the commit list");

const problems = [];

if (saidFallback) {
  problems.push(`CHANGELOG has no "## [${version}]" section — the body is the commit-list fallback`);
}

const headings = body.split(/\r?\n/).filter((line) => /^###\s/.test(line));
const seen = new Map();
for (const heading of headings) seen.set(heading, (seen.get(heading) ?? 0) + 1);
for (const [heading, count] of seen) {
  if (count > 1) problems.push(`the same heading appears ${count}x in the body: ${heading}`);
}

const foreign = body
  .split(/\r?\n/)
  .filter((line) => /^##\s*\[/.test(line))
  .filter((line) => !line.includes(`[${version}]`));
if (foreign.length > 0) problems.push(`another version's section leaked into the body: ${foreign.join(", ")}`);

if (headings.length === 0) {
  // Legitimate only for a section whose whole content is prose — a corrective
  // release, say. The published body is still checked for the two real defects.
  console.log("verify-release-notes: note — the section has no `###` subsection, only the opening paragraph");
}

const bodyLines = body.split(/\r?\n/).length;
console.log(`verify-release-notes: ${version} → ${bodyLines} lines, ${headings.length} section heading(s)`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`  FAIL ${problem}`);
  process.exit(1);
}
console.log("verify-release-notes: ok (no duplicate heading, no leaked section)");

#!/usr/bin/env node

/* Project-owned repository guard. It is deliberately small: this repository has
   no write-capable workflow, so the guard enforces that fact instead of trying
   to reason about what a write-capable job may safely execute. */

import { basename, join, resolve, sep } from "node:path";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const FORBIDDEN_SEGMENTS = new Set([".next", ".wrangler", "build", "coverage", "dist", "node_modules"]);
const FORBIDDEN_NAMES = [/^\.DS_Store$/, /^\.env(?:\..+)?$/, /\.(?:key|p12|pfx|pem|session)$/i];
const SECRETS = [
  ["private key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/],
  ["GitHub fine-grained token", /github_pat_[A-Za-z0-9_]{20,}/],
  ["API key", /sk-[A-Za-z0-9_-]{32,}/],
  /* AKIA is long-lived, ASIA is an STS temporary key; both are credentials. */
  ["AWS access key", /A[KS]IA[0-9A-Z]{16}/]
];
const PERSONAL_PATHS = [/\/Users\/[A-Za-z0-9._-]+\//, /\/home\/[A-Za-z0-9._-]+\//, /[A-Za-z]:\\Users\\/];

/* `permissions:` may only hand out `read` or `none`. Anything else would make a
   job's token able to change this repository, which nothing here needs. */
const READ_ONLY_GRANTS = new Set(["read", "none"]);

export function checkTrackedPath(file) {
  const normalized = file.split(sep).join("/");
  const name = basename(normalized);
  const failures = [];
  if (normalized.split("/").some((part) => FORBIDDEN_SEGMENTS.has(part))) {
    failures.push(`Generated or dependency directory is tracked: ${normalized}`);
  }
  if (name !== ".env.example" && FORBIDDEN_NAMES.some((pattern) => pattern.test(name))) {
    failures.push(`Sensitive or local-only file is tracked: ${normalized}`);
  }
  return failures;
}

export function checkText(normalized, text) {
  const failures = [];
  for (const [label, pattern] of SECRETS) {
    if (pattern.test(text)) failures.push(`Possible ${label} in ${normalized}`);
  }
  if (PERSONAL_PATHS.some((pattern) => pattern.test(text))) {
    failures.push(`Personal absolute path in ${normalized}`);
  }
  return failures;
}

/* Workflows are parsed, not pattern-matched. YAML has too many ways to write
   the same mapping — flow style, quoted keys, anchors, a hash inside a quoted
   scalar — for a line-oriented reader to stay honest about what GitHub will
   actually grant. Only the positions GitHub itself gives meaning to are read,
   so a step input or a matrix dimension that happens to be named `permissions`
   or `uses` is workflow data, not a grant or an action reference. */
function isMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function permissionFailures(where, grants) {
  if (typeof grants === "string") return grants === "read-all" ? [] : [`${where}: ${grants}`];
  if (!isMapping(grants)) return [`${where}: ${JSON.stringify(grants)}`];
  return Object.entries(grants)
    .filter(([, grant]) => !READ_ONLY_GRANTS.has(grant))
    .map(([scope, grant]) => `${where}.${scope}: ${grant}`);
}

function actionFailures(where, uses) {
  const action = String(uses);
  /* A local action is reviewed with the repository. A container action is not,
     so it needs an immutable digest — a tag like `:latest` can be moved. */
  if (action.startsWith("./")) return [];
  if (action.startsWith("docker://")) {
    return /@sha256:[a-f0-9]{64}$/.test(action) ? [] : [`${where}: ${action}`];
  }
  const ref = action.slice(action.lastIndexOf("@") + 1);
  return /^[a-f0-9]{40}$/.test(ref) ? [] : [`${where}: ${action}`];
}

export function checkWorkflowText(workflow, text) {
  let document;
  try {
    document = parseYaml(text);
  } catch (error) {
    return [`Workflow is not parseable YAML: ${workflow}: ${error.message}`];
  }
  if (!isMapping(document)) return [`Workflow must be a YAML mapping: ${workflow}`];

  const failures = [];
  const permissions = [];
  const actions = [];

  /* GitHub recognises `on` and nothing else; the YAML 1.2 core schema this
     parser uses keeps it a string rather than folding it to `true`. */
  const triggers = document.on;
  /* `on:` alone parses to null, and `on: []` / `on: {}` are defined but empty.
     None of them names an event, so none of them can schedule the workflow. */
  const names = triggers === undefined || triggers === null
    ? []
    : isMapping(triggers)
      ? Object.keys(triggers)
      : [triggers].flat().map((trigger) => String(trigger)).filter(Boolean);
  if (names.length === 0) failures.push(`Workflow declares no on: triggers: ${workflow}`);
  if (names.includes("pull_request_target")) {
    failures.push(`High-risk pull_request_target trigger in ${workflow}`);
  }

  if (!("permissions" in document)) {
    failures.push(`Workflow must declare top-level permissions: ${workflow}`);
  } else {
    permissions.push(["permissions", document.permissions]);
  }

  const jobs = isMapping(document.jobs) ? document.jobs : {};
  for (const [id, job] of Object.entries(jobs)) {
    if (!isMapping(job)) continue;
    if ("permissions" in job) permissions.push([`jobs.${id}.permissions`, job.permissions]);
    /* Read-only GITHUB_TOKEN permissions say nothing about repository or
       organisation secrets, which `inherit` forwards wholesale to the callee. */
    if (job.secrets === "inherit") {
      failures.push(`Reusable-workflow job may not inherit secrets in ${workflow}: jobs.${id}.secrets`);
    }
    /* A job-level `uses` is a reusable workflow, and needs the same pin. */
    if (typeof job.uses === "string") actions.push([`jobs.${id}.uses`, job.uses]);
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const [index, step] of steps.entries()) {
      if (isMapping(step) && typeof step.uses === "string") {
        actions.push([`jobs.${id}.steps[${index}].uses`, step.uses]);
      }
    }
  }

  for (const [where, grants] of permissions) {
    for (const grant of permissionFailures(where, grants)) {
      failures.push(`Workflow permissions must be read-only in ${workflow}: ${grant}`);
    }
  }
  for (const [where, uses] of actions) {
    for (const action of actionFailures(where, uses)) {
      failures.push(`Action is not pinned to a full SHA in ${workflow}: ${action}`);
    }
  }
  return failures;
}

/* Files are read in chunks so that a large one is still scanned rather than
   skipped: a padded export is exactly where a key would hide. Chunks overlap by
   more than the longest pattern, so a secret straddling a boundary is still
   seen. */
const CHUNK_BYTES = 1 << 20;
const OVERLAP_BYTES = 4096;

export function scanFileText(path, normalized) {
  const failures = [];
  const handle = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let carry = "";
    let position = 0;
    for (let chunk = 0; ; chunk += 1) {
      const read = readSync(handle, buffer, 0, CHUNK_BYTES, position);
      if (read === 0) break;
      position += read;
      const bytes = buffer.subarray(0, read);
      /* A NUL byte in the first block means binary; scanning it only produces
         noise. Later chunks are not re-tested, so a text file stays text. */
      if (chunk === 0 && bytes.subarray(0, Math.min(read, 8192)).includes(0)) break;
      const text = carry + bytes.toString("utf8");
      failures.push(...checkText(normalized, text));
      carry = text.slice(-OVERLAP_BYTES);
      if (read < CHUNK_BYTES) break;
    }
  } finally {
    closeSync(handle);
  }
  return failures;
}

export function scanRepository(root) {
  const failures = [];
  const codeowners = join(root, ".github/CODEOWNERS");
  if (!existsSync(codeowners)) {
    failures.push("Missing .github/CODEOWNERS");
  } else if (readFileSync(codeowners, "utf8").includes("replace-with-owner")) {
    failures.push("Replace the CODEOWNERS placeholder with the repository owner");
  }

  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8"
  });
  if (listed.status !== 0) throw new Error(listed.stderr.trim() || "git ls-files failed");
  const files = listed.stdout.split("\0").filter(Boolean);

  for (const file of files) {
    const normalized = file.split(sep).join("/");
    failures.push(...checkTrackedPath(file));
    const path = join(root, file);
    /* `existsSync` follows the link, so a dangling symlink would look absent and
       skip the symlink rule entirely. `lstatSync` reports the link itself. */
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      failures.push(`Symbolic links are not allowed: ${normalized}`);
      continue;
    }
    if (!stat.isFile()) continue;
    const workflowText = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(normalized)
      ? readFileSync(path, "utf8")
      : null;
    if (workflowText !== null) failures.push(...checkWorkflowText(normalized, workflowText));
    failures.push(...scanFileText(path, normalized));
  }
  return { failures: [...new Set(failures)], files };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex === -1
    ? resolve(import.meta.dirname, "..")
    : resolve(process.argv[rootIndex + 1]);
  const { failures, files } = scanRepository(root);
  if (failures.length) {
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exit(1);
  }
  console.log(`Repository guard passed (${files.length} paths).`);
}

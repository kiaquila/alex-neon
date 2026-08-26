#!/usr/bin/env node

/* Project-owned repository guard. It is deliberately small: this repository has
   no write-capable workflow, so the guard enforces that fact instead of trying
   to reason about what a write-capable job may safely execute. */

import { basename, join, resolve, sep } from "node:path";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const FORBIDDEN_SEGMENTS = new Set([".next", ".wrangler", "build", "coverage", "dist", "node_modules"]);
const FORBIDDEN_NAMES = [/^\.DS_Store$/, /^\.env(?:\..+)?$/, /\.(?:key|p12|pfx|pem|session)$/i];
const SECRETS = [
  ["private key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/],
  ["API key", /sk-[A-Za-z0-9_-]{32,}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/]
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
  if (action.startsWith("./") || action.startsWith("docker://")) return [];
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
  if (triggers === undefined) {
    failures.push(`Workflow declares no on: triggers: ${workflow}`);
  } else {
    const names = isMapping(triggers)
      ? Object.keys(triggers)
      : [triggers].flat().map((trigger) => String(trigger));
    if (names.includes("pull_request_target")) {
      failures.push(`High-risk pull_request_target trigger in ${workflow}`);
    }
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
    if (!existsSync(path)) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      failures.push(`Symbolic links are not allowed: ${normalized}`);
      continue;
    }
    if (!stat.isFile() || stat.size > 2_000_000) continue;
    const buffer = readFileSync(path);
    /* A NUL byte in the first block means binary; scanning it for secrets only
       produces noise. */
    if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) continue;
    const text = buffer.toString("utf8");
    failures.push(...checkText(normalized, text));
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(normalized)) {
      failures.push(...checkWorkflowText(normalized, text));
    }
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

#!/usr/bin/env node

/* Project-owned repository guard. It is deliberately small: this repository has
   no write-capable workflow, so the guard enforces that fact instead of trying
   to reason about what a write-capable job may safely execute. */

import { basename, join, resolve, sep } from "node:path";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

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

/* Comments may contain the very words this guard counts, so drop them first.
   Only used for counting keys, never for reading a value. */
function withoutComments(text) {
  return text.replace(/^[ \t]*#.*$/gm, "").replace(/[ \t]+#.*$/gm, "");
}

/* The guard reads workflows line by line instead of parsing YAML, which keeps it
   dependency-free. Flow style — `permissions: { contents: write }`,
   `steps: [{ uses: x@v4 }]` — hides a key from a line-oriented reader, so a key
   that is not at the start of its own line is refused rather than skipped. */
function refuseUnreadableStyle(workflow, text, key) {
  const bare = withoutComments(text);
  const total = [...bare.matchAll(new RegExp(`\\b${key}:`, "g"))].length;
  const readable = [...bare.matchAll(new RegExp(`^\\s*-?\\s*${key}:`, "gm"))].length;
  return total > readable
    ? [`Inline or flow-style \`${key}:\` is unreadable to this guard in ${workflow}; use block style`]
    : [];
}

export function checkWorkflowText(workflow, text) {
  const failures = [];
  if (/\bpull_request_target\b/.test(text)) {
    failures.push(`High-risk pull_request_target trigger in ${workflow}`);
  }
  /* Top-level `permissions:` sits at column 0, in either scalar or mapping form. */
  if (!/^permissions:/m.test(text)) {
    failures.push(`Workflow must declare top-level permissions: ${workflow}`);
  }
  failures.push(...refuseUnreadableStyle(workflow, text, "permissions"));
  failures.push(...refuseUnreadableStyle(workflow, text, "uses"));
  /* Any value on the `permissions:` line itself. `read-all` is the only one that
     grants nothing writable; `write-all`, an alias, and a flow mapping all fail. */
  for (const [, raw] of withoutComments(text).matchAll(/^\s*permissions:[ \t]*(\S.*?)[ \t]*$/gm)) {
    const scalar = raw.replace(/^["']|["']$/g, "");
    if (scalar !== "read-all") failures.push(`Workflow permissions must be read-only in ${workflow}: ${scalar}`);
  }
  /* Mapping form: every `scope: grant` under a `permissions:` block. */
  for (const match of text.matchAll(/^([ \t]*)permissions:[ \t]*(?:#.*)?$\n((?:(?:[ \t]*(?:#.*)?)?\n|[ \t]+\S.*\n)*)/gm)) {
    const indent = match[1].length;
    for (const line of match[2].split("\n")) {
      const entry = /^([ \t]+)([A-Za-z-]+):[ \t]*["']?([A-Za-z-]+)["']?[ \t]*(?:#.*)?$/.exec(line);
      if (!entry || entry[1].length <= indent) continue;
      if (!READ_ONLY_GRANTS.has(entry[3])) {
        failures.push(`Workflow permissions must be read-only in ${workflow}: ${entry[2]}: ${entry[3]}`);
      }
    }
  }
  for (const [, action] of text.matchAll(/^\s*-?\s*uses:\s*["']?([^\s"']+)["']?\s*(?:#.*)?$/gm)) {
    if (action.startsWith("./") || action.startsWith("docker://")) continue;
    const ref = action.slice(action.lastIndexOf("@") + 1);
    if (!/^[a-f0-9]{40}$/.test(ref)) {
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

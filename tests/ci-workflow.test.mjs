import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/* Raised in Codex review: nothing stopped a future edit from replacing a check
   command with `true` and leaving a green, meaningless CI.

   The guard does not try to decide whether an arbitrary shell command is a
   "real" check — that is undecidable, and attempting it is what grew the
   baseline guard this pull request removed to 2251 lines and a long tail of
   bypasses (`exit 0; npm test`, `env -u FOO true`, quoted assignments). This
   asserts the opposite and decidable thing: the workflow still contains the
   named jobs and the exact commands this repository depends on. A future edit
   that guts a check fails here and has to change this file to say so. */

const workflow = parseYaml(readFileSync(join(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8"));

function runsOf(jobName) {
  const job = workflow.jobs?.[jobName];
  assert.ok(job, `CI must declare a ${jobName} job`);
  return (job.steps ?? []).map((step) => String(step.run ?? "")).join("\n");
}

test("CI still runs the website build and tests", () => {
  const runs = runsOf("website");
  assert.match(runs, /npm ci --prefix website --ignore-scripts/);
  assert.match(runs, /npm --prefix website run check/);
});

test("CI still runs the repository guard and its tests", () => {
  const runs = runsOf("repository-safety");
  assert.match(runs, /npm ci --ignore-scripts/);
  assert.match(runs, /npm run check && npm test/);
});

test("CI still scans dependencies and requires a Codex review", () => {
  const osv = (workflow.jobs?.["osv-scan"]?.steps ?? []).map((step) => String(step.uses ?? "")).join("\n");
  assert.match(osv, /google\/osv-scanner-action/);
  assert.match(runsOf("ai-review"), /node scripts\/check-codex-review\.mjs/);
});

test("every CI job this repository relies on is present", () => {
  assert.deepEqual(
    Object.keys(workflow.jobs ?? {}).sort(),
    ["ai-review", "osv-scan", "repository-safety", "website"]
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/* Raised in Codex review: nothing stopped a future edit from replacing a check
   command with `true`, or from skipping it with `if: false`, leaving a green
   and meaningless CI.

   The guard does not try to decide whether an arbitrary shell command is a
   "real" check — that is undecidable, and attempting it is what grew the
   baseline guard this pull request removed to 2251 lines and a long tail of
   bypasses (`exit 0; npm test`, `env -u FOO true`, quoted assignments). This
   asserts the decidable converse: the workflow still declares the jobs this
   repository relies on, they still contain the exact commands, and nothing
   about them is conditional. Gutting a check means editing this file to say
   so, in the diff, under CODEOWNERS. */

const CI = ".github/workflows/ci.yml";
const workflow = parseYaml(readFileSync(join(import.meta.dirname, "..", CI), "utf8"));

/* `ai-review` reads a pull request's review, so it is the one job that is
   deliberately conditional. Pinning the exact condition here means widening or
   narrowing it is a visible change to this test. */
const CONDITIONAL = { "ai-review": "github.event_name == 'pull_request'" };

function job(name) {
  const found = workflow.jobs?.[name];
  assert.ok(found, `${CI} must declare a ${name} job`);
  return found;
}

/* A step that is skipped still carries its `run` text, so matching the command
   is not enough — the step that carries it must also be unconditional. */
function step(jobName, field, pattern) {
  const steps = job(jobName).steps ?? [];
  const matches = steps.filter((candidate) => pattern.test(String(candidate?.[field] ?? "")));
  assert.equal(matches.length, 1, `${jobName} must have exactly one step whose ${field} matches ${pattern}`);
  assert.ok(!("if" in matches[0]), `the ${jobName} step matching ${pattern} must not be conditional`);
  return matches[0];
}

test("CI still runs the website build and tests", () => {
  step("website", "run", /^npm ci --prefix website --ignore-scripts$/m);
  step("website", "run", /^npm --prefix website run check$/m);
});

test("CI still runs the repository guard and its tests", () => {
  step("repository-safety", "run", /^npm ci --ignore-scripts$/m);
  step("repository-safety", "run", /^npm run check && npm test$/m);
});

test("CI still scans dependencies and requires a Codex review", () => {
  step("osv-scan", "uses", /^google\/osv-scanner-action/);
  step("ai-review", "run", /^node scripts\/check-codex-review\.mjs$/m);
});

test("every CI job this repository relies on is present", () => {
  assert.deepEqual(
    Object.keys(workflow.jobs ?? {}).sort(),
    ["ai-review", "osv-scan", "repository-safety", "website"]
  );
});

test("no contractual job can be skipped by a condition", () => {
  for (const name of Object.keys(workflow.jobs ?? {})) {
    const condition = CONDITIONAL[name];
    if (condition === undefined) {
      assert.ok(!("if" in job(name)), `the ${name} job must not be conditional`);
      continue;
    }
    assert.equal(String(job(name).if).trim(), condition, `the ${name} condition changed`);
  }
});

/* GitHub skips a job whose dependency was skipped, so `needs: ai-review` would
   take the website and guard checks out of push, schedule, and manual runs
   while every assertion above still passed. These four jobs are independent. */
test("no contractual job depends on another", () => {
  for (const name of Object.keys(workflow.jobs ?? {})) {
    assert.ok(!("needs" in job(name)), `the ${name} job must not declare needs`);
  }
});

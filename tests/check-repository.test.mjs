import assert from "node:assert/strict";
import test from "node:test";

import { checkText, checkTrackedPath, checkWorkflowText } from "../scripts/check-repository.mjs";
import { evaluate, headline } from "../scripts/check-codex-review.mjs";

const WORKFLOW = ".github/workflows/ci.yml";
const PINNED = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";

function workflow(body) {
  return `name: CI\non:\n  pull_request:\n\npermissions:\n  contents: read\n\n${body}`;
}

test("tracked build output and dependency trees are rejected", () => {
  assert.deepEqual(checkTrackedPath("website/src/index.html"), []);
  assert.match(checkTrackedPath("website/dist/index.html")[0], /Generated or dependency directory/);
  assert.match(checkTrackedPath("node_modules/x/index.js")[0], /Generated or dependency directory/);
});

test("local-only and secret-bearing filenames are rejected, .env.example is not", () => {
  assert.deepEqual(checkTrackedPath("website/.env.example"), []);
  assert.match(checkTrackedPath(".env.local")[0], /Sensitive or local-only file/);
  assert.match(checkTrackedPath("deploy/server.pem")[0], /Sensitive or local-only file/);
});

/* Both fixtures are assembled at run time on purpose: spelled out literally,
   they would be real matches, and the guard would flag this very file. */
test("secrets and personal absolute paths are found in file text", () => {
  const awsKey = `AKIA${"0123456789ABCDEF"}`;
  const homePath = `/User${"s"}/someone/projects/x`;
  assert.deepEqual(checkText("a.md", "nothing to see"), []);
  assert.match(checkText("a.md", awsKey)[0], /Possible AWS access key/);
  assert.match(checkText("a.md", `see ${homePath}`)[0], /Personal absolute path/);
});

test("workflows must declare top-level permissions and avoid pull_request_target", () => {
  assert.deepEqual(checkWorkflowText(WORKFLOW, workflow(`jobs:\n  a:\n    steps:\n      - uses: ${PINNED}\n`)), []);
  assert.match(
    checkWorkflowText(WORKFLOW, `name: CI\non:\n  pull_request:\njobs: {}\n`)[0],
    /must declare top-level permissions/
  );
  assert.ok(
    checkWorkflowText(
      WORKFLOW,
      `name: CI\non:\n  pull_request_target:\n\npermissions:\n  contents: read\njobs: {}\n`
    ).some((failure) => /pull_request_target/.test(failure))
  );
});

/* The repository has no write-capable job, and the guard exists to keep it that
   way: a write grant anywhere in a workflow is a failure, in either YAML form. */
test("no workflow may grant a write permission", () => {
  const scoped = checkWorkflowText(WORKFLOW, workflow(
    `jobs:\n  a:\n    permissions:\n      contents: read\n      checks: write\n    steps: []\n`
  ));
  assert.deepEqual(scoped, [
    "Workflow permissions must be read-only in .github/workflows/ci.yml: jobs.a.permissions.checks: write"
  ]);

  assert.ok(
    checkWorkflowText(WORKFLOW, `name: CI\non:\n  pull_request:\n\npermissions: write-all\njobs: {}\n`)
      .some((failure) => /must be read-only/.test(failure))
  );
  assert.ok(
    checkWorkflowText(WORKFLOW, workflow(`jobs:\n  a:\n    permissions:\n      id-token: write\n    steps: []\n`))
      .some((failure) => /id-token: write/.test(failure))
  );
});

test("permissions: none is accepted and read-all keeps its scalar form", () => {
  assert.deepEqual(
    checkWorkflowText(WORKFLOW, workflow(`jobs:\n  a:\n    permissions:\n      contents: none\n    steps: []\n`)),
    []
  );
  assert.deepEqual(
    checkWorkflowText(WORKFLOW, `name: CI\non:\n  pull_request:\n\npermissions: read-all\njobs: {}\n`),
    []
  );
});

/* Four rounds of Codex review, all the same shape: a way to write YAML that a
   line-oriented reader misses. The guard parses the document now, so each of
   these is read as the mapping GitHub will act on. */
test("flow style, quoted keys, and anchors cannot hide a write grant", () => {
  const cases = [
    `name: CI\non:\n  pull_request:\npermissions: { contents: write }\njobs: {}\n`,
    workflow(`jobs:\n  a:\n    permissions: { checks: write }\n    steps: []\n`),
    `name: CI\non:\n  pull_request:\npermissions: read-all\njobs:\n  a:\n    "permissions": { contents: write }\n    steps: []\n`,
    `name: CI\non:\n  pull_request:\npermissions: &grants\n  contents: write\njobs:\n  a:\n    permissions: *grants\n    steps: []\n`
  ];
  for (const text of cases) {
    assert.ok(
      checkWorkflowText(WORKFLOW, text).some((failure) => /must be read-only/.test(failure)),
      `write grant slipped through:\n${text}`
    );
  }
});

test("flow style and quoted keys cannot hide an unpinned action", () => {
  const cases = [
    workflow(`jobs:\n  a:\n    steps: [{ uses: actions/checkout@v4 }]\n`),
    workflow(`jobs:\n  a:\n    steps:\n      - "uses": actions/checkout@v4\n`),
    workflow(`jobs:\n  a:\n    steps: [{ name: "audit # note", uses: actions/checkout@v4 }]\n`)
  ];
  for (const text of cases) {
    assert.deepEqual(
      checkWorkflowText(WORKFLOW, text),
      ["Action is not pinned to a full SHA in .github/workflows/ci.yml: jobs.a.steps[0].uses: actions/checkout@v4"],
      `unpinned action slipped through:\n${text}`
    );
  }
});

/* A hash inside a quoted scalar is content, not a comment; a real comment is. */
test("quoted hashes are content and comments are still comments", () => {
  assert.deepEqual(
    checkWorkflowText(WORKFLOW, workflow(
      `jobs:\n  a:\n    # permissions: none needed here\n    steps:\n      - name: "audit # note"\n        uses: ${PINNED} # v7.0.1\n`
    )),
    []
  );
});

test("a workflow that cannot be parsed fails closed", () => {
  assert.match(checkWorkflowText(WORKFLOW, "permissions: [unclosed\n")[0], /not parseable YAML/);
  assert.match(checkWorkflowText(WORKFLOW, "just a string\n")[0], /must be a YAML mapping/);
});

test("actions must be pinned to a full commit SHA", () => {
  assert.deepEqual(checkWorkflowText(WORKFLOW, workflow(`jobs:\n  a:\n    steps:\n      - uses: ${PINNED}\n`)), []);
  assert.match(
    checkWorkflowText(WORKFLOW, workflow(`jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n`))[0],
    /not pinned to a full SHA/
  );
  assert.deepEqual(checkWorkflowText(WORKFLOW, workflow(`jobs:\n  a:\n    steps:\n      - uses: ./.github/x\n`)), []);
});

/* Reported by Codex review: walking every mapping made workflow *data* look
   like a grant or an action reference. Only the positions GitHub gives meaning
   to are read. */
test("step inputs and matrix dimensions are data, not grants or actions", () => {
  assert.deepEqual(
    checkWorkflowText(WORKFLOW, workflow(
      `jobs:\n  a:\n    strategy:\n      matrix:\n        uses: [one, two]\n    steps:\n      - uses: ${PINNED}\n        with:\n          permissions: read\n          uses: not-an-action@v1\n`
    )),
    []
  );
});

test("a reusable workflow called by a job needs the same pin", () => {
  assert.deepEqual(
    checkWorkflowText(WORKFLOW, workflow(`jobs:\n  a:\n    uses: owner/repo/.github/workflows/x.yml@v1\n`)),
    ["Action is not pinned to a full SHA in .github/workflows/ci.yml: jobs.a.uses: owner/repo/.github/workflows/x.yml@v1"]
  );
});

/* Reported by Codex review: GitHub recognises `on` and nothing else, so a
   workflow whose trigger key was replaced never runs and must be reported. */
test("only a real on: key counts as a trigger", () => {
  assert.deepEqual(
    checkWorkflowText(WORKFLOW, `name: CI\n"true":\n  pull_request:\npermissions:\n  contents: read\njobs: {}\n`),
    ["Workflow declares no on: triggers: .github/workflows/ci.yml"]
  );
});

const HEAD = "f41182e430a9c296ada67aaf6038d010023cbc90";

function pull({ commit = HEAD, threads = [] } = {}) {
  return {
    headRefOid: HEAD,
    reviews: { nodes: [{ author: { login: "chatgpt-codex-connector" }, commit: { oid: commit } }] },
    reviewThreads: { nodes: threads }
  };
}

test("the Codex gate wants a review of this exact head", () => {
  assert.equal(evaluate(pull(), HEAD).reviewed, true);
  assert.equal(evaluate(pull({ commit: "0".repeat(40) }), HEAD).reviewed, false);
});

test("a finding is reported by its title, not its badge markup", () => {
  const body = "**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange)</sub></sub>  Paginate all threads**\n\nDetail.";
  assert.equal(headline(body), "Paginate all threads");
});

test("the Codex gate blocks on unresolved P0-P2 findings only", () => {
  const finding = (isResolved, body) => ({ isResolved, comments: { nodes: [{ path: "a.mjs", body }] } });
  assert.deepEqual(evaluate(pull({ threads: [finding(true, "**P1 Badge** Fix it")] }), HEAD).blocking, []);
  assert.deepEqual(evaluate(pull({ threads: [finding(false, "**P3 Badge** Nit")] }), HEAD).blocking, []);
  assert.deepEqual(
    evaluate(pull({ threads: [finding(false, "**P1 Badge** Fix it")] }), HEAD).blocking,
    ["a.mjs: P1 Badge Fix it"]
  );
});

#!/usr/bin/env node

/* Requires the Codex connector to have reviewed the exact current head, with no
   unresolved P0-P2 finding left on the pull request. Read-only: it reports what
   the review already says and never publishes a check or a comment itself. */

/* Each connection is paginated separately: a long-lived pull request can carry
   more than one page of review threads, and an older unresolved P0-P2 must not
   fall off the end and let the gate pass. */
const HEAD_QUERY = `query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){pullRequest(number:$number){headRefOid}}
}`;

const REVIEWS_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$repo){pullRequest(number:$number){
    connection: reviews(first:100,after:$after){
      pageInfo{hasNextPage endCursor}
      nodes{author{login} commit{oid}}
    }
  }}
}`;

const THREADS_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$repo){pullRequest(number:$number){
    connection: reviewThreads(first:100,after:$after){
      pageInfo{hasNextPage endCursor}
      nodes{isResolved comments(first:1){nodes{path body}}}
    }
  }}
}`;

const CODEX = "chatgpt-codex-connector";
const BLOCKING = /\bP[0-2]\b/;

/* Codex opens a finding with a severity badge built from nested <sub> tags and
   an image link. Strip that furniture so the reported line is the title. */
export function headline(body) {
  return body
    .split("\n")[0]
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[*`]/g, "")
    .trim();
}

export function evaluate(pullRequest, headSha) {
  const head = headSha || pullRequest.headRefOid;
  const reviewed = pullRequest.reviews.nodes.some(
    (review) => review.author?.login === CODEX && review.commit?.oid === head
  );
  const blocking = pullRequest.reviewThreads.nodes
    .filter((thread) => !thread.isResolved)
    .map((thread) => thread.comments.nodes[0])
    .filter((comment) => comment && BLOCKING.test(comment.body))
    .map((comment) => `${comment.path}: ${headline(comment.body)}`);
  return { head, reviewed, blocking };
}

async function graphql(token, query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  const payload = await response.json();
  if (payload.errors) throw new Error(payload.errors.map((error) => error.message).join("; "));
  return payload.data.repository.pullRequest;
}

async function collectAll(token, query, variables) {
  const nodes = [];
  let after = null;
  for (;;) {
    const { connection } = await graphql(token, query, { ...variables, after });
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return nodes;
    after = connection.pageInfo.endCursor;
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.GITHUB_TOKEN;
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  const number = Number(process.env.CODEX_REVIEW_PR_NUMBER);
  if (!token || !owner || !repo || !Number.isInteger(number)) {
    console.error("GITHUB_TOKEN, GITHUB_REPOSITORY, and CODEX_REVIEW_PR_NUMBER are required.");
    process.exit(1);
  }

  const variables = { owner, repo, number };
  const [{ headRefOid }, reviews, reviewThreads] = await Promise.all([
    graphql(token, HEAD_QUERY, variables),
    collectAll(token, REVIEWS_QUERY, variables),
    collectAll(token, THREADS_QUERY, variables)
  ]);
  const pullRequest = { headRefOid, reviews: { nodes: reviews }, reviewThreads: { nodes: reviewThreads } };
  const { head, reviewed, blocking } = evaluate(pullRequest, process.env.CODEX_REVIEW_HEAD_SHA);

  /* The head moving mid-run means a newer run is already queued for it. */
  if (pullRequest.headRefOid !== head) {
    console.log(`Skipped: PR #${number} head moved from ${head} to ${pullRequest.headRefOid}.`);
    process.exit(0);
  }

  const problems = [];
  if (!reviewed) problems.push(`No Codex review for ${head}. Comment: @codex review ${head}`);
  for (const finding of blocking) problems.push(`Unresolved finding — ${finding}`);

  if (problems.length) {
    console.error(problems.map((problem) => `- ${problem}`).join("\n"));
    process.exit(1);
  }
  console.log(`Codex reviewed ${head} with no unresolved P0-P2 finding.`);
}

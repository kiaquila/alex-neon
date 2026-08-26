#!/usr/bin/env node

/* Requires the Codex connector to have reviewed the exact current head, with no
   unresolved P0-P2 finding left on the pull request. Read-only: it reports what
   the review already says and never publishes a check or a comment itself. */

const QUERY = `query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      headRefOid
      reviews(last:100){nodes{author{login} submittedAt commit{oid}}}
      reviewThreads(last:100){nodes{isResolved comments(first:1){nodes{path body}}}}
    }
  }
}`;

const CODEX = "chatgpt-codex-connector";
const BLOCKING = /\bP[0-2]\b/;

export function evaluate(pullRequest, headSha) {
  const head = headSha || pullRequest.headRefOid;
  const reviewed = pullRequest.reviews.nodes.some(
    (review) => review.author?.login === CODEX && review.commit?.oid === head
  );
  const blocking = pullRequest.reviewThreads.nodes
    .filter((thread) => !thread.isResolved)
    .map((thread) => thread.comments.nodes[0])
    .filter((comment) => comment && BLOCKING.test(comment.body))
    .map((comment) => `${comment.path}: ${comment.body.split("\n")[0].replace(/[*`]/g, "").trim()}`);
  return { head, reviewed, blocking };
}

async function graphql(token, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  const payload = await response.json();
  if (payload.errors) throw new Error(payload.errors.map((error) => error.message).join("; "));
  return payload.data.repository.pullRequest;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.GITHUB_TOKEN;
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  const number = Number(process.env.CODEX_REVIEW_PR_NUMBER);
  if (!token || !owner || !repo || !Number.isInteger(number)) {
    console.error("GITHUB_TOKEN, GITHUB_REPOSITORY, and CODEX_REVIEW_PR_NUMBER are required.");
    process.exit(1);
  }

  const pullRequest = await graphql(token, { owner, repo, number });
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

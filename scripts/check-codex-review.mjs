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

const COMMENTS_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$repo){pullRequest(number:$number){
    connection: comments(first:100,after:$after){
      pageInfo{hasNextPage endCursor}
      nodes{author{login} body}
    }
  }}
}`;

const CODEX = "chatgpt-codex-connector";
/* Codex signs reviews as `chatgpt-codex-connector` and comments as
   `chatgpt-codex-connector[bot]`. */
const isCodex = (login) => login?.replace(/\[bot\]$/, "") === CODEX;

/* Codex reports findings as a pull-request review, but when it finds nothing it
   says so in a comment naming an abbreviated commit instead. Both are evidence
   that this head was looked at; only the first can carry a blocking finding. */
const REVIEWED_COMMIT = /Reviewed commit:\W*([0-9a-f]{7,40})/;

export function commentReviews(comments, head) {
  return comments.some((comment) => {
    if (!isCodex(comment.author?.login)) return false;
    const [, reviewed] = REVIEWED_COMMIT.exec(comment.body ?? "") ?? [];
    return Boolean(reviewed) && head.startsWith(reviewed);
  });
}

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
    (review) => isCodex(review.author?.login) && review.commit?.oid === head
  ) || commentReviews(pullRequest.comments?.nodes ?? [], head);
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
  const deadline = Date.now() + Number(process.env.CODEX_REVIEW_WAIT_MS ?? 600_000);
  const pollMs = Number(process.env.CODEX_REVIEW_POLL_MS ?? 20_000);

  /* This job starts seconds after the push, while Codex is still reading the
     diff, so waiting is the normal path rather than an error. A review that has
     already landed with findings is a verdict, not a pending state, and ends
     the wait immediately. */
  for (;;) {
    const [{ headRefOid }, reviews, reviewThreads, comments] = await Promise.all([
      graphql(token, HEAD_QUERY, variables),
      collectAll(token, REVIEWS_QUERY, variables),
      collectAll(token, THREADS_QUERY, variables),
      collectAll(token, COMMENTS_QUERY, variables)
    ]);
    const pullRequest = {
      headRefOid,
      reviews: { nodes: reviews },
      reviewThreads: { nodes: reviewThreads },
      comments: { nodes: comments }
    };
    const { head, reviewed, blocking } = evaluate(pullRequest, process.env.CODEX_REVIEW_HEAD_SHA);

    /* The head moving means a newer run is already queued for the new one. */
    if (headRefOid !== head) {
      console.log(`Skipped: PR #${number} head moved from ${head} to ${headRefOid}.`);
      process.exit(0);
    }

    if (reviewed && blocking.length === 0) {
      /* The queries above run in parallel, so the thread list can have been read
         just before a review was submitted and the review just after it. Read
         the threads once more, now that the review is known to exist, so a
         finding submitted in that window cannot slip past. */
      const settled = evaluate(
        { ...pullRequest, reviewThreads: { nodes: await collectAll(token, THREADS_QUERY, variables) } },
        process.env.CODEX_REVIEW_HEAD_SHA
      );
      if (settled.blocking.length === 0) {
        console.log(`Codex reviewed ${head} with no unresolved P0-P2 finding.`);
        process.exit(0);
      }
      console.error(settled.blocking.map((finding) => `- Unresolved finding — ${finding}`).join("\n"));
      process.exit(1);
    }
    if (blocking.length) {
      console.error(blocking.map((finding) => `- Unresolved finding — ${finding}`).join("\n"));
      process.exit(1);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      console.error(`- No Codex review for ${head} within the wait. Comment: @codex review ${head}`);
      process.exit(1);
    }
    console.log(`Waiting for a Codex review of ${head} (${Math.round(remaining / 1000)}s left)...`);
    await new Promise((wake) => setTimeout(wake, Math.min(pollMs, remaining)));
  }
}

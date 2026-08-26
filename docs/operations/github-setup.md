# GitHub repository setup

The repository ships its own guardrails in `.github/`; repository *settings*
still need an owner with GitHub administration access.

**Do the Codex step first.** `ai-review` runs from the first pull request and
fails until the Codex application is installed *and* a review exists for that
exact head, so there is no green run to wait for until it is configured:

1. Install the Codex repository application, then request a review for the
   current full PR head SHA by commenting `@codex review <sha>`. The `ai-review`
   job reads that review; it never posts one. Every push needs a fresh request,
   because the gate is tied to the head SHA rather than to the branch.

Then, once CI is green:

2. Confirm the repository is private unless its content is intentionally public.
3. Keep `main` as the default branch and enable automatic head-branch deletion.
4. When the repository plan supports it, protect `main` with pull requests,
   required Code Owner review, conversation resolution, no force pushes, no
   branch deletion, and stale-approval dismissal. Require the check names this
   repository actually produces — `website`, `repository-safety`, `osv-scan`,
   and `ai-review` — and only after each has run at least once.
   `.github/CODEOWNERS` must name an owner who has rights here, or required Code
   Owner review protects nothing.
5. Enable available dependency alerts, automated fixes, secret scanning, and
   push protection.
6. Keep any deployment secrets in environment-scoped stores. There is no deploy
   workflow in this repository today — see
   [`cloudflare.md`](./cloudflare.md).

No Actions secret is required. Every job runs on the default `GITHUB_TOKEN` with
read-only permissions, so there is no privileged manual workflow to fence off
with an environment.

## When branch protection is unavailable

Some private-repository plans do not expose branch protection or rulesets and
may return `403` from their APIs. Record the missing control instead of claiming
it is active, and do not make a private repository public to unlock a protection
feature.

Without enforced protection, apply the completion contract by hand before every
merge: record the exact full head SHA; confirm every contractual check is
successful on that same head; confirm every P0-P2 review finding is resolved;
observe a 120-second quiet period and fetch the PR again. Immediately before
merging, recheck that the head SHA is unchanged, the same checks are still
green, and no unresolved P0-P2 thread or newer blocking review has appeared.
This is a mandatory manual fallback, not a claim that the branch is technically
protected.

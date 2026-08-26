# Standards

Project-owned. Everything here is enforced by review, and the parts that can be
mechanically checked are enforced by `scripts/check-repository.mjs`.

## Project structure

This repository owns exactly one product. Product code, evidence, design
decisions, assets, deployment configuration, and project instructions stay
together; another customer's project is never copied in as an example.

`AGENTS.md` carries the implementation rules, `CONTENT-AUDIT.md` is the content
source of truth, and `docs/` holds durable documentation. Dependency
directories, caches, generated builds, local tooling state, private exports, and
deployment credentials are not versioned.

## Content and design integrity

- Keep every factual claim traceable to a supplied source or an explicit client
  approval. Record assumptions and unresolved questions instead of filling gaps.
- Preserve the brand while improving hierarchy, responsiveness, accessibility,
  performance, and conversion clarity.
- Record the origin and permitted use of every non-original asset. Do not infer
  a legal license from permission to use an asset in one project.
- Prefer local, licensed assets. Add external runtime dependencies only when
  their purpose, privacy effect, failure mode, and license are understood.
- Check content at realistic extremes: long headings, missing optional fields,
  smallest supported viewport, widest layout, keyboard-only use, reduced motion,
  and unavailable JavaScript where the product promises a fallback.

## Security and privacy

- **No workflow in this repository may grant a write permission.** Nothing here
  needs one: CI builds, tests, scans, and reads review state. The guard fails on
  any `write` grant, so adding one is a deliberate, reviewable change to the
  guard and its tests rather than a quiet edit. This is what lets the guard stay
  small — there is no write-capable job whose shell has to be analysed for ways
  an attacker's words could become commands. The guard parses workflow YAML
  rather than pattern-matching it, so flow style, quoted keys, and anchors are
  read as the mapping GitHub will act on.
- Pin external GitHub Actions to full commit SHAs. Do not use
  `pull_request_target`, `write-all`, or implicit secret inheritance.
- Keep `.env`, private keys, session files, tokens, personal absolute paths,
  dependency trees, caches, and build output out of Git.
- Treat downloaded templates, websites, messages, and assets as untrusted input.
  Validate paths, hashes, file types, and provenance before use.
- Keep analytics, embeds, fonts, forms, maps, and other third-party services out
  until their purpose, license, data flow, consent requirements, and failure
  behaviour have been reviewed.

## Testing

`npm run preflight` runs the repository guard, its tests, and the website's own
build and tests. A check must exercise the implementation; a command that always
passes is not a check.

The website tests own the payload budgets — raw totals per allowed file type,
gzipped JavaScript, and gzipped critical text. They are deliberately specific to
this landing page's shipped output; do not add a second, generic performance
checker beside them.

For visual changes also record manual checks at the smallest and largest
supported viewports, keyboard focus and navigation, reduced-motion behaviour,
console and network errors, and the critical conversion path. Test the built
output rather than only inspecting source.

## Git and reviews

Use a focused branch and pull request. Required checks must be green for the
current head; resolve review threads and do not rely on a stale approval after a
material change. Merges and deployments remain human decisions.

## Deployment

Deployment configuration belongs to this repository; credentials belong to the
hosting platform's environment-scoped secret store. No customer domain, account
identifier, Worker ID, private key, or production token is committed here.

Production changes require explicit authorization, green checks for the exact
commit, a recorded target and expected revision, post-deploy verification, and a
rollback point. Two repositories must never compete to deploy the same target.
See [`operations/cloudflare.md`](./operations/cloudflare.md).

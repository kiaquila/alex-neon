# Source provenance

This repository was extracted from the `alex-neon/` directory of the
`kiaquila/web-design` multi-project workspace on 2026-08-20. Nothing was
re-created by hand: the published tree and the project's whole commit history
were carried over by `git filter-repo` and then proved against the source.

## Source identity

| Fact | Value |
| --- | --- |
| Source repository | `kiaquila/web-design` |
| Source commit (published `main`) | `3b99cb3d23328013c28eb73ab8525b13b6992d9e` |
| Source subtree | `alex-neon/` |
| Source subtree tree object | `a56bfb66c11a7c2ecca36bcd555201ef22427107` |
| Rewritten `main` | `26a3bac8167079d740a900e6f3ff14fa832047c5` |
| Tags | none — the source project carried no tag |

## How the history was rewritten

In a disposable clone of `kiaquila/web-design`, reset to the published commit
and stripped of every other ref so that no unrelated branch could be carried
along:

```bash
git filter-repo --path alex-neon/ --path-rename alex-neon/:
```

The rename lifts `alex-neon/website` to `website` and the three project
documents to the repository root, which is the only topology change the history
rewrite makes.

## Proof taken before any migration edit

All four checks were run on the filtered clone, before the baseline or any
adaptation was committed.

1. **Exact tree.** The root tree of the rewritten `main` is
   `a56bfb66c11a7c2ecca36bcd555201ef22427107` — the same tree object the source
   repository published under `alex-neon/` at
   `3b99cb3d23328013c28eb73ab8525b13b6992d9e`. The migrated content is
   therefore byte-identical to the source, not merely equivalent.
2. **Commit history.** All five project commits that touched `alex-neon/` are
   present, with their original authors and dates, and the rewritten `main`
   carries exactly those five and nothing else:

   | Rewritten | Source | Subject |
   | --- | --- | --- |
   | `26a3bac` | `5e1377a` | Add KS Design signature to Alex Neon footer (#35) |
   | `860e9c4` | `eab2e15` | Keep Alex Neon mobile dome fixed during scroll (#30) |
   | `1473f99` | `6564870` | Guard Alex Neon JS by gzip budget (#29) |
   | `4279d21` | `d3a4e76` | Give the Alex Neon phone hero a half sphere, and flatten the wordmark (#28) |
   | `a945f7d` | `aaf0583` | Add the Alex Neon redesign of the «ИИ по делу» landing (#27) |

   The source repository squash-merges its pull requests, so the project has no
   merge commits to preserve and none appear here. `git filter-repo` parsed 143
   upstream commits and pruned the 138 that never touched `alex-neon/`.
3. **No stray refs.** Only `main` was pushed. The source project carried no tag,
   so none was rewritten.
4. **Object integrity.** `git fsck --full --strict` reports no problem.

## Deliberately not migrated

- **Old feature branches.** The source repository keeps its branches, including
  `codex/alex-neon-footer-signature` and `codex/alex-neon-stable-mobile-dome`;
  none was carried over.
- **Other customer projects.** `alphacentr`, `chaijana`, `ember`, `ks`, and
  `misha` never entered this history. The filter kept a single path.
- **Monorepository-only infrastructure.** `.repo-guard.json`, the multi-project
  `ci.yml`, `docs/stage-hosting.md`, the Cloudflare stage-registration workflow
  and script, and the KS production-deploy workflow describe a workspace that
  no longer exists here; the `web-design` baseline replaces them.
- **Third-party notices for other projects.** `third-party-notices.md` keeps
  only the fonts and marks this project actually ships.

## Commit map

`git filter-repo` wrote an old→new commit map covering all 143 upstream
commits it parsed: the 5 kept commits map to their rewritten SHAs and the 138
pruned ones map to zeros. It is not committed — it describes the migration
event, not the product — and is kept locally at
`~/projects/web-design/.claude/migration/alex-neon-2026-08-20/`:

| File | SHA-256 |
| --- | --- |
| `commit-map.txt` | `5b88a5606337eca1ad8d1348682c0bd140951c94e413f51196ddb43cd0fe273c` |
| `ref-map.txt` | `885cc504b82a9f24bd1fab189054a83d7f02aa3576b7cff5bc5a61890b467cb8` |

The same map can be reproduced at any time by re-running the command above
against `3b99cb3d23328013c28eb73ab8525b13b6992d9e`; the rewrite is
deterministic.

## Topology adaptation

Only path topology was adapted. No business fact, price, translation, contact
detail, approved sentence, or design decision was changed, and the Alex Neon
concept is untouched.

- `README.md` and `AGENTS.md`: `npm --prefix alex-neon/website run check` and
  `node scripts/check-repository.mjs` became `npm run project:check` and
  `npm run preflight`; `npm --prefix alex-neon/website run og|dev` lost the
  directory prefix; `../CONTENT-AUDIT.md` became `./CONTENT-AUDIT.md`.
- The two links to the monorepository's `docs/stage-hosting.md` now point at a
  **Cloudflare-стенд** section in this repository's `README.md`, which carries
  the Worker's build settings. The `static-cloudflare` profile keeps Worker
  names, domains and account identifiers project-owned, so they belong here
  rather than in the baseline.
- `AGENTS.md` gained a short **Базовые стандарты** section pointing at
  `docs/standards/` and `.web-design/project.json`, because the baseline's own
  `AGENTS.md` — which normally carries that pointer — was not installed over the
  project's approved instructions.
- The comments in `website/tests/site.test.mjs` that reference
  `../../CONTENT-AUDIT.md` and `../../third-party-notices.md` still resolve:
  both files sit at this repository's root, exactly where those relative paths
  land from `website/tests/`.

## Baseline pin — provisional

`.web-design/lock.json` pins
`ee3997d7daba2bc934f62fd4dbaa4e1b19de5271` from the `codex/web-design-template-v2`
branch of `kiaquila/web-design`, at version `0.1.0-dev`.

**This is deliberately a provisional pin.** `kiaquila/web-design` has not yet
published an immutable stable release, because the pull request that turns it
into a template — [`kiaquila/web-design#46`](https://github.com/kiaquila/web-design/pull/46)
— is still a draft and must not be merged until every project has been migrated
and verified. `ee3997d7` is the exact, reachable commit that pull request
proposes, so it is a real 40-character SHA that `baseline-source-verification`
can download and compare, and the standard `npm run setup` adoption path
accepted it without any workaround.

### Required follow-up

After `kiaquila/web-design#46` is merged and the first immutable stable release
is published, this project must be moved onto that release's full commit SHA in
its own separate pull request:

```bash
npm run sync:web-design -- plan  --source-ref <stable-release-sha> --version <x.y.z>
npm run sync:web-design -- apply --source-ref <stable-release-sha> --version <x.y.z>
```

Until that pull request is merged, this repository is pinned to a prerelease
baseline and `0.1.0-dev` must not be treated as a released version.

## Cloudflare — prepared, not switched

Nothing in Cloudflare was changed during this migration. The Worker `alex-neon`
still builds from `kiaquila/web-design`. The target settings and the
rollback-safe cutover order are in `README.md` and
[`../operations/cloudflare.md`](../operations/cloudflare.md). Until the cutover
happens, the source directory in the monorepository must stay in place, and the
two repositories must never both deploy this Worker.

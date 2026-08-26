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
  and script, and the KS production-deploy workflow describe a workspace that no
  longer exists here. This repository's own small `.github/` and `scripts/`
  replace them.
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

- `README.md` and `AGENTS.md`: `npm --prefix alex-neon/website run check` plus a
  separate `node scripts/check-repository.mjs` became the single
  `npm run preflight`; `npm --prefix alex-neon/website run og|dev` lost the
  directory prefix; `../CONTENT-AUDIT.md` became `./CONTENT-AUDIT.md`.
- The two links to the monorepository's `docs/stage-hosting.md` now point at
  [`../operations/cloudflare.md`](../operations/cloudflare.md), which carries the
  Worker's target build settings. Worker names, domains and account identifiers
  are project-owned, so they belong here.
- `AGENTS.md` gained a short **Базовые стандарты** section pointing at
  [`../standards.md`](../standards.md), which is this repository's own
  consolidated standards document.
- The comments in `website/tests/site.test.mjs` that reference
  `../../CONTENT-AUDIT.md` and `../../third-party-notices.md` still resolve:
  both files sit at this repository's root, exactly where those relative paths
  land from `website/tests/`.

## No upstream baseline

Alex Neon is **not** a `kiaquila/web-design` consumer. An earlier revision of
this pull request installed that project's control plane — a release manifest,
a lock, a managed-file list, profiles, sync/bootstrap/update scripts, and the
workflows that verify them — and pinned a prerelease baseline commit. All of it
was removed before merge, and none of it is coming back.

What survives is a small, project-owned harness that was written by hand from
the ideas in `kiaquila/web-design@ea8501fdb90236fcb891e97b15f7a42a62f76ff1`:

| File | What it is |
| --- | --- |
| `scripts/check-repository.mjs` | Tracked-file hygiene, secret and personal-path scanning, and workflow rules |
| `scripts/check-codex-review.mjs` | Read-only check that Codex reviewed the current head with no open P0-P2 |
| `tests/check-repository.test.mjs` | Regression tests for both |
| `.github/workflows/ci.yml` | One read-only workflow: website, repository safety, OSV, AI review |

That is a one-time transfer of ideas, not a dependency. There is no lock, no
manifest, no managed path, no sync command, and no upstream SHA to advance.
These files are edited here like any other project file, in a normal pull
request, and the guard's rules are deliberately narrower than the baseline's
because this repository grants no workflow write access at all — see
[`../standards.md`](../standards.md).

## The old source path

`alex-neon/` still exists in `kiaquila/web-design`. Do not remove it until this
repository's history, files, settings, checks, and — if it is ever reconnected —
its deployment have been independently verified. Removing the source is the last
step of the migration, not part of it.

## Cloudflare — not connected

Nothing in Cloudflare was changed during this migration, and the Git build
integration is currently disabled: no repository builds the `alex-neon` Worker.
This repository holds no Cloudflare credential and no deploy workflow. The
target settings and the rollback-safe order, should the integration be
re-enabled, are in [`../operations/cloudflare.md`](../operations/cloudflare.md).

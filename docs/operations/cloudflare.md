# Cloudflare

**Current state: the `alex-neon` Worker is connected to
`kiaquila/alex-neon`.** Cloudflare builds the production branch from `main` and
reports the result to GitHub as the `Workers Builds: alex-neon` check. GitHub
Actions still holds `contents: read` and carries no deploy job or Cloudflare
credential; the Git connection and deploy remain controlled by Cloudflare.

Account identifiers, routes, domains, credentials, and the Git connection live
in Cloudflare, not in GitHub Actions. The repository keeps the project-owned
Worker configuration in `website/wrangler.json` and the existing `stage:*`
scripts in `website/package.json`.

## Connected build

Never connect a second repository to the same Worker. Before changing the
connection or production settings, record the active deployment and saved
version, validate the repository and build, and verify a preview before moving
production.

Current build settings:

| Setting | Value |
| --- | --- |
| Worker | `alex-neon` |
| Production branch | `main` |
| Root directory | `website` |
| Build command | `npm run build` |
| Production deploy command | `npm run stage:deploy` |
| Non-production deploy command | `npm run stage:preview` |

The landing page is static: Cloudflare serves `website/dist` through Workers
Static Assets, and `website/worker/index.ts` exists only to add the security
headers the asset pipeline does not set. Keep `compatibility_date` pinned.

## Rollback

For a fast operational rollback, restore the last known-good saved Worker
version with Cloudflare's rollback controls. The former `alex-neon/` directory
in `kiaquila/web-design` has been removed and is neither a deployment source nor
a rollback mechanism. A source change after the rollback belongs in this
repository and goes through its normal review and build checks.

After any deploy, verify the production response, the error route, security
headers, the canonical URL, robots policy, sitemap, assets, and the absence of
unintended runtime origins.

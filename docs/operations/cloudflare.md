# Cloudflare

**Current state: the Cloudflare Git integration is disabled.** No repository —
this one or any other — is wired to build the `alex-neon` Worker right now, and
nothing in this repository can trigger a deploy: CI holds `contents: read` and
carries no deploy job or credential. Connecting it is a deliberate, separate
decision by the account owner, not part of any code change.

Worker names, account identifiers, routes, domains, and credentials are
project-owned and live in Cloudflare, not here. The only deploy-shaped files in
this repository are `website/wrangler.json` and the `stage:*` scripts in
`website/package.json`, which a human can run locally against their own
credentials.

## If the integration is re-enabled later

Record the existing Worker and its active deployment first, so there is a
rollback point. Then validate the repository and build, disable any old Git
build connection before enabling a new one, verify a preview URL, and only then
move production. Never leave two repositories connected to the same Worker.

Target build settings, for whoever performs that step:

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

After any deploy, verify the production response, the error route, security
headers, the canonical URL, robots policy, sitemap, assets, and the absence of
unintended runtime origins.

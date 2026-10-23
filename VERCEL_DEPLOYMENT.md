# Vercel deployment readiness

Local verification date: 23 October 2026. These checks ran on Windows with Node 24.20.0; they are not a Vercel cloud deployment or a Linux build verification.

## Results

| Check | Result |
| --- | --- |
| Client `npm run build` | Passed; 68 pages generated, including dynamic session handlers |
| Client `npm run typecheck` | Passed |
| Client `npm run lint` | Passed; 0 errors, 0 warnings |
| Client `npm test` | 373 passed, 0 failed, 0 skipped across 37 test files |
| Server `npm test` | 160 passed, 7 skipped, 0 failed; includes TypeScript build |
| Server rebuild after entry-point change | Passed |
| Swagger tests after entry-point change | 4 passed |
| Local production HTTP checks | Health, protected API rejection, CORS preflight, hidden Swagger, and main web pages passed |
| Prisma `validate` | Passed; no migration applied |
| Git `diff --check` | Passed; staging area empty |

The server now default-exports its Express application from `src/app.ts`, matching Vercel's documented Express entry-point convention. The existing named export and local `src/server.ts` listener remain available.

## Release fixes and confirmed root causes

The actual client script first reproduced 368 passes and the following four failures:

| Test file | Failing test | Expected / actual / assertion |
| --- | --- | --- |
| `client/tests/dashboard.test.tsx` | shows the recent shipments callout instead of the delivery overview | Expected Recent shipments heading and action in Seller overview; rendered policy notice and costs without callout; heading lookup failed |
| `client/tests/dashboard.test.tsx` | opens the recent shipments view from the callout action | Expected View recent shipments button to open the existing real-data list; button absent; role lookup failed |
| `client/tests/dashboard.test.tsx` | places the monthly cost summary under the recent shipments callout | Expected callout before monthly costs; costs rendered without callout; action lookup failed |
| `client/tests/seller-sidebar.test.tsx` | keeps unavailable items non-interactive instead of linking to missing routes | Expected disabled Dispatch text alongside Reports/Delivery Team; Dispatch had been removed; text lookup failed |

The dashboard component and its integration tests remained present, but the callout was no longer composed into the overview. There is no separate approved replacement recorded in the available history. Restoring the existing component is the smallest correction and keeps the current policy notice. It selects the existing recent view, which uses `useSmeDashboard`/`useParcelSearch` data from the authenticated dashboard API. Existing loading, error, and empty-list tests pass. No mock shipment data or new API was introduced.

The Dispatch assertion was mis-scoped: `server/PERMISSIONS.md` grants rider assignment to Operators, and Operator navigation already exposes Rider Assignment at `/operator/assignments`. Seller navigation intentionally has no working Dispatch route. The corrected test preserves disabled-item checks for Reports/Delivery Team; an additional test verifies Dispatch absence, absence of Operator links in Seller navigation, and the existing Operator assignment destination. Backend role/ownership tests remain unchanged and pass.

Changed files for this release fix:

- `client/features/orders/components/sme-dashboard.tsx`: compose the existing callout before monthly costs and connect it to the recent view. This resolves the unused `RecentShipmentsCallout` warning.
- `client/features/seller/seller-nav.ts`: remove the obsolete commented Dispatch definition and unused `GitFork` import, resolving the second `@typescript-eslint/no-unused-vars` warning.
- `client/tests/seller-sidebar.test.tsx`: correct the role-scoped expectation and add navigation regression coverage; no tests removed or skipped.
- `scripts/production-smoke.cjs`: repeatable checks against built production processes using dummy database configuration. Run from the repository root with `node scripts/production-smoke.cjs` after both builds. Reserves ports 4310 and 4311 and shuts down its child processes.
- `VERCEL_DEPLOYMENT.md`: record reproduction, fixes, retest evidence, and staging verdict.

The prior README, Swagger overview, and Express default-export changes were preserved. Git root is `D:/TeamAi17/Team-17`, branch `main`, inspected HEAD `99fe9a7`. No changes were staged, committed, or pushed. Only example env files are tracked; no credentials were added to the staging area.

The production smoke script verifies the default and named Express exports reference one app and that app import does not start a listener. It also checks local startup, unauthenticated role endpoints, CORS preflight, production docs restrictions, rendered web routes, missing-session rejection, and cross-origin session rejection. These page responses establish availability, not successful authenticated browser workflows. The shared Prisma client is instantiated at module scope, not per request. No auth, cookie, CORS, schema, migration, status, or permission contracts changed.

The seven server skips require explicit database integration configuration. No production database migrations, seeds, account changes, or emails were performed during this verification. Database-backed login, refresh-cookie rotation, SMTP delivery, and full parcel workflows still need staging verification.

## Create two Vercel projects

Use the existing `surfertrack-web` and `surfertrack-api` projects. They do not need to be connected through Vercel's GitHub App: the manual GitHub Actions workflows below build and deploy through Vercel CLI. Paths below assume the Git root is `Team-17`.

| Setting | Frontend project | Backend project |
| --- | --- | --- |
| Root Directory | `client` | `server` |
| Framework | Next.js | Express |
| Node.js version | 24.x | 24.x |
| Install command | `npm ci` | `npm ci` |
| Build command | `npm run build` | `npm run build` |
| Output directory | Framework default | Framework default |

Use Vercel's framework defaults for routing/runtime; no legacy catch-all rewrite or static export is required. The frontend requires server functions for `/api/session/*`. Do not use `npm test` as the frontend Build Command: its pretest depends on the sibling server package, which may be outside the selected project root.

Backend installation runs `prisma generate` through postinstall. Set database environment variables before the first install/build because Prisma configuration reads `DIRECT_URL`. Do not omit build-time devDependencies: TypeScript and Prisma CLI are needed.

## Production environment variables

Reserve stable HTTPS frontend and backend domains, then configure:

| Project | Variable | Value |
| --- | --- | --- |
| Frontend | `NEXT_PUBLIC_API_BASE_URL` | `https://your-api-domain` |
| Frontend | `EXPRESS_API_URL` | `https://your-api-domain` |
| Frontend | `APP_ORIGIN` | `https://your-frontend-domain` |
| Backend | `DATABASE_URL` | Runtime PostgreSQL connection; use an appropriate pooled connection for serverless workloads |
| Backend | `DIRECT_URL` | Migration-capable PostgreSQL connection |
| Backend | `FRONTEND_URL` | `https://your-frontend-domain` |
| Backend | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Working transactional email configuration |
| Backend | `ENABLE_API_DOCS` | `false` normally; literal `true` for deliberate Swagger exposure |

Vercel production builds/runtime supply `NODE_ENV=production`. Do not copy local `NODE_ENV=development` or localhost origins into production. A custom `PORT` is not needed for the exported Express application.

The browser origin must match `APP_ORIGIN` for Next.js session requests and `FRONTEND_URL` for direct browser-to-Express requests and email links. `NEXT_PUBLIC_API_BASE_URL` is embedded at build time: rebuild after changing it. Production HttpOnly cookies require HTTPS.

Set Preview environment variables separately with a matching stable preview frontend/backend pair. The current backend allows one configured frontend origin, so arbitrary Vercel preview URLs will not automatically work against a shared backend. Protected Vercel preview deployments may also require deployment-protection configuration before browser/API requests can reach them.

## Database and runtime considerations

Apply reviewed migrations once from a controlled environment using `npm run db:migrate` in `server`, with `DIRECT_URL` targeting the intended database. Do not add database seeding or unconditional migrations to every preview build.

The backend uses Prisma with the PostgreSQL adapter and a process-local pool. Validate connection limits and concurrent traffic against the chosen PostgreSQL pooler. Authentication/invitation rate limits currently use process memory, so limits are not shared across Vercel instances. The frontend's refresh-request coalescing is also process-local; verify concurrent refreshes across instances in staging before relying on its single-process tests for production behavior.

Swagger UI uses middleware-served package assets. Vercel documents that `express.static()` assets are not served by its Express integration, so enabling docs requires checking the deployed CSS/JS as well as the HTML/JSON. Local Swagger tests do not verify Vercel's asset handling. If assets fail, package them into the backend `public` directory with matching URLs or use an explicitly configured external Swagger UI asset source.

## Staging acceptance checks

1. Confirm backend `/health` returns `200` and protected routes return `401` without credentials.
2. Confirm `/api/docs` and `/api/docs.json` return `404` with docs disabled. If enabled, verify the UI CSS/JS and Try it out requests.
3. Open the frontend's `/login`, `/register`, `/seller`, `/operator`, and `/rider`; verify access guards and static assets in a browser.
4. Complete registration, email verification, login, page reload/session restoration, token refresh, and logout over HTTPS. Check cookies and origin rejection.
5. Verify the database migration state and provider/pricing setup. Complete a parcel lifecycle with separate SME, Operator, and Rider test accounts.
6. Verify SMTP delivery and email-link domains; check camera permission/QR scanning over HTTPS.
7. Check Vercel logs for cold-start failures, missing generated Prisma files, database exhaustion, proxy/rate-limit diagnostics, and timeouts.

No cloud deployment was performed. A successful local build establishes compilation readiness, not verified production database, SMTP, serverless concurrency, or Vercel routing behavior.

## Verdict

**READY FOR STAGING DEPLOYMENT** — local release checks pass and entry points are structurally compatible with the documented Next.js/Express project setup. This is not a production-readiness claim. Configure the two projects and their HTTPS origins, then complete the isolated database, SMTP, authenticated lifecycle, concurrent refresh, connection-limit, and deployed Swagger-asset checks above. Deployment itself remains unperformed.

References: [Vercel Express runtime](https://vercel.com/docs/frameworks/backend/express), [Vercel monorepo setup](https://vercel.com/docs/monorepos).

## Manual GitHub Actions Preview deployments

The repository now includes `.github/workflows/deploy-client.yml` and `.github/workflows/deploy-server.yml` at the Git root. Neither has a push, pull-request, scheduled, or production deployment trigger. Both accept `workflow_dispatch` only, and checks run only when the selected ref is `main`. No workflow has been run on GitHub as part of this configuration work.

Each workflow has two jobs:

1. **checks**: Ubuntu/Node 24, exact lockfile installs, build/tests and target checks, with dummy database URLs and no deployment secrets. The client job installs both packages because the real client pretest compiles the sibling server. The server job generates/validates Prisma and verifies that importing the default-exported Express app starts no listener. No migrations or seeds run.
2. **deploy**: runs only after checks pass, with deployment secrets scoped to this job and a target-specific GitHub Environment. Installs pinned Vercel CLI `65.2.0`, pulls Preview settings, validates project mapping/settings/required variables, runs `vercel build --environment=preview`, and runs `vercel deploy --prebuilt --environment=preview`. Downloaded environment files and build output are removed in an always-run cleanup step and are never uploaded as Actions artifacts.

GitHub Actions are pinned to verified immutable commits of `actions/checkout` v6 and `actions/setup-node` v6; checkout does not persist its Git credentials. Workflows use `contents: read`, timeouts, and separate target concurrency groups with cancellation disabled. GitHub may replace a pending run when another is queued; an active deployment is not cancelled by this workflow configuration. Deployment IDs and token values are not hardcoded. There is no automatic production deployment or `--prod` command.

### GitHub setup

In `AI-Ocean-UXMM-2026/Team-17` → **Settings → Secrets and variables → Actions → Repository secrets**, add:

| Secret | Mapping |
| --- | --- |
| `VERCEL_TOKEN` | Vercel token authorized to deploy both existing projects; select the narrowest available account/team scope and suitable expiry |
| `VERCEL_ORG_ID` | Owner/account/team ID for both projects |
| `VERCEL_PROJECT_ID` | Client project ID of `surfertrack-web`; passed to the CLI as `VERCEL_PROJECT_ID` |
| `VERCEL_SERVER_PROJECT_ID` | Project ID of `surfertrack-api` |

Obtain IDs from the Vercel project/account settings. Enter them directly in GitHub's secret UI; do not commit them or send credentials in chat. Missing secrets fail the deployment job with the missing repository secret name only. No remote secret availability was queried or verified locally.

**Token rotation required before deployment:** the previous Vercel token was exposed. Revoke it in Vercel, create a replacement authorized for the same Team and both projects, and update the repository's `VERCEL_TOKEN` secret. Do not reuse the exposed token. Both workflows require the manual `vercel_token_rotated` confirmation (default false) and stop before any Vercel command if it is unchecked. This is an operator attestation; the workflow cannot independently prove revocation or replacement. No token values were read or printed during this fix.

The original client workflow referenced the nonexistent `VERCEL_CLIENT_PROJECT_ID` secret. It now uses the existing `VERCEL_PROJECT_ID` repository secret, and missing-secret diagnostics use that actual name. The server mapping remains `secrets.VERCEL_SERVER_PROJECT_ID` → CLI `VERCEL_PROJECT_ID`. Both use the same `VERCEL_ORG_ID` Team. GitHub deployment credentials do not automatically become Vercel application environment variables; configure Preview app variables separately below.

Create GitHub Environments named **staging-client** and **staging-server**. Restrict deployment branches to `main`, and configure required reviewers where supported by the repository's GitHub plan. These GitHub Environment names gate the jobs; the Vercel target remains **Preview**. Keep secrets in repository secrets as specified above. If organizational Actions policy restricts allowed actions, allow the two pinned official actions. The workflow files must first be reviewed and made available on the default branch before GitHub offers manual dispatch; this task does not commit or push them.

### Verify each Vercel project before running

Remote settings cannot be assumed from project existence and were not authenticated or fetched during this task. In Vercel → **Project Settings → Build and Deployment**, explicitly set:

| Setting | `surfertrack-web` | `surfertrack-api` |
| --- | --- | --- |
| Root Directory | `client` | `server` |
| Framework Preset | Next.js (`nextjs`) | Express (`express`) |
| Node.js Version | 24.x | 24.x |
| Install Command override | `npm ci` | `npm ci` |
| Build Command override | `npm run build` | `npm run build` |
| Output Directory | Default (or `.next`) | Default, no override |

All Vercel CLI commands intentionally run at the **repository root**, with the target ID mapped through `VERCEL_PROJECT_ID`. The pulled project's Root Directory applies `client` or `server` once. Do not add a workflow `working-directory: client`/`server` to these commands while retaining those project root settings. The settings guard fails before a build if the linked project, root, framework, install/build commands, or output override differ from the expected configuration. No conflicting `vercel.json` existed at inspection time.

The API entry point is `server/src/app.ts`; it default-exports one Express application and does not call `listen`. `server/src/server.ts` remains the separate local listener. Prisma is a module-level shared client, generated on install; generation and schema validation do not connect to or mutate the database. Connection limits, shared rate limits, and cross-instance token refresh still require the staging checks described earlier.

### Preview environment checklist

Configure variables in **Vercel**, selecting the **Preview** environment. The workflows pull these securely instead of copying local `.env` files into GitHub. The guard reports missing names, masks downloaded values before build steps, rejects localhost/non-HTTPS origins, and rejects common secret-bearing `NEXT_PUBLIC_*` names and backend-only variables on the frontend.

- Frontend required: `NEXT_PUBLIC_API_BASE_URL`, `EXPRESS_API_URL`, `APP_ORIGIN`.
- Backend required: `DATABASE_URL`, `DIRECT_URL`, `FRONTEND_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
- Backend optional: `ENABLE_API_DOCS` (`false` recommended initially; only literal `true`/`false` accepted).
- Remove local `NODE_ENV=development` overrides. Vercel Preview builds use production Node mode. No custom `PORT` is required.
- There are no application JWT/session signing-secret variables in the inspected opaque-token implementation. Do not invent one. `VERCEL_TOKEN` is a deployment credential, not an application variable.
- Keep `NEXT_PUBLIC_API_BASE_URL` public and free of credentials; it is embedded in the web build. Never prefix database, SMTP, or authentication secrets with `NEXT_PUBLIC_`.
- Use an approved isolated staging database with reviewed migrations already applied; these workflows never apply them.

Stable staging origins are required: `APP_ORIGIN` and backend `FRONTEND_URL` must both match the frontend URL actually opened by the browser; `NEXT_PUBLIC_API_BASE_URL` and `EXPRESS_API_URL` must reach the staging API. Preview deployment URLs change each run. Reserve/configure stable preview aliases or update the corresponding Preview variables and rebuild/redeploy in a controlled sequence. The workflows report deployment URLs but do not assign aliases or automatically rewrite cross-project environment variables. Prefer a stable API Preview alias before building the client.

Review **Deployment Protection** for both projects. A browser registration request and a Next.js server-to-API request must reach the API; a protected API may return Vercel authentication HTML instead of API JSON. Use a reviewed access strategy for staging, such as protection settings appropriate for the test audience or an explicitly implemented automation bypass. No bypass secret or bypass header support has been silently introduced. Do not place a bypass token in `NEXT_PUBLIC_*`. Verify access before relying on authenticated end-to-end tests.

### Run manually and find results

After the files and settings are reviewed and available on `main`:

1. Open the repository's **Actions** tab.
2. Select **Deploy Server Preview**, click **Run workflow**, choose `main`, confirm `vercel_token_rotated` only after completing revocation/replacement, and run it. Approve the staging-server Environment if configured.
3. Inspect the job summary for the **Server Preview** URL. Confirm health/access and the stable API staging origin.
4. Configure/confirm frontend Preview variables, then select **Deploy Client Preview** and run it on `main` with the same token-rotation confirmation. Approve staging-client if configured.
5. Find the **Client Preview** URL in that run's job summary. Open it using the configured stable origin for session tests.

Both deployment steps capture Vercel's returned URL as the `deployment` step's `url` output and append it to the Actions summary. The Vercel project's Deployments tab also lists the result. CLI stdout is captured; CLI progress/errors appear in the step logs. A settings validation failure prints the setting or variable **name**, never its value.

On failure, open the first failing step in Actions: dependency/build/test errors must be fixed before deployment; missing secrets or settings must be corrected in GitHub/Vercel; Vercel build/deployment errors can also be inspected in the target project's dashboard. For runtime failures, use Vercel function logs and the staging acceptance checklist above. Do not print `.vercel/.env.preview.local`, enable shell tracing/debug logging, upload `.vercel` as an artifact, or paste environment files into issue reports.

### Configuration validation performed

- Actionlint 1.7.12 passed both workflows, including YAML structure and GitHub Actions expressions (external ShellCheck was unavailable and disabled for this local validation).
- Verified pinned Vercel CLI 65.2.0 help supports the pull, build environment, and prebuilt Preview deploy arguments. No authenticated CLI command or deployment was executed.
- Deployment settings guard: 11 fixture tests passed, including wrong mapping/root/framework, unsafe build commands, missing variables, public secrets, backend variables on frontend, and development-mode overrides.
- Local client typecheck, lint, build and all 373 tests passed; server build/test passed with 160 passes and 7 isolated-database skips. Prisma validation, Express import check, production smoke script, and `git diff --check` passed.
- Real Vercel project settings, GitHub secrets, isolated staging database state, SMTP, Preview access, stable origins, and actual GitHub Actions/Linux build output remain unverified until setup and the first authorized manual run.

The workflows are configured locally, not proven by a successful cloud run. No deployment, commit, push, migration, production environment change, or shared Supabase mutation was performed.

Reference: [Vercel's GitHub Actions build/prebuilt deployment guide](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel).

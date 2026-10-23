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

Import the same Git repository twice and select a separate Root Directory for each project. Paths below assume the Git root is `Team-17`.

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

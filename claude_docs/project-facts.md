---
name: project-facts
description: "Repo, branches, deploy pipeline, env vars, and commands — with corrections to stale AGENTS.md facts"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 75adad51-7a9f-4d48-ae93-ece92d06f5dd
---

**Repo & remote (re-verified 2026-09-03):** `origin = https://github.com/Advantage-Brain-and-Trauma/PatientPortal-Frontend.git`. Branches: `main` and `staging`; active dev branch is **`staging`**.
> ⚠️ The remote moved since 2026-07-02 (it was `dev-saman/PatientPortal-Frontend`). Always trust the live `git remote -v` and `.github/workflows/` over any doc, including this one.

**CI/CD:** two workflows — **both branches deploy on push**, so there is no non-deploying branch.
- `.github/workflows/deploy-staging.yml` — push to `staging` auto-deploys to **Cloudways** via SSH+rsync (uploads `dist/public/` to `/home/master/applications/rxtdnqswpd/public_html`, concurrency-cancel-in-progress). GitHub-hosted runner, Node 22 + pnpm (corepack) + `pnpm install --frozen-lockfile` + `pnpm run build`.
- `.github/workflows/deploy.yml` ("Auto Deploy Patient Portal") — push to `main` deploys to **production** on a self-hosted runner: hard-resets `/var/www/html/patient-portal` to `origin/main` (`git reset --hard` + `git clean -fd`), `pnpm install --no-frozen-lockfile`, `pnpm run build`, fixes permissions, restarts Apache. The hard reset discards anything sitting on the production box.

There is no lint/test step in either workflow. Do not push to `main` or `staging` casually — both deploy.

**Commands:** dev `pnpm run dev` (port 3000, `--host`); type-check `pnpm run check`; build `pnpm run build` (vite build → `dist/public`, plus esbuild bundling `server/index.ts` → `dist`); format `pnpm run format`. Prod start `pnpm run start` (`NODE_ENV=production node dist/index.js`). Use `corepack pnpm ...` if pnpm isn't on PATH.

**Env vars** (Vite `import.meta.env`, no `.env` committed):
- `VITE_API_BASE_URL` — backend API base; fallback `https://adm.advantagehcs.com/api`.
- `VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID` — used by `getLoginUrl()` in `client/src/const.ts` (OAuth portal deep-link).
- Also referenced per AGENTS.md: `VITE_FRONTEND_FORGE_API_KEY`, `VITE_FRONTEND_FORGE_API_URL`, `VITE_ANALYTICS_ENDPOINT`, `VITE_ANALYTICS_WEBSITE_ID`.

**PDF merge endpoint** `/api/merge-pdfs` (POST `{pdfUrls: string[]}` → merged `application/pdf`): served by a Vite dev-middleware plugin in `vite.config.ts` during dev, and by `server/index.ts` (Express) in production. Uses `pdf-merger-js`. Only HTTP(S) URLs; skips ones that fail, 502 if none merge.

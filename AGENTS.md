# AGENTS.md - PatientPortal-frontend

## Repository Role
This repository is the AHCS Patient Portal frontend application.

Responsibilities:
- Patient-facing portal screens and workflows
- Staff/admin-facing portal screens included in this frontend
- Authentication-aware routing and session behavior
- API integration with the AHCS backend
- Patient documents, forms, appointments, billing, messages, profile, and health views
- Responsive UI built with React, Vite, Tailwind, Radix UI, and local UI components
- Local PDF merge endpoint behavior for development and production builds

## Agent Role
You are the Patient Portal Frontend Developer agent.

## Session Startup
At the start of every session in this repository:
- Read this `AGENTS.md` before making changes.
- Check `git status --short --branch`.
- Confirm the current branch and whether it is up to date before coding.
- Sync with the branch the developer is currently working on, not always `main`.
- Pull from the current branch's upstream before coding when it is safe to do so.
- Use `main` only when starting fresh, when the current branch is `main`, or when the user explicitly asks.
- Never pull from or push to `main` without first confirming with the developer and clearly saying the action targets `main`.
- Read the project knowledge base in `claude_docs/` for architecture, auth/session, API layer, and case-scoping context before non-trivial work.
- Classify the task as small, medium, or risky before choosing how much planning and model power to use.
- After completing any feature, enhancement, bug fix, refactor, or other notable change that you make, append an entry to `CHANGELOG_AI.md` (newest at top) before finishing the task. Do not auto-log the developer's own manual edits, but when the developer explicitly asks, read `git log`/`git diff` and add changelog entries for those human-made changes too.
- If the task is unclear, inspect the relevant files first and ask only when a safe assumption is not possible.
- If the task is risky, security-sensitive, auth-sensitive, deployment-sensitive, or touches patient data exposure, give a CTO-style plan first and wait for approval.

## Model Selection
Choose the smallest model that can safely complete the task without compromising quality.

- Use a fast/low-cost model for small, low-risk work:
  - Reading files, summarizing code, answering simple questions
  - Copy changes, labels, wording, minor CSS tweaks
  - Single-component UI adjustments with no auth/API impact
  - Documentation updates
  - Simple Git status, branch, pull, or setup checks
- Use a balanced/standard coding model for normal product work:
  - Most React/Vite component changes
  - Form behavior, validation, routing, layout fixes
  - API integration where the endpoint and data shape are already clear
  - Debugging a localized bug
  - Adding focused tests or fixing straightforward TypeScript errors
- Use a stronger/high-reasoning model for risky or complex work:
  - Auth/session/token behavior
  - Permission boundaries between patient, staff, and admin views
  - Patient data privacy, document access, billing, messages, or health data exposure
  - Multi-file refactors or shared state changes
  - Ambiguous bugs where the root cause is unknown
  - Build/deploy workflow changes
  - Security-sensitive changes
  - PR reviews where missing a defect would be costly

Default policy:
- Start with a lower-cost model for exploration when the task is unclear.
- Escalate only when the code path is sensitive, the change spans multiple systems, or confidence drops.
- Do not use a high-reasoning model just to inspect files, run commands, format docs, or make obvious small edits.
- Do use a high-reasoning model before changing auth, permissions, patient-data access, deployment, or broad architecture.

## Rules
- Work only inside this repository unless the user explicitly asks otherwise.
- Do not modify backend, server deployment, or external API behavior unless explicitly requested.
- Follow existing component, page, hook, context, and lib patterns.
- Follow the existing styling system in `client/src/index.css`, `client/src/components/ui`, Tailwind classes, and Radix UI patterns.
- Do not hardcode API responses or patient data that should come from the backend.
- Never commit secrets, tokens, credentials, real patient data, or private health information.
- Preserve existing auth/session behavior, including token storage, guarded routes, and 401 handling.
- Treat patient data, documents, messages, notes, and billing information as sensitive.
- Keep UI responsive across mobile and desktop.
- Handle loading, error, empty, and unauthorized states for user-facing workflows.
- Avoid unrelated redesigns or broad refactors unless the user asks for them.
- Do not bypass permission checks or expose staff/admin-only flows to patients.
- Prefer small, reviewable changes on a feature branch.

## Project Facts
- GitHub repo: `Advantage-Brain-and-Trauma/PatientPortal-Frontend`
- Remote: `https://github.com/Advantage-Brain-and-Trauma/PatientPortal-Frontend.git`
- Main branch: `main`; active development branch: `staging`
- Both branches auto-deploy on push — see "Git Workflow" below. There is no non-deploying branch.
- Local dev command: `corepack pnpm run dev`
- Local dev URL: `http://localhost:3000/`
- Install command: `corepack pnpm install`
- Type check command: `corepack pnpm run check`
- Build command: `corepack pnpm run build`
- Default API base URL fallback: `https://adm.advantagehcs.com/api`
- Vite env variables currently referenced:
  - `VITE_API_BASE_URL`
  - `VITE_OAUTH_PORTAL_URL`
  - `VITE_APP_ID`
  - `VITE_FRONTEND_FORGE_API_KEY`
  - `VITE_FRONTEND_FORGE_API_URL`
  - `VITE_ANALYTICS_ENDPOINT`
  - `VITE_ANALYTICS_WEBSITE_ID`

## Context Intake Checklist
Follow this same workflow at the start of every task, in order:
1. Read the relevant memory and documentation first — the memory index (`MEMORY.md`) and the relevant `claude_docs/` files, plus this `AGENTS.md`.
2. Analyze the existing implementation the task touches.
3. Review the affected code and the recent Git state (`git status`, current branch, recent commits, and any uncommitted diff). Read-only Git only.
4. Prepare an implementation plan/approach.
5. Present the plan and WAIT for the developer's explicit approval before editing anything.
6. Implement the changes to local files only.
7. Update `CHANGELOG_AI.md` with an entry for the change.
8. Provide a summary of all modified/added/renamed/deleted files with a brief per-file explanation.
- Never commit, push, branch, or run any state-changing Git command unless the developer explicitly asks.

## UI Consistency Checklist
Every UI implementation must conform to the project's existing design system — reuse existing patterns instead of creating new ones unless explicitly required:
- **Design system:** use shadcn/ui (new-york) primitives in `client/src/components/ui/` and Tailwind v4 tokens from `client/src/index.css`. Extend components via `cva` variants + the `cn()` helper (`lib/utils.ts`); do not fork components or add competing styles.
- **Colors:** use the semantic CSS-variable tokens (`bg-primary`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`, `bg-destructive`, `sidebar-*`, etc.). Never hardcode hex values. Brand red = `--primary`, brand blue = `--sidebar-primary`.
- **Typography:** headings use `font-heading` (Plus Jakarta Sans); body uses `font-sans` (Inter). Use the Tailwind type scale; do not introduce other fonts or manual size overrides.
- **Spacing / radius / shadow:** follow the Tailwind spacing scale, `--radius` (`rounded-md`/`rounded-lg`), and the `.shadow-soft` utilities. Use the `.container` utility for page layout.
- **Icons / toasts:** icons via `lucide-react`; toasts via `sonner` (and the shadcn toaster) — match existing usage.
- **Responsiveness:** keep layouts responsive across mobile and desktop, mirroring sibling screens.
- **Dark mode:** verify both light and dark (`.dark`) — using tokens keeps dark mode correct automatically.
- **Accessibility:** preserve semantic HTML, labels, `focus-visible` rings, and aria attributes as the existing `ui/` components do.
- **Conventions:** use the `@/` and `@shared/` path aliases and match existing formatting (Prettier). Before building UI, look at a neighboring page/component and mirror its structure, tokens, and spacing.

## Before Coding
Always identify:
- Patient, staff, or admin screens affected
- Components, hooks, contexts, and API helpers affected
- API endpoints used or changed
- Expected request and response data shape
- Authentication and permission requirements
- Form validation requirements
- Loading, error, empty, and unauthorized states
- Mobile and desktop behavior
- Risk of exposing sensitive patient or staff data

## Task Handling
- Plan-first is the default: for any feature, enhancement, bug fix, or refactor, first analyze the codebase and current implementation, then present the implementation plan/approach and STOP. Do not edit any files until the developer explicitly approves the plan.
- Only truly trivial edits dictated verbatim by the developer (e.g. a specific typo or wording fix) may skip the plan step.
- Make changes to local files only. Never run git add/commit/push, and never ask or offer to, unless the developer explicitly requests it.
- After completing the work, provide a summary of every modified, added, renamed, and deleted file with a brief per-file explanation. The developer reviews and handles commit/push manually.
- Small tasks: still present the plan (it can be brief), wait for approval, then make the minimal safe change.
- Medium tasks: give a plan, wait for approval, then implement.
- Risky tasks: give a CTO-style plan first and wait for approval.
- UI tasks: preserve existing design patterns, responsive behavior, loading states, empty states, and error handling.
- API tasks: identify endpoints, request data, response data, auth requirements, and failure states before editing.
- Auth/session tasks: preserve token handling, guarded routes, logout behavior, and 401 handling unless the user explicitly asks for a change.

## Testing
Run the most relevant available commands before finishing:
- `corepack pnpm run check`
- `corepack pnpm run build`
- `corepack pnpm run dev` when visual verification is needed

When UI behavior changes, verify the affected flow in the browser when practical.

Current known setup note:
- `corepack pnpm run check` currently reports existing TypeScript errors in `client/src/contexts/AuthContext.tsx` and `client/src/pages/Documents.tsx`. Do not treat those as caused by unrelated changes unless your work touches them.

## Git Workflow
- The developer handles ALL Git operations. Do not run any state-changing Git command — no add, commit, push, pull, fetch, branch, checkout/switch, merge, rebase, reset, restore, stash, or tag — unless the developer explicitly asks in that request. Read-only Git (`status`, `diff`, `log`, `show`) is fine and expected for gathering context.
- Make changes to local files only and leave them uncommitted for the developer to review, commit, and push manually.
- Do not create branches, open pull requests, or amend/revert commits on your own.
- Never suggest or offer to commit or push; wait for an explicit instruction.
- Do not revert the developer's changes or unrelated work.
- Deploy context (do not trigger): **both** long-lived branches deploy on push. Treat any push, and any merge into either branch, as deploy-affecting and leave it to the developer.
  - `staging` → `.github/workflows/deploy-staging.yml`: GitHub-hosted runner, Node 22 + pnpm (corepack), `pnpm install --frozen-lockfile` + `pnpm run build`, then SSH+rsync of `dist/public/` to Cloudways (`/home/master/applications/rxtdnqswpd/public_html`).
  - `main` → `.github/workflows/deploy.yml` ("Auto Deploy Patient Portal"): self-hosted **production** runner. Hard-resets `/var/www/html/patient-portal` to `origin/main` (`git reset --hard` + `git clean -fd`), installs, builds, then restarts Apache. The hard reset discards anything sitting on the production box.

## Output Required
When finished, provide:
- Files changed
- Screens or workflows changed
- API dependencies
- Auth/permission considerations
- Build/test results
- Risks or follow-up notes
- Git branch, commit, push, or PR details when applicable
- A new `CHANGELOG_AI.md` entry documenting the change (required for any code change)

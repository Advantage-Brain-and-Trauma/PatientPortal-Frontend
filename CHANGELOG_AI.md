# CHANGELOG_AI

An auditable, human-readable record of every change made by an AI assistant
(Claude Code) to this repository — features, enhancements, bug fixes, refactors,
and notable configuration/docs changes.

**Conventions**
- Newest entries at the **top**.
- One entry per task/change-set. Use the date (`YYYY-MM-DD`) as the heading.
- For each entry note: **What** changed, **Files/areas** touched, and any
  **Auth / case-scoping / patient-data** considerations (mirrors the
  "Output Required" section of `AGENTS.md`).
- **Scope:** AI-made changes are logged automatically. The developer's own
  manual changes are logged only when the developer explicitly asks the AI to
  record them (the AI reads `git log`/`git diff` to do so).
- This log is maintained by the AI assistant per the standing project
  convention; it does not replace `git log`.

---

## 2026-09-28

### Feature: floating Patient Support chat widget (Location -> Case ID -> Chat)
> **What:** Added a bottom-right chat launcher + compact popup on every patient page, built on
> the backend-pp patient chat API (case-scoped threads, per the "Patient Portal Chat - API
> reference" sheet updated 2026-09-28). Flow: Welcome -> Location -> Case ID -> Connecting ->
> Conversation, driven by one explicit `view` state. Locations and cases both come from
> `GET chat/cases` (one row per case with its backend-derived `department`); the Location step
> is skipped when there is one location and the Case ID step when the location has one case.
> Empty states: No locations / No cases (Back only when there were multiple locations).
> `POST chat/conversations {case_id, department}` find-or-creates the thread for the case, so
> reopening a case reuses its existing uuid. The transcript loads the newest page (API is
> oldest-first, paginated) with "Load earlier messages"; staff replies are labelled
> "{Location} Care Team" and no staff identity fields are read. No realtime API exists, so the
> open thread is polled every 5s with a self-scheduling timeout (no overlap), only while the
> popup is open, not minimized and the tab visible; messages are de-duplicated by id. Case
> labels reuse the sidebar format "MM/DD/YYYY - PI" (insurance type joined by case id from
> `get-case-ids-by-email`, best-effort). No attachment control (no upload endpoint), no unread
> badge (not in the patient API), no "Online" presence (not in the API), no third-party
> branding.
>
> **Files/areas:** `client/src/lib/chatApi.ts` (new), `client/src/components/chat/PatientChatWidget.tsx`
> (new), `client/src/App.tsx` (import + mount next to `MultipleFunnelSelectionModal`).
>
> **Auth / case-scoping / patient-data:** Chat calls use a SEPARATE axios instance so the shared
> interceptors never apply: the portal JWT is sent only to `chat/identify/patient`, all other
> calls use the `chat_token`, and a chat 401 re-identifies once then shows "session expired" —
> it never triggers the global logout/redirect. No `?case_id=` auto-injection on chat calls (the
> case is explicit in the body). The chat token is memory-only and cleared when the signed-in
> user changes; message bodies and tokens are never logged; nothing is written to storage.
> Widget renders only for authenticated non-staff/non-admin users outside `/login` and
> `/reset-password`. `api.ts`, `network.ts`, AuthContext, Layout and the sidebar case selector
> are unchanged. `pnpm run check` and `pnpm run build` pass.

---

## 2026-09-03

### Docs: correct stale repo/deploy facts and seed the Claude memory index
> **What:** The project's Claude memory directory was empty, so nothing loaded automatically at
> session start — all accumulated context lived only in `claude_docs/` and `AGENTS.md`, which
> `AGENTS.md` expects the agent to open by hand. Seeded three memory files plus a `MEMORY.md`
> index pointing at the in-repo knowledge base, the plan-first / no-git-writes / always-log
> conventions, and the deploy behavior.
>
> While verifying those facts, two docs turned out to be **stale**. `AGENTS.md` named the repo
> `mosetayesh/PatientPortal-frontend`; `claude_docs/project-facts.md` named
> `dev-saman/PatientPortal-Frontend`. The live remote is
> **`Advantage-Brain-and-Trauma/PatientPortal-Frontend`**. `project-facts.md` also claimed
> `deploy-staging.yml` was "the only workflow" — `.github/workflows/deploy.yml` also exists and
> **auto-deploys `main` to production** on a self-hosted runner, hard-resetting
> `/var/www/html/patient-portal` to `origin/main` and restarting Apache. Both files now record
> that **both branches deploy on push** and that there is no non-deploying branch.
> The now-resolved "AGENTS.md is stale" warning in `project-facts.md` was replaced with a note
> that the remote moved and that `git remote -v` beats any doc.
>
> **Files/areas:** `AGENTS.md` (Project Facts block; Git Workflow deploy-context bullet);
> `claude_docs/project-facts.md` (repo/remote + CI/CD sections). Memory files live outside the
> repo, under the user's Claude project memory directory.
>
> **Auth / case-scoping / patient-data:** None — documentation only, no application code, API,
> auth, or case-scoping behavior touched. No build or type-check impact.

---

## 2026-08-13

### Restrict the information shown on the preauthorization card
> **What:** Reduced what the "Select Preauthorization" modal exposes on each preauth card.
> **Removed:** the `Service` value (and the combined "Service / Visit type" label), the
> `Referring physician` row, and the `Company` row. **Kept:** facility name, the used/total
> sessions badge, the status pill, the visit type, and the authorized date range. Applies to
> every card state — the status labels themselves are unchanged ("Ready to schedule" /
> "Under Review" / "Activation required").
>
> The remaining row is now labelled **`Visit Type:`** and reads `p.visit_type` (the field
> the scheduling modal already treats as the canonical visit-type code) rather than the
> previous `p.service / p.pa_req` pair. A new `visitTypeLabel()` helper formats it as
> **`Physical Therapy (PT)`** — display name followed by the code — degrading to the bare
> code while `visit_type_name` is absent from the API, so the full format appears
> automatically once the backend returns it. Filed as **BR-14**. No code→name mapping was
> added to the frontend.
>
> **Files/areas:** `client/src/components/SelectPreauthorizationModal.tsx` (card body grid;
> typed `visit_type_name` on `PreauthRecord`); `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md`
> (BR-14 + triage row).
>
> **Auth / case-scoping / patient-data:** Strictly reductive — three fields
> (referring physician, company, service) are no longer rendered in the portal. No API,
> auth, or case-scoping behavior changed; no new requests. `tsc --noEmit` passes clean.

---

### Gate booking/rescheduling on the backend's `allow_visit_type` flag
> **What:** Some visit types can't be self-booked and must be arranged by phone.
> `GET get-approved-preauth` now returns two new per-record fields — `allow_visit_type`
> (`1` = patient may book, `0` = must call) and `facility_phone_no` (pre-formatted by
> the backend, e.g. `"(214) 941-4550"`) — neither of which the frontend read. Both are
> now typed on `PreauthRecord` and consumed.
>
> When the flag is `0`, the **Schedule Your Remaining Appointments** modal replaces the
> "Choose a day" strip and the time-slot grid with a new **Please Call to Schedule**
> panel showing `{location}: {facility_phone_no}` (e.g. "Dallas: (214) 941-4550"),
> swaps the "Your appointments" sidebar for a
> "Scheduling assistance" card, hides the subtitle/session banner, and hides the
> **Schedule** button. `loadBlock()` early-returns so **no** `get-time-slots-date-range`
> request is made at all (also relieves the known 429 pressure on that endpoint).
>
> The **Reschedule** modal has the same gate wired (call panel replaces the date picker,
> Available Times and reason select; `Re-Schedule` button hidden; both availability
> fetches skipped). It is **dormant** until the backend adds the two fields to
> `get-appointment/{id}` — see BR-13 in `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md`. Until
> then the reschedule flow behaves exactly as before.
>
> Readiness rule: **only an explicit `0` blocks.** The API currently returns
> `allow_visit_type: null` on some records (e.g. `ma_id 186341`); `null`/`undefined`
> falls through to the normal slot flow rather than locking every patient out. The
> predicate `isCallOnlyVisitType()` is the single shared place that decides this — no
> other business logic was added to the frontend. No hardcoded fallback phone number:
> when `facility_phone_no` is absent the number line is simply omitted.
>
> **Files/areas:** new `client/src/components/CallToSchedulePanel.tsx` (exports
> `CallToSchedulePanel` + `SchedulingAssistanceCard`; the panel takes `phone`, `location`
> and an overridable `title`; tokens only — `border-primary/30`,
> `text-primary`, `font-heading`, no hardcoded hex); `client/src/components/
> SelectPreauthorizationModal.tsx` (typed `allow_visit_type`, `facility_phone_no`,
> `schedule` on `PreauthRecord`; new exported `isCallOnlyVisitType`);
> `client/src/components/ScheduleAppointmentModal.tsx` (`callOnly` derivation,
> `loadBlock` guard + dep, header/banner/body/footer branches);
> `client/src/pages/Appointments.tsx` (`AppointmentDetail` gains both fields,
> `openRescheduleModal` skips `initRescheduleSlots`/`loadRescheduleMonthWindow`,
> `rescheduleCallOnly` derivation, modal body + footer branches);
> `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md` (BR-13).
>
> **Auth / case-scoping / patient-data:** None changed. No new API calls were added and
> no endpoint signatures changed; `get-approved-preauth` keeps its automatic
> `?case_id=` injection (it is not in `CASE_ID_EXEMPT_ENDPOINTS`). Net effect on traffic
> is a reduction — slot requests are suppressed for call-only visit types. The facility
> phone number is rendered as a `tel:` link (digits stripped for the `href` only; the
> visible label is the backend's string verbatim). `tsc --noEmit` and `vite build` both
> pass clean.

---

## 2026-07-27

### Hide the per-card "Cancel" appointment button (UI only)
> **What:** Removed the red **Cancel** button from each appointment card on the
> Appointments page (it sat next to **Reschedule**). This is a UI-only change: the
> button is now gated behind a new module-level flag `SHOW_CANCEL_BUTTON = false`.
> All cancellation logic remains fully wired and untouched — the cancel modal, the
> 24h too-soon guard, `openCancelModal` / `closeCancelModal` / `handleCancelSubmit`,
> all cancel-flow state, and the `Apis.cancelAppointment` POST. To bring the button
> back, flip `SHOW_CANCEL_BUTTON` to `true`; no other edits needed.
>
> **Files/areas:** `client/src/pages/Appointments.tsx` (added `SHOW_CANCEL_BUTTON`
> constant near `MODIFIABLE_APPOINTMENT_STATUSES`; wrapped the Cancel button JSX in
> the flag).
>
> **Auth / case-scoping / patient-data:** None. No API, auth, or data-scoping
> behavior changed — purely a visual toggle. `tsc --noEmit` passes clean.

---

## 2026-07-24

### Redesign: "Schedule Remaining Appointments" modal (UI/UX only)
> **What:** Replaced the modal's spreadsheet-style UI with a cleaner, patient-friendly
> layout matching the new design. The old 10-field read-only form grid became a single
> compact context line (speciality · provider · location · date range); the multi-column
> time table (5 day columns × every 15-min row, mostly "Not Available" cells) became a
> horizontal **day-pill strip** (with ‹/› paging arrows) plus a grid of **only the
> available start times** rendered as large tappable buttons for the focused day. The
> right "Selected Appointments" column was restyled into a green **"Your appointments"**
> summary panel ("X of N selected", empty state "Select a time to add it here."). Title
> is now "Schedule Your Remaining Appointments" with a subtitle. Hardcoded inline hex
> colors were swapped for theme tokens (`bg-primary`, `border-border`, `bg-muted`, …) so
> the modal adapts to dark mode; hover was moved from JS mouse handlers to `hover:`
> classes via `cn`. Panel width reduced (`!max-w-[880px]`), responsive at 375/768/1024px.
>
> **Behavior/validation unchanged:** all data fetching (block cache + prefetch, staleness
> guard), preauth preselection, `checkSessionsCompleted` → `sessionLimit`, per-day
> selection model, continuous-availability check (→ `SlotTooShortModal`), session-limit
> guard, and `handleSchedule` (one POST per day) are untouched. Unavailable / lunch /
> holiday / booked / past slots are now hidden rather than shown greyed (per design).
> Added `activeDate` state + a focus-defaulting effect; removed now-unused `pageTimeSlots`,
> `fieldCls`, `visitTypeOptions`, and the visit-type/company/provider-id display labels.
>
> **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx` (only). No changes
> to `Apis`, `Appointments.tsx`, `SlotTooShortModal.tsx`, or `dialog.tsx`.
>
> **Auth / case-scoping / patient-data:** none — no API surface changed; scheduling still
> runs in the selected preauth's `case_id/ma_id/patient_id` context exactly as before.

### Follow-up refinements (same file, same day)
> Post-review polish to the redesigned modal, all in `ScheduleAppointmentModal.tsx`:
> - **Only fully-fitting slots shown.** `availableSlots` now additionally requires enough
>   *continuous* availability from each slot to hold the full visit duration
>   (`blockTickAfter(d, startMin) - startMin >= slotDuration`). Slots that can't fit the
>   whole appointment are hidden, so the "Time Slot Not Long Enough" dialog is no longer
>   reachable from the grid (its guard stays in `handleSlotClick` as a defensive no-op).
> - **Removed the "Book at least 24 hours ahead" note.** Redundant: the backend returns
>   sub-24h slots as `not_available`/`disabled` (in clinic `America/Chicago` time), and the
>   available-only grid never renders them — so invalid slots are filtered before display.
>   No client-side time filtering added (a browser-local check could misfire across
>   timezones). Dropped the now-unused `Clock` import.
> - **Layout/readability:** widened panel `!max-w-[880px]` → `!max-w-[1040px]` (`w-94%`);
>   time grid `sm:grid-cols-3` → `sm:grid-cols-4` (4 per row); section headings
>   `text-sm` → `text-base`; day-pill text vertically centered
>   (`flex flex-col items-center justify-center`); hid the day-strip horizontal scrollbar
>   (`[scrollbar-width:none]` + WebKit/MS variants) while keeping swipe/scroll.
> - **Context bar reworked** into a single bordered line ordered **Location · Speciality ·
>   Provider**, each segment with a lucide icon (`MapPin`/`Stethoscope`/`User`) and a
>   vertical divider. The authorized service date range moved out of this bar to sit
>   beside the "Choose a day" heading.
> - **Day-strip polish:** day cards now stretch to fill the width between the nav arrows
>   (`flex-1 min-w-[84px]`, was fixed `min-w-[92px]`) — no gap on either side. Replaced the
>   separate "Selected" line with an inline `Check` icon before the date text (grey
>   `text-muted-foreground/40` by default → green `text-emerald-600` when that day has a
>   selection), so all cards share one height and are more compact. Dropped the "Today"/
>   "Full" sub-labels and the now-unused `todayYMD` (disabled days still read as greyed).
>   Increased the "Choose a day" heading-to-slider spacing (`space-y-2` → `space-y-3.5`).

---

## 2026-07-15

### Appointments: status badge is API-driven; Reschedule/Cancel shown only for a Scheduled appointment
> **Key finding from the real `get-patient-appointments` payload:** `appt_status` is **hardcoded to
> "Confirmed" on every row** — a cancelled visit returns `attend_status: "Cancelled"` *alongside*
> `appt_status: "Confirmed"`. So `appt_status` is unusable as a status source; the real state is
> **`attend_status`**. (`status` isn't returned at all.) Cancelled appointments **do** appear in
> `upcoming_appointments`, so no backend change was needed.
>
> `attend_status` vocabulary (mixes codes and literals). Badge colour = a light tint of the matching
> action button (Check In = yellow, Check Out = green, Cancel = red):
> | state | `attend_status` | label | badge |
> |---|---|---|---|
> | Scheduled | `S` | **Confirmed** | light blue |
> | Check-in | `CI` | Check In | light yellow |
> | Check-out | `CO` / `1` | Check Out | light green |
> | No Show | `NS` | No Show | light slate |
> | Cancelled | `C` / `"Cancelled"` | Cancelled | light red |
>
> "Confirmed" **is** the Scheduled state — hence `MODIFIABLE_APPOINTMENT_STATUSES = {"Confirmed"}`
> (only there are the actions enabled). `APPOINTMENT_STATUS_LABELS` normalises a code → label; a value
> already sent as a literal (e.g. `"Cancelled"`) falls through unchanged.

- **What:** Prepared the upcoming appointment card to reflect the appointment's real status.
  (1) `APPOINTMENT_STATUS_STYLES` is no longer a **whitelist** — previously `renderAppointmentTag`
  returned `null` for any value not in the map (only `Confirmed` / `Action Required`), so a status like
  "Cancelled" or "Check In" would have rendered **no badge at all**. It is now a *styling* map with an
  `UNKNOWN_STATUS_STYLE` fallback, so whatever status the API returns always renders (un-themed if
  unrecognised). Added colours for Scheduled / Check In / Check Out / No Show / Cancelled / Rescheduled
  (Cancelled = light red). `renderAppointmentTag` gained an optional `fallbackClassName` — the visit-type
  tag keeps its hide-if-unmapped behaviour.
  (2) Reschedule/Cancel are **disabled** (not hidden) unless the appointment is still modifiable, so every
  card keeps the same height and the layout stays consistent. Each is wrapped in an `inline-flex` span that
  carries `cursor-not-allowed` when disabled — the cursor can't live on the button itself because `Button`
  sets `disabled:pointer-events-none`, so a disabled button receives no hover at all.
- **Status logic is isolated** in two module-level knobs: `appointmentStatusOf(appointment)` (reads
  `attend_status`, normalising code → label) and `MODIFIABLE_APPOINTMENT_STATUSES` (which statuses keep the
  buttons). No status literals appear in the JSX. Added `attend_status` to the `Appointment` interface with
  a comment warning that `appt_status` is always "Confirmed" and must not be used.
- **Also:** the Reschedule modal's read-only "Visit Status" field read the same hardcoded `appt_status`;
  it now uses `appointmentStatusOf(...)` so it shows the real state.
- **Visit Summary modal fixed too:** its status pill was built from `appt_status` (always "Confirmed") with
  an unconditionally **green dot** and no per-status colour — so a cancelled past visit read "Confirmed"
  with a green dot, while the raw `Attend Status: S` field sat right below it. It now derives the label from
  `attend_status` via `appointmentStatusOf`, tints the pill with `APPOINTMENT_STATUS_STYLES`
  (`UNKNOWN_TAG_STYLE` fallback), and the dot uses `bg-current` so it inherits the status colour instead of
  being hardcoded. `appt_status` and `attend_status` are now in `HIDDEN_KEYS` (the former is misleading, the
  latter redundant now the badge shows a proper label). `appointmentStatusOf` was loosened to accept
  `{ attend_status?: string | null }` so the loosely-typed `selectedVisit` can use it without a cast.
- **Visit-type badge made dynamic too:** `APPOINTMENT_VISIT_TYPE_STYLES` was likewise a whitelist
  (`In-Person`/`Telehealth`), so any other `is_virtual_text` rendered no badge. It now passes the shared
  `UNKNOWN_TAG_STYLE` fallback, so whatever the API returns always renders (added a `Virtual` colour).
  `UNKNOWN_STATUS_STYLE` renamed → `UNKNOWN_TAG_STYLE` since both badges share it.
- **Backend audit note:** `get-patient-appointments` could not be verified from source — it doesn't exist in
  the local `Medhiwa-23` repo (no route/controller; `appt_status` appears 0 times); it lives in the separate
  `adm.advantagehcs.com` codebase, not available locally (a live call returned 401 — expired token). Settled
  from the real payload supplied by the developer instead.
- **Files/areas:** `client/src/pages/Appointments.tsx` (`Appointment.attend_status`,
  `APPOINTMENT_STATUS_LABELS`, status styles + fallback, `renderAppointmentTag`, `appointmentStatusOf`,
  `MODIFIABLE_APPOINTMENT_STATUSES`, `canModifyAppointment`, card badge + buttons, Visit Status field).
- **Auth / case-scoping / patient-data:** None (presentation only).

### Appointments: Time/Location no longer split 50/50 on the upcoming appointment card
- **What:** The Time + Location row was a `grid md:grid-cols-2` — a hard 50/50 split that pushed Location
  far to the right regardless of content. It's now a `flex flex-wrap` with a **30px** horizontal gap
  (`gap-x-[30px]`), so Location sits just after the Date/Time. The rest of the card's spacing/sizing is
  unchanged. (An interim revision also compacted the card's padding/type scale; that was reverted at the
  developer's request — only the Time/Location layout change remains.)
- **Files/areas:** `client/src/pages/Appointments.tsx` (upcoming appointment card). The Past list uses a
  separate row layout and was left unchanged.
- **Auth / case-scoping / patient-data:** None (presentation only).

### UI: smaller corner radius app-wide; Cancel modal simplified to header / reason / footer
- **What:** (1) **Radius** — lowered the base `--radius` token from `0.75rem` (12px) to `0.4375rem` (7px)
  in `index.css`. Buttons/inputs use `rounded-md` = `calc(--radius - 2px)`, so they go from **10px → 5px**;
  everything else scales down proportionally (sm 3px / md 5px / lg 7px / xl 11px). Done via the token
  rather than per-component so the whole UI stays consistent. (2) **Cancel modal** — removed the read-only
  **Date / Time / Location** fields; it's now just a bordered header (title + close icon), the "Reason for
  Cancellation" dropdown (+ "Please specify the reason" when Other), and a bordered footer holding
  **Keep Appointment** / **Cancel Appointment**. The footer moved outside the body block so it renders as a
  proper modal footer.
- **Files/areas:** `client/src/index.css` (`--radius`), `client/src/pages/Appointments.tsx` (Cancel modal).
- **Auth / case-scoping / patient-data:** None (presentation only).

### Appointments: add a Cancel button + cancel flow (with the same 24h restriction), restyle action buttons
- **What:** Added a **Cancel** button beside **Reschedule** on each upcoming appointment card (replacing the
  commented-out Cancel placeholder). Both keep the subtle `variant="outline"` (white) style and gained
  icons: Reschedule a calendar icon, Cancel an ✕ icon plus a destructive tint
  (`text-destructive border-destructive/30 hover:bg-destructive/10`) — using the design-system token rather
  than a hardcoded red. (An interim version used solid amber/red buttons; reverted as too bright and
  off-palette.) The Cancel modal's confirm button uses the maroon primary
  (`bg-primary hover:bg-primary/90`), matching the Schedule Appointment button.
  Clicking Cancel enforces the **same 24-hour rule as Reschedule** — an appointment
  less than 24h away shows a "Cannot Cancel This Appointment" restriction modal (`BookingTooSoonModal`
  with cancel copy) and never opens the form. Otherwise a Cancel modal opens showing a read-only summary
  (date / time / location) plus a required **"Reason for Cancellation"** dropdown (reusing
  `get-appointment-reasons`) and the **"Please specify the reason"** free-text when "Other" is selected —
  mirroring the Reschedule modal's inline field validation. Submitting calls the cancel API, toasts, closes
  and refreshes the list.
- **API:** New `Apis.cancelAppointment(name, caseId, apptId, payload)` →
  `POST appointment-cancel/{user_name}/{case_id}/{appt_id}` with a JSON body (`attend_id`, `ma_id`,
  `case_id`, `provider_id`, `attend_date2`, `attend_status: "Cancelled"`, `attend_reason_id`,
  `attend_notes`), mirroring `scheduleAppointment`'s path-segment style. `user_name` comes from
  `useAuth()`'s `user.name`; `ma_id`/`provider_id` from the `get-appointment` detail. Added
  `appointment-cancel` to `CASE_ID_EXEMPT_ENDPOINTS` since `case_id` is already a path segment + body field.
- **Files/areas:** `client/src/lib/Apis.ts` (`cancelAppointment`), `client/src/lib/api.ts`
  (case_id exemption), `client/src/pages/Appointments.tsx` (cancel state, `openCancelModal` /
  `handleCancelSubmit`, Cancel modal, action buttons, cancel too-soon copy, `useAuth`).
- **Auth / case-scoping / patient-data:** Case-scoped via `getActiveCaseId()` (passed explicitly as a path
  segment + body field, hence the exemption). No new auth surface. The backend remains authoritative on
  cancellation; the 24h check is immediate UX feedback only.

### Schedule: 24h advance-booking rule now backend-owned — slots render "Not Available" instead of a modal
- **What:** The backend now returns slots inside the 24-hour window as
  `{ type: "not_available", disabled: true, reason: "Requires 24 hours advance booking" }`, so the
  frontend no longer duplicates the rule. In `ScheduleAppointmentModal`: removed the client-side lead-time
  check in `handleSlotClick`, the `MIN_LEAD_HOURS` constant, the `showTooSoonModal` state and the
  `BookingTooSoonModal` render/import — picking such a slot no longer pops "Cannot Book This Time Slot"
  (they're `disabled`, so they aren't clickable at all). `not_available` / `unavailable` slots now render
  as **"&lt;time&gt; – Not Available"** (previously a generic "⚠ N/A"), matching the booked/blocked style, with
  the backend's `reason` surfaced only as a hover tooltip.
- **Reschedule modal (same treatment):** its Start dropdown now sources options from the same
  `get-time-slots-date-range` endpoint, so (a) added `not_available` / `unavailable` to
  `OCCUPIED_SLOT_TYPES` — those slots show "– Not Available" and are unselectable (also excluded as
  ends) instead of appearing as a plain greyed time; and (b) removed the client-side 24h check in
  `handleRescheduleStartChange`, which previously popped `BookingTooSoonModal` on picking a too-soon
  start (now impossible — the backend marks them `disabled`).
- **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx` (lead-time check, modal/state/
  constant removal, `not_available` cell render); `client/src/pages/Appointments.tsx`
  (`OCCUPIED_SLOT_TYPES`, `handleRescheduleStartChange`, submit-guard comment).
- **Auth / case-scoping / patient-data:** None. Moves a business rule from the frontend to the backend
  (thin-frontend); the backend remains authoritative and `appointment-schedule` still validates on submit.
  The "Appointments can only be booked at least 24 hours in advance." info note is kept as context for why
  those slots are unavailable. `BookingTooSoonModal` is still used by the Reschedule flow (it guards
  *opening* the modal for an appointment that is itself &lt;24h away — a separate rule).

### Schedule grid: block-based lazy loading with background prefetch (fewer calls, no loading screen on navigation)
- **What:** "Schedule Remaining Appointments" (`ScheduleAppointmentModal`) previously fetched the entire
  pre-auth window (~120 working days, ~78 kB) in one call and paginated client-side. It now fetches in
  **blocks** — one `get-time-slots-date-range` call covers `BLOCK_PAGES` (3) pages = a 21-calendar-day
  window ≈ 15 working days (weekends omitted, so 3 × 7 days = 3 × 5 columns) — and the grid slices each
  block into 5-day pages **client-side**, so navigating *within* a block is instant. The **next block is
  prefetched in the background** as soon as you enter a block, so crossing into it also shows no loading
  screen. Blocks are cached (`blockCache`), so going back never refetches. Page 1 starts at
  `max(today, svc_date_start)`.
- **How:** `loadBlock(blockIndex, background?)` fetches+caches a block's window (skips cached/in-flight
  blocks; `background` suppresses the page loader). `ensureBlockForPage(page)` loads the page's block then
  prefetches the neighbours. The page loader (`isPageLoading`) is driven by "current block not in cache
  yet" (covers both a foreground fetch and jumping onto a still-prefetching block). A `loadGenerationRef`
  guard discards stale in-flight responses when the query resets (e.g. visit-type change). Pagination
  uses `hasPrevPage`/`hasNextPage` (in-block offset, else next-block-window vs `svc_date_end`). Tunable
  via `BLOCK_PAGES`.
- **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx` (`BLOCK_PAGES`/`BLOCK_WINDOW_DAYS`
  /`PAGE_COLUMNS` + `addDays` helpers, `blockCache`/refs, `loadBlock`/`ensureBlockForPage`/`goToPage`,
  reset + open-reset, nav controls, empty/loading render, block slicing).
- **Auth / case-scoping / patient-data:** None. Same endpoint, case-scoped as before; only the requested
  date window changes. No backend work — the endpoint already accepts `svc_date_start`/`svc_date_end`.

### Reschedule: lunch slots show "– Lunch" again in the Start Time dropdown
- **What:** After the Start options moved to `get-time-slots-date-range`, lunch slots (`type:"lunch"`)
  rendered as a plain time with no indicator (the range labels carry no "(Lunch)" suffix, unlike the old
  `available-time-slots` labels). Added a `lunch` branch to `slotDisplayLabel` so they show
  "<time> – Lunch" (disabled), matching the "– Not Available" / "– Current" style. Duration-fit checks
  already treat lunch as unavailable, so a duration spanning lunch still can't be selected.
- **Files/areas:** `client/src/pages/Appointments.tsx` (`slotDisplayLabel`).
- **Auth / case-scoping / patient-data:** None (presentation only).

### Reschedule calendar: selected date can no longer be deselected; time preserved across date changes
- **What:** (a) Added the `required` prop to the Reschedule `<Calendar>` (react-day-picker
  `mode="single"`) so clicking the already-selected date keeps it selected instead of toggling it off.
  (b) `handleRescheduleDateChange` now **no-ops when the same date is re-selected** (so re-clicking the
  chosen date no longer clears Start/End). (c) When a **different** date is picked, the previously
  selected Start/End are **kept if the full required duration still fits** on the new date (every 15-min
  block in `[start, start+duration)` is available); otherwise they clear so the user re-picks.
- **Files/areas:** `client/src/pages/Appointments.tsx` (reschedule `<Calendar>` `required`,
  `handleRescheduleDateChange`).
- **Auth / case-scoping / patient-data:** None.

### Schedule grid: a holiday closes the whole day, regardless of other-location schedule
- **What:** In the "Schedule Remaining Appointments" grid (`ScheduleAppointmentModal`), a date flagged
  `is_holiday` now renders **"Holiday" in every row** (no time slots), taking precedence over per-slot
  rendering. Previously only the slots the backend tagged `type:"holiday"` showed "Holiday", so on a
  holiday where the provider is scheduled at a *different* location (e.g. Ennis 8:00–12:00), the Dallas
  grid leaked the morning as greyed time cells (those Dallas slots are absent → rendered via the
  `!slot` fallback) while the afternoon showed "Holiday". The whole column is now "Holiday" with a
  `holiday_name` tooltip. Uses the date-level `DateSlots.is_holiday` flag already returned by
  `get-time-slots-date-range`.
- **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx` (day-cell render — day-level
  holiday check before the slot lookup).
- **Auth / case-scoping / patient-data:** None. Presentation-only; consumes the backend's existing
  `is_holiday` flag. (The reschedule calendar already disables holiday dates, so it was unaffected.)

### Reschedule: show "Not Available" (not an error) when the provider isn't available at the location
> Note: an earlier revision of this change removed Start/End pre-selection; that was reverted — the
> modal again pre-selects the appointment's current start/end on open (still marked "– Current"). The
> "Select Start Time" placeholder and the inline "Please select a start time." validation remain for
> when the user clears the selection.
- **What:** (1) **Start/End pre-selected** to the appointment's current slot on open (Start shows
  "…– Current", End the current end). (2) **Location/availability errors are now
  inline** — when `available-time-slots` returns `status:false` (e.g. multi-location: "start_time is
  outside provider schedule", or "Provider not available…"), the Start dropdown shows **"Not Available"**
  instead of popping a toast with the raw backend message. The empty-state text changed from "No slots
  available" to "Not Available".
- **Files/areas:** `client/src/pages/Appointments.tsx` — `initRescheduleSlots` / `openRescheduleModal`
  (no pre-select), `fetchRescheduleSlots` (drop the `status:false` toast), Start `<select>` placeholder +
  empty text + inline error, `handleRescheduleStartChange` (clear End on placeholder), `rescheduleErrors`
  (+`startTime`), `handleRescheduleSubmit` (require start).
- **Auth / case-scoping / patient-data:** None. (Superseded next: Start options are now sourced from
  `get-time-slots-date-range`, which fully removes the fixed-08:00 probe error.)

### Reschedule: Start-time options come from the provider's real per-date, per-location schedule
- **What:** The Start Time dropdown now loads from `get-time-slots-date-range` for the selected date +
  the appointment's location (`fetchRescheduleStartsForDate`), instead of probing `available-time-slots`
  with a fixed `start_time=08:00`. That endpoint is location-scoped and needs no `start_time`, so it
  returns the provider's actual working slots for that specific date/location — eliminating the
  "start_time is outside provider schedule" error when a provider's hours vary by date/location (e.g.
  Ennis 8–12 on the 16th, Dallas 8–12 on the 17th). On date change the options reload immediately (one
  range call for that day); available slots are selectable, booked/lunch/blocked show "– Not Available".
  End-times are still fetched from `available-time-slots` when the user picks a (now-valid) start, so it
  no longer errors. Start options' 12-hour labels ("8:00 AM") are converted to 24h `HH:MM` values via
  `rangeLabelTo24h`. `initRescheduleSlots` and `handleRescheduleDateChange` no longer auto-select a
  start (consistent with the no-pre-select behaviour); the current window is still marked "– Current" on
  the appointment's own date.
- **Files/areas:** `client/src/pages/Appointments.tsx` — `rangeLabelTo24h`, `fetchRescheduleStartsForDate`,
  `initRescheduleSlots`, `handleRescheduleDateChange` (range-sourced start options).
- **Auth / case-scoping / patient-data:** Range call is case-scoped via `getActiveCaseId()`; no new auth
  surface. `available-time-slots` is now only called with a user-chosen valid start (for end-times) —
  never with an arbitrary probe time.

### Reschedule: "Other" reason shows a required "Please specify the reason" field, with inline validation
- **What:** In the Reschedule modal, selecting the "Other" reason now reveals a text input labelled
  "Please specify the reason" (placeholder "Enter other reason…"), matching the physician reschedule
  reference. The field is required when "Other" is chosen, and its text is sent as `attend_notes` (with
  `attend_reason_id` still the "Other" reason id); for any non-"Other" reason the behaviour is unchanged
  (`attend_notes` = the reason label). "Other" is detected case-insensitively by the selected reason's
  label. The free-text is cleared when switching away from "Other" and reset on modal open.
- **Inline validation:** The reschedule form's field validations (reason not selected; "Other" reason
  empty) now render as an inline message directly **under the offending field** with a
  `border-destructive` outline, instead of a toast (`rescheduleErrors` state). Errors clear as the user
  edits each field and reset on modal open. (The 24h-too-soon and API-error toasts are unchanged.)
- **Files/areas:** `client/src/pages/Appointments.tsx` (`rescheduleOtherReason` + `rescheduleErrors`
  state, reason `<select>` onChange, conditional input, `handleRescheduleSubmit`, `openRescheduleModal`
  reset).
- **Auth / case-scoping / patient-data:** None. Payload shape unchanged (same `attend_notes` /
  `attend_reason_id` fields to `appointment-reschedule`).

### Reschedule calendar: disable non-working days, red-highlight holidays + provider-leave with tooltip, prefetch for instant month nav
- **What:** The reschedule `<Calendar>` reflects the provider's real availability from a single
  `get-time-slots-date-range` call per month (verified against the backend controller
  `PhysicanController::getTimeSlotsForDateRange`, which returns per-date `is_holiday` / `holiday_name`
  and `unavailable_reason`, and omits weekends). Each date → `rescheduleDayInfo` via `classifyRangeDate`:
  open slot → **available** (selectable); `is_holiday` → **holiday** (red + "Holiday: …" tooltip);
  `unavailable_reason === "provider_absence"` → **provider leave** (red + "Provider on leave" tooltip);
  absent (weekend) / `not_scheduled` / `no_availability` / fully-booked → **unavailable** (grey,
  disabled). Fixes: (1) **provider-leave now red** (was grey — earlier code didn't read the date-level
  fields); (2) **tooltip on holiday/leave** — those days are kept *enabled* (a disabled button suppresses
  hover) and wrapped in a styled Radix `Tooltip` (dark bubble, instant) showing "Holiday: …" /
  "Provider on leave"; their click is rejected with an explanatory toast in `handleRescheduleDateChange`
  (so they remain effectively non-selectable). Disabled (grey) days now show a `cursor-not-allowed`
  cursor (added to the shared `calendar.tsx` `disabled` classNames); red days use it too.
  (3) **Instant month navigation** — `loadRescheduleMonthWindow` prefetches
  the current month **and both neighbours** on open and on `onMonthChange`, so navigating shows
  availability immediately instead of after the request; each month is fetched at most once
  (`loadedMonthsRef`), past-only neighbours are skipped.
- **Note on call volume:** month painting no longer calls `available-time-slots` at all (that was the
  ~30-calls/month 429 source); it uses `get-time-slots-date-range` (a few one-shot calls, deduped +
  prefetched). `available-time-slots` is now only called for the selected date (start/end slots).
- **Files/areas:** `client/src/pages/Appointments.tsx` — `DayAvailability` (+`leave`), `RangeDateSlots`
  (+`is_available`/`unavailable_reason`), `classifyRangeDate`, `loadRescheduleMonthAvailability` (single
  range call) + `loadRescheduleMonthWindow` (prefetch), `handleRescheduleDateChange` holiday/leave guard,
  calendar `disabled` matcher / `onMonthChange` / `DayButton` red-highlight + tooltip.
- **Auth / case-scoping / patient-data:** The range call is case-scoped via `getActiveCaseId()`; no new
  auth surface. Backend still validates on submit. (Backend audit: the patient `get-time-slots-date-range`
  / `available-time-slots` routes are unauthenticated; `holidays` is `auth:sanctum` — not patient-reachable.)

### Reschedule: current-window labeling, read-only duration-based End time, and full-duration overlap validation
- **What:** Four fixes to the Reschedule modal's time selection, mirroring the booking flow
  (`ScheduleAppointmentModal`). (1) **Current window** — the Start dropdown now marks every slot in
  the appointment's own window `[start, end)` as "– Current" (was: only the exact start; the rest of
  its booked slots showed "– Not Available"). New `withCurrentRange` helper. (2) **End = Start +
  required duration** — changing the Start Time now sets End to `start + duration` (duration = the
  appointment's own length via `calculateDuration(detail.time, detail.end_time)`, since
  `available-time-slots` returns no `duration_minutes`) instead of the first available end. Applied in
  `handleRescheduleStartChange` and, best-effort, in `handleRescheduleDateChange`. (3) **End is now
  read-only** — the End Time `<select>` was replaced with a read-only field (`formatTime` display,
  `bg-muted` style like the other read-only fields); the user selects only the Start Time and End is
  always derived. Removed the `rescheduleEndOptions` state, its setters, and the now-unused
  `withCurrentOption` helper. (4) **Overlap validation** — if the chosen start can't fit the full
  duration (e.g. a later booking overlaps), a `SlotTooShortModal` is shown (available continuous span
  vs. required length) and the start reverts to its previous value. Wired `SlotTooShortModal` into the
  page (import + `slotTooShortInfo` state + render), mirroring the existing `BookingTooSoonModal`
  pattern. Added helpers `timeToMinutes`, `addMinutesToTime`, `formatDurationLabel`, `isSelectableEnd`,
  `continuousAvailMin`.
- **Files/areas:** `client/src/pages/Appointments.tsx` (time/duration helpers, `withCurrentRange`,
  `initRescheduleSlots`, `handleRescheduleStartChange`, `handleRescheduleDateChange`, read-only End
  field, modal wiring); reuses `client/src/components/SlotTooShortModal.tsx`.
- **Auth / case-scoping / patient-data:** None. Client-side UX pre-validation only; availability
  still comes from `available-time-slots` (case-scoped via `getActiveCaseId()`) and the backend
  re-validates on submit. Duration is derived from the appointment's own current length (the
  `available-time-slots` endpoint does not expose `duration_minutes`, unlike `get-time-slots-date-range`).

### Reschedule: restrict date range only for pre-auth bookings; drop the per-day availability probing
- **What:** (1) The Reschedule calendar's date-range clamp (min = `max(today, svc_date_start)`,
  max = `ext_date`/`svc_date_end`) now applies **only** when the appointment was booked via a
  pre-auth (`made_via === "preauth"`, case-insensitive). For any other booking (or missing/empty
  `made_via`) the calendar is bounded by **today only** (past dates + 24h rule still enforced), so it
  can be rescheduled to any future date. `made_via` and the window dates are read from the
  `get-appointment` **detail** (`appointmentDetail`), which authoritatively returns them, falling
  back to the list row; added `made_via`/`svc_date_start`/`svc_date_end`/`ext_date` to the
  `AppointmentDetail` interface (and `made_via` to `Appointment`). This fixes the calendar allowing
  dates beyond `ext_date` because the list row does not carry `made_via`.
  (2) Removed the per-day month-wide `available-time-slots` probing (it fired ~30 requests per month
  view). Availability is now fetched **only for the selected date** — on modal open (the
  appointment's own date) and again whenever the user changes the date — via the existing
  `fetchRescheduleSlots`. Holiday / provider-leave feedback still surfaces at selection time (that
  call returns `status:false` + message → toast + "No slots available"). Removed the now-unused
  holiday/leave highlight infrastructure: `loadRescheduleUnavailableDays`, `classifyUnavailableDay`,
  the `rescheduleHolidayMap`/`rescheduleLeaveMap` state, the per-date cache + circuit-breaker refs,
  and the custom calendar `DayButton` (with its `onMonthChange` loader). Dropped now-unused imports
  (`useRef`, `ComponentProps`, `CalendarDayButton`, `cn`).
- **Files/areas:** `client/src/pages/Appointments.tsx` (`Appointment` + `AppointmentDetail`
  interfaces, `rescheduleMinDate`/`rescheduleMaxDate`, `openRescheduleModal`, Reschedule calendar).
- **Auth / case-scoping / patient-data:** No new auth surface; the selected-date availability call
  keeps passing the active case id via `getActiveCaseId()`. **Backend dependency:** `get-appointment`
  must return `made_via` (confirmed in the live response) plus the pre-auth window dates; if
  `made_via` is absent the restriction is dropped for that appointment (open-calendar default).
  `Apis.getHolidays` / `getVacationCalendarBlocks` are now unused but left in place.

### Reschedule: show the appointment's own slot as "– Current" (not "– Not Available")
- **What:** In the Reschedule modal's **Start/End Time** dropdowns, the appointment's own
  currently-booked slot was rendered as "*time* – Not Available" (the backend anonymizes booked
  slots as a generic `type:"booked"` with no owner marker). It now renders as "*time* – Current".
  Renamed the `ensureOption` helper to `withCurrentOption`: when the appointment's own time is
  already present in the API list it retags that option `type:"current"` (and `disabled:false` so
  the patient can keep it); when the time is missing it still injects a synthetic `current` option
  as before. `slotDisplayLabel` gained a `type:"current"` branch emitting "– Current" (strips any
  backend parenthetical, reuses the existing en dash). Applied to both Start and End options.
- **Files/areas:** `client/src/pages/Appointments.tsx` (`withCurrentOption`, `slotDisplayLabel`,
  `initRescheduleSlots` call sites).
- **Auth / case-scoping / patient-data:** None. Presentation-only relabel; the frontend compares
  against the appointment it is already editing (`detail.time` / `detail.end_time`), not inferring
  ownership of arbitrary slots — no backend change required (see `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md` BR-10).

## 2026-07-14

### Reschedule: enforce 24h lead time on the Reschedule button (don't open the modal)
- **What:** The "cannot reschedule within 24h" restriction was previously only surfaced *inside*
  the Reschedule modal (on slot selection / submit). Now `openRescheduleModal` checks the
  appointment's own date+time first via `isRescheduleTooSoon(...)`; if it's less than 24h away it
  shows the restriction modal (`BookingTooSoonModal`) immediately and returns without opening the
  Reschedule modal. The in-modal guards remain as a safety net for a *newly picked* too-soon
  date/time (slot-change guard kept; submit guard comment updated to reflect it's now defensive).
- **Files/areas:** `client/src/pages/Appointments.tsx` (`openRescheduleModal` pre-open guard; `handleRescheduleSubmit` comment).
- **Auth / case-scoping / patient-data:** None.

### Reschedule modal: anonymize occupied Start/End time slots as "Not Available"
- **What:** The Start Time / End Time dropdowns showed the backend's raw reason on unavailable
  slots (e.g. "09:00 am (Blocked in Canton — Groups)", "(Booked)"). Mirroring the Schedule
  Remaining Appointments grid, occupied slots (types `booked`, `cross_location_booked`, `blocked`,
  `blocked_cross_location`) now render generically as "<time> – Not Available", so the patient
  can't tell whether a slot is booked, blocked, or booked at another location. Holiday, provider-on-leave,
  lunch, available, and the appointment's own current slot keep their backend labels unchanged.
  Added a module-scope `OCCUPIED_SLOT_TYPES` set + `slotDisplayLabel()` helper; the option `.map`s
  now render `slotDisplayLabel(o)` instead of `o.label`.
- **Files/areas:** `client/src/pages/Appointments.tsx` (new `OCCUPIED_SLOT_TYPES`/`slotDisplayLabel`; Start/End option rendering in the Physician Reschedule modal).
- **Auth / case-scoping / patient-data:** Reinforces slot anonymization — occupied slots no longer leak booked/blocked/location detail. Purely a display transform; the `value` submitted is unchanged.

### Reschedule modal: add missing dropdown arrow to Start Time / End Time selects
- **What:** The Start Time and End Time `<select>` menus rendered with no dropdown chevron. All
  selects in the modal use `appearance-none` (removing the native arrow), but only the Reason select
  added a custom SVG chevron back via an inline `style` `backgroundImage`. Applied the same chevron
  style to the two time selects so they match the Reason select. No className changes; the existing
  `disabled:bg-muted` behavior is preserved.
- **Files/areas:** `client/src/pages/Appointments.tsx` (Start Time / End Time selects in the Physician Reschedule modal).
- **Auth / case-scoping / patient-data:** None.

### Schedule modal: fix blank yellow cells for today's past time slots
- **What:** In the Schedule Remaining Appointments grid, today's already-passed early slots (which the
  API omits from that day's `slots[]`) fell through to an empty `<td>`. Because the row still exists in
  the cross-day union of times and today's column has a yellow background, the cell showed as a blank
  yellow box with no text. Now a missing slot renders a greyed, non-selectable placeholder — labeled
  "<time> – Past" for today, or the plain time for other days — which also covers the yellow.
- **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx` (the `if (!slot)` cell branch).
- **Auth / case-scoping / patient-data:** None.

### Reschedule modal: pre-auth date range + holiday/provider-leave calendar highlighting
- **What:** Three related date-picker enhancements, porting the Medhiwa reschedule calendar behavior:
  (1) **Pre-auth date range** — when the appointment carries a pre-auth window, the calendar restricts
  selection to it: `rescheduleMinDate = max(today, svc_date_start)` and `rescheduleMaxDate =
  ext_date || svc_date_end` (**`ext_date` takes precedence** over `svc_date_end`). Applied via
  `disabled=[{ before }, { after }]` plus `startMonth`/`endMonth`. Non-pre-auth appointments keep the
  today-floor only. Added `svc_date_start`/`svc_date_end`/`ext_date` to the `Appointment` interface
  (from `get-patient-appointments`). (2) **Holiday + provider-leave highlighting** — holidays and
  all-day provider-leave dates render red with a hover tooltip ("Holiday: <name>" / "Provider Leave:
  <label>"), via a custom react-day-picker v9 `DayButton` (reusing the exported `CalendarDayButton`)
  that sets a native `title` + red class from two date→label maps.
- **Data sources (mirrors Medhiwa `scheduling-restriction-helpers`):** `GET /api/holidays`
  (`{success, data:[{date:"26 Dec 2026", name}]}`, fetched once) and `GET /api/vacations/calendar-blocks?date=YYYY-MM-DD`
  (`{success, data:[{provider_id, duration_type, calendar_label}]}`, fetched per date across the visible
  month, filtered to the appointment's provider where `duration_type==='allday'`). Both added to
  `Apis` and to `CASE_ID_EXEMPT_ENDPOINTS` (not case-scoped). Absences are cached per date (no refetch
  on month navigation); month changes fetch the newly visible month. Everything degrades silently to
  "no highlight" if an endpoint is unavailable — matching Medhiwa's guarded helpers.
- **Files/areas:** `client/src/pages/Appointments.tsx` (`rescheduleMinDate`/`rescheduleMaxDate`,
  `loadRescheduleHolidays`/`loadRescheduleAbsences`, absence cache refs, calendar `disabled`/
  `startMonth`/`endMonth`/`onMonthChange`/custom `DayButton`); `client/src/lib/Apis.ts`
  (`getHolidays`, `getVacationCalendarBlocks`); `client/src/lib/api.ts` (exempt endpoints);
  `client/src/components/ui/calendar.tsx` (no change — `CalendarDayButton` already exported).
- **⛔ Verified backend-blocked:** live-tested with a patient JWT — `GET /api/holidays` and
  `GET /api/vacations/calendar-blocks` both return **404** on `adm.advantagehcs.com`, and Medhiwa's
  `/holidays` is `auth:sanctum` (incompatible with the patient JWT). So highlighting does **not** render
  yet. The frontend degrades silently and a circuit-breaker (`absenceEndpointOkRef`) stops after one
  failed probe to avoid a ~30-request/month storm. Highlighting activates automatically once the backend
  exposes patient-JWT reads for holidays + provider all-day leave (ideally a provider+date-range
  endpoint). Tracked in **BR-12**.
- **Auth / case-scoping / patient-data:** the two new endpoints are case_id-exempt (global/provider
  reference data). No patient data is sent beyond the provider id + date.

### Reschedule modal: 24-hour lead-time validation
- **What:** Added the same 24-hour minimum lead-time guard the booking flow uses. If the patient
  selects a Start Time (or submits) whose date+time is less than 24 hours away, a modal appears with
  the Close icon + Close button and the message: "Appointments can only be rescheduled at least 24
  hours in advance. If you still need to reschedule this appointment, please contact the support team
  for assistance." The offending selection is not accepted (the previous start stays selected). The
  check runs on start-time change and again on submit (so a preselected too-soon current time is also
  caught). Consistent with the backend rule; frontend only surfaces immediate feedback.
- **Files/areas:** `client/src/components/BookingTooSoonModal.tsx` (added optional `title`/`message`
  props, defaulting to the existing booking wording — Schedule modal unchanged); `client/src/pages/
  Appointments.tsx` (`MIN_LEAD_HOURS` + `isRescheduleTooSoon` helper, `showRescheduleTooSoon` state,
  guards in `handleRescheduleStartChange` and `handleRescheduleSubmit`, modal render).
- **Auth / case-scoping / patient-data:** None.

### Reschedule modal: date restrictions + real availability-driven time slots
- **What:** Wired the reschedule modal's Date/Start/End fields to real provider availability
  (requirements #1–#4). (1) **Date restrictions** — the calendar now disables every day before today
  via `disabled={{ before: rescheduleMinDate }}`, where `rescheduleMinDate = startOfDay(today)`; today
  and any future date are selectable.
  (2) **Real Start/End times** — replaced the static 30-minute `TIME_OPTIONS` selects (which couldn't
  represent :15/:45 times, e.g. an 8:00–8:15 visit rendered as 8:00–12:00 AM) with options loaded from
  `available-time-slots`, showing the actual 15-min slots with the backend's own `(Booked)`/`(Lunch)`
  labels and disabled states. On open, the appointment's own date/time is preselected. (3) **Reload on
  date change** — selecting a new date refetches that day's start times (auto-selecting the first
  available) and its valid end times; changing the start refetches valid end times. The current
  appointment time is always kept selectable via a fallback option.
- **Files/areas:** `client/src/pages/Appointments.tsx` (reschedule state + `initRescheduleSlots` /
  `handleRescheduleDateChange` / `handleRescheduleStartChange` / `fetchRescheduleSlots` / `ensureOption`,
  calendar `disabled`, time-select JSX; removed `generateTimeOptions`/`TIME_OPTIONS`);
  `client/src/lib/Apis.ts` (`getAvailableTimeSlots` now sends `service` + `visit_type`).
  API verified live: `available-time-slots` returns `{ status, duration_minutes, start_times[],
  end_times[] }`, accepts the department **name** for `location`, and rejects past dates with
  `{ status:false, message:"Date is in the past." }`.
- **Not done (backend-blocked):** requirement #5 (highlight provider-leave + holiday dates in red with
  hover tooltips) — documented as **BR-12** in `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md`; the current APIs
  don't expose per-date holiday/leave + reason across a month range (`available-time-slots` is
  single-date; `get-time-slots-date-range` omits unavailable days — see BR-9).
- **Auth / case-scoping / patient-data:** `available-time-slots` is case_id-exempt from auto-injection;
  `case_id` is passed explicitly via `getActiveCaseId()` (the active/selected case), alongside the
  provider/service/visit-type/department sourced from the `get-appointment` detail.

### Reschedule modal: renamed title + fixed field prefill
- **What:** (1) Renamed the reschedule modal title from `Physician Reschedule – <provider>` to
  `Reschedule – <provider>`. (2) Fixed the modal fields not pre-populating. Root cause: Location,
  Physician, Visit Type, Date, and Start/End Time were sourced from a separate `get-appointment`
  detail fetch (`appointmentDetail`) that could fail (raising "Failed to load appointment details."),
  leaving those fields blank while list-sourced fields showed. Repointed all display + editable
  fields to the appointments-**list row** (`rescheduleAppointment`), which already carries
  `department`, `provider_name`, `attend_type_full_name`, `attend_date`, `time`, `end_time` — so the
  modal is fully populated on open regardless of the detail fetch. Seeded `rescheduleDate` /
  `rescheduleStartTime` / `rescheduleEndTime` from the list row up front, and moved the `(Current)`
  time-option markers onto the list row too. The `get-appointment` fetch now serves only the
  submit-only identifiers (`ma_id`, `provider_id`, `service`) and tolerates either an array-wrapped
  or single-object `data` shape. (3) Made the reschedule modal's **Specialty/Service Type** and
  **Visit Type** fields use the same `CODE (Full Name)` value format as the Schedule Remaining
  Appointments modal (e.g. `PT (Physical Therapy)`). Visit Type derives from the list row
  (`attend_type` code + `attend_type_full_name`); Service Type prefixes the short `service` code from
  the `get-appointment` detail when available, falling back to `service_full_name` when it is not
  (the list row carries no service short-code). Existing input styling was left unchanged so the two
  fields stay visually consistent with the rest of the reschedule modal.
- **Files/areas:** `client/src/pages/Appointments.tsx` (reschedule modal title, `openRescheduleModal`
  prefill/mapping, modal field bindings, Specialty/Service Type + Visit Type value formatting).
- **Auth / case-scoping / patient-data:** No change to auth or case scoping. `get-appointment` /
  `appointment-reschedule` remain called with the active `case_id` (reschedule passes `case_id`,
  `appt_id`, `ma_id` explicitly, per its exempt-endpoint handling). Final submit-field mapping to be
  confirmed against the real `get-appointment` response.

### Audit: duplicate-visit-type prevention + multi-appointment capacity are backend-blocked (BR-10, BR-11)
- **What:** Audited the schedule APIs for two requested features — (1) prevent a second appointment
  of the same visit type on the same day (notify, auto-select the existing one, disable the rest of
  that day) and (2) multi-appointment capacity slots (show remaining capacity, enforce the configured
  group window, e.g. 10:00–11:00). Both are **not implementable frontend-side today**:
  `get-time-slots-date-range` (a) anonymizes booked slots — no owner, no visit type, and it queries
  bookings by provider+date only (no patient filter), and (b) serializes no capacity fields and emits
  only 15-min ticks with no group-window grouping. Documented the exact required response shapes as
  **BR-10** (own-appointment / `existing_appointment` + `booking_locked`; depends on BR-3
  `patient_id`) and **BR-11** (`allow_multiple`/`capacity`/`remaining` + window `start`/`end`) in
  `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md`, with the frontend plan for each once the data lands.
- **Files/areas:** `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md` (BR-10, BR-11 + summary table). No code
  change — per the thin-frontend convention, no speculative business logic was written; the frontend
  will implement (notify/auto-select/disable, and capacity/window modals) once the backend ships the
  fields and the APIs are re-audited.
- **Auth / case-scoping / patient-data:** BR-10 needs `patient_id` (BR-3) so the backend can attribute
  a booking to the current patient; visit-type matching stays backend-owned.

### Schedule modal: block slots without enough continuous availability for the visit duration
- **What:** When the patient selects an available slot, the modal now checks that there is enough
  **continuous** availability from that slot to fit the required appointment length (the visit-type
  `duration_minutes` for the selected Specialty + Visit Type). If not, a new **SlotTooShortModal**
  opens (with an **X close icon** and a **Close** button) instead of selecting — e.g. *"The available
  time slot is 15 minutes, but this appointment requires 30 minutes. Please select another available
  time slot with sufficient duration."* Durations are formatted naturally ("15 minutes", "2 hours",
  "2 hours 30 minutes"). Previously such a pick was silently truncated to the shorter span.
- **Files/areas:** `client/src/components/SlotTooShortModal.tsx` (new modal, mirrors the
  `BookingTooSoonModal` pattern); `client/src/components/ScheduleAppointmentModal.tsx` — added a
  `formatDuration` helper, a continuous-availability check in `handleSlotClick` reusing the existing
  `blockTickAfter` (span = `blockTickAfter(day, start) - start`) compared against `slotDuration`,
  `tooShortInfo` state (reset on open), and rendered the nested modal.
- **Backend dependency:** The required duration (`slotDuration`) comes from the backend's
  `duration_minutes` on `get-time-slots-date-range`; the continuous-span logic reuses the same
  frontend truncation already used by `computeAutoEnd`. No new business rule was introduced; the
  backend remains authoritative at booking time.
- **Auth / case-scoping / patient-data:** None. UX-only guard; no API calls or params changed.

### Schedule modal: hide occupancy details — show "Not Available" for all booked/blocked slots
- **What:** In the "Schedule Remaining Appointments" grid, slots previously labeled **"Booked"**,
  **"Booked for {Location}"** (incl. Telemed), **"Blocked"**, and **"Blocked in {Location} — {reason}"**
  now all render a single generic **"Not Available"** cell. The reason/location/telemed text and the
  hover `title` tooltip were removed so a patient can only tell **available vs. not available** — not
  whether a slot is booked, blocked, or booked at another location. **Holiday** and the provider-off
  cell ("Provider on Leave" / N/A) are unchanged.
- **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx` — replaced the
  booked/`cross_location_booked`/`blocked`/`blocked_cross_location` rendering branch (which built a
  detailed label from `slot.cross_location`, `slot.department`, `slot.reason`, `slot.is_cross_telemed`)
  with a static "Not Available" cell. The cell uses a solid grey background (`#f8f9fa`, matching the
  other not-available cells) with no opacity, so the "today" column's yellow highlight no longer
  bleeds through and all "Not Available" cells look consistent.
- **Auth / case-scoping / patient-data:** Privacy improvement — stops surfacing other patients'/
  locations' occupancy details in the UI. Presentation-only; no API calls or params changed. (Note:
  the backend still returns the detailed `type`/`reason`/`cross_location` fields; they are simply no
  longer displayed. If they should not reach the client at all, that would be a backend change.)

### Schedule modal: 24-hour minimum lead-time note + guard when selecting a slot
- **What:** In the "Schedule Remaining Appointments" modal, added a note below the "Select Available
  Time Slots" heading: *"Appointments can only be booked at least 24 hours in advance."* If the
  patient tries to select a slot less than 24 hours away, a new **BookingTooSoonModal** opens
  immediately (with an **X close icon** and a **Close** button) explaining that appointments can
  only be booked for slots at least 24 hours away; the slot is not selected. Deselecting an already
  selected slot is unaffected.
- **Files/areas:** `client/src/components/BookingTooSoonModal.tsx` (new modal, mirrors the
  `ActivationRequiredModal` pattern); `client/src/components/ScheduleAppointmentModal.tsx` — added
  the `MIN_LEAD_HOURS = 24` constant + lead-time note, a lead-time check in `handleSlotClick` that
  opens the modal, `showTooSoonModal` state (reset on open), and rendered the nested modal.
- **Backend dependency:** The 24-hour rule is a **backend** business rule — `appointment-schedule`
  already rejects slots < 24h away with *"The attend date and time must be at least 24 hours from
  now."* The frontend guard is immediate UX feedback only; the backend stays authoritative on
  submit. `MIN_LEAD_HOURS` mirrors that rule and is commented as such.
- **Auth / case-scoping / patient-data:** None. Presentation/UX-only change; no API calls, params,
  or data handling altered.

### Schedule modal: render "N/A" (Not Available) cells when a provider is not available
- **What:** In the "Schedule Remaining Appointments" modal, the slot grid now renders a disabled
  **"⚠ N/A"** cell (person-off icon) for any slot the backend returns as `type: "not_available"`
  (or `"unavailable"`), so a provider-unavailable day shows N/A on working rows while **Lunch** rows
  still render as Lunch — matching the reference UI exactly. As a fallback, a day returned with an
  **empty `slots: []`** array renders as an all-N/A column, and when **every** day on the current
  page is unavailable a **"Provider not available for the selected days"** placeholder is shown
  (pagination still works). Available/booked/blocked/lunch/holiday cells are unchanged.
- **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx` — imported `UserX`; added a
  `slot.type === "not_available"|"unavailable"` N/A branch (next to lunch/holiday) plus a whole-day
  `d.slots.length === 0` fallback in the slot-grid cell renderer; added the fully-unavailable-page
  placeholder and guarded the table on `pageTimeSlots.length > 0`.
- **Backend dependency:** Documented as **BR-9** in `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md`. The
  `get-time-slots-date-range` endpoint currently **omits** provider-unavailable days from `dates[]`
  (`PhysicanController@getTimeSlotsForDateRange` `continue`s on all-day absence / not-scheduled /
  no open-close), so those columns don't reach the frontend. To reproduce the reference exactly the
  backend must return those days with `type:"not_available"` working slots + existing `lunch` slots.
  The frontend is ready for that shape; no frontend business logic was added.
- **Auth / case-scoping / patient-data:** None. Presentation-only change; no API calls, params, or
  data handling altered.

---

## 2026-07-13

### Schedule modal: lock context fields to read-only, remove Reason, simplify Selected Appointments
- **What:** In the "Schedule Remaining Appointments" modal, the context fields are now
  **read-only** (view-only, non-editable): Location, Speciality/Service Type, Service
  Provider, Visit Type, Company (previously editable dropdowns) now render as disabled
  text inputs matching the already-read-only Visit Status / Provider ID / Start Date /
  End Date / Ext Date. Values are still auto-selected from the preauth on open, so the
  booking payload is unchanged — the user just can't modify them. Removed the **Reason**
  field entirely (no longer required; it was never submitted). In the **Selected
  Appointments** cards, removed the editable **End Time** dropdown and the **Transport** /
  **Virtual** toggles; each card now shows only the day header and `start → end` time with
  the **Delete** icon retained. End time is still auto-computed on slot click, so the
  displayed range and the booking payload are unaffected.
- **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx` — converted 5
  dropdowns to read-only inputs (new derived label consts); removed the `Reason` textarea,
  the `SelectField` helper, the End/Transport/Virtual UI, and the now-orphaned handlers
  (`handleLocationChange`/`handleSpecialityChange`/`handleProviderChange`/`handleEndChange`/
  `endOptionsFor`/`toggleTransport`/`toggleVirtual`), derived option lists, and unused icon
  imports (`ChevronDown`/`Car`/`Monitor`).
- **Auth / case-scoping / patient-data:** None — presentational/interaction only; no data,
  auth, API, or payload changes (the schedule request body and mappings are identical).

### Schedule modal: "SAVE" → "Schedule" + wire the appointment-schedule booking API
- **What:** The footer button in the "Schedule Remaining Appointments" modal was
  relabeled from **SAVE** to **Schedule** and given a working submit handler (it was
  previously a dead control with no `onClick`). Clicking **Schedule** now books each
  selected time slot via `POST appointment-schedule/{name}/{case_id}/{ma_id}/{patient_id}` —
  one request per selected slot (`Promise.allSettled`), showing a success toast and
  closing on success, or an error toast listing the slots that failed. The button is
  disabled while submitting (shows a "Scheduling…" spinner) and when no slot is selected.
  On success the Appointments page now **auto-refreshes** the upcoming/past lists (a new
  `onScheduled` callback triggers a refetch) so newly-booked visits appear without a
  manual page reload.
  Booking only — Transport/Virtual toggles remain UI-only (no `update-transport` call).
  The **Reason** textarea is not submitted (no corresponding field in the API contract).
  Body fields are sourced from existing modal state / the selected preauth per the
  documented mappings in `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md` (BR-4); the only
  literals (`attend_status:"S"`, `no_sessions:1`, `is_patient_portal:1`) are exactly as
  given in the provided cURL. `department` is mapped from the selected location **id** to
  its display **name**; slot times are converted from 12h labels to 24h `HH:MM`.
- **Files/areas:**
  - `client/src/components/ScheduleAppointmentModal.tsx` — button label + `handleSchedule`,
    `submitting` state, `to24h` helper, new `onScheduled` prop (fired on success).
  - `client/src/pages/Appointments.tsx` — hoisted the appointments fetch into a reusable
    `loadAppointments` callback; passed it as `onScheduled` so the list refreshes after booking.
  - `client/src/lib/Apis.ts` — new `scheduleAppointment(name, caseId, maId, patientId, payload)`
    (JSON body; keeps backend's misspelled `physicanId`/`physicanName` keys).
  - `client/src/lib/api.ts` — added `appointment-schedule` to `CASE_ID_EXEMPT_ENDPOINTS`.
  - `client/src/lib/caseContext.ts` — new `getActivePatientId()` (primary `patient_id` from the JWT).
- **Auth / case-scoping / patient-data:** `patient_id` is read from the logged-in JWT
  (`ahcs_token`), matching the cURL. `case_id`/`ma_id` come from the selected preauth and are
  passed as explicit **path** segments; the endpoint is exempt from case_id query auto-injection
  so the (possibly non-active) preauth case is not overwritten by the active case. Auth Bearer
  token is attached by the existing axios interceptor. No new persistence of patient data.

## 2026-07-10

### Funnel form list: only completed forms are clickable; uncompleted forms disabled
- **What:** In the right-side form list on the funnel page, uncompleted forms were
  clickable (they previewed for 2s then auto-redirected back). Disabled clicking on
  uncompleted forms entirely — only forms with `submission_status === "completed"`
  are now clickable (view + 2s auto-return preserved). Uncompleted forms, including
  the current pending one, have no `onClick` and show a `cursor-not-allowed` cursor,
  so the patient can only revisit forms they've already completed and stays on their
  active form.
- **Files/areas:** `client/src/pages/PatientFunnelForm.tsx` (right-card form list item).
- **Auth / case-scoping / patient-data:** None — client-side interaction/UX only;
  no data, auth, or API changes.

### Fix: funnel form status not refreshing when two cases share the same funnel id
- **What:** Switching the active case while viewing a funnel form (`/form/:funnelId`)
  did not refetch `get-patient-funnel-submission-details/<id>` when the newly
  selected case resolved to the **same** funnel id as the current one (e.g. cases
  `10006624` and `10006651` both map to `/form/33`). The case-switch handler only
  navigated via `setLocation`, which is a no-op when the funnel id is unchanged, so
  `PatientFunnelForm`'s fetch effect (keyed on `funnelId`) never re-ran and the
  right-card completion status stayed stale. Added a `contentRefreshKey` bump in the
  `/form/` branch of the case-switch handler so the page remounts and refetches with
  the new `case_id` — matching the remount behavior already used for every other page.
- **Files/areas:** `client/src/components/Layout.tsx` (case-selector `onChange`).
- **Auth / case-scoping / patient-data:** Case-scoping fix — ensures funnel
  submission data is always fetched for the currently selected case; the new
  `case_id` is already written to `localStorage` before the refetch, so the API
  request interceptor scopes correctly. No auth/token changes.
### Preauth flow: "Under Review" state for pending activation requests (feature)
- **What:** `get-approved-preauth` now returns a `sent_request` flag (true once the patient has
  submitted an activation request that is still awaiting approval). Added a third preauth state
  on top of the existing two. New exported `preauthState(p)` resolves, purely from backend flags:
  `ready` → schedulable; `under-review` → not ready **and** `sent_request === true`;
  `activation-required` → not ready and no request sent. Readiness always wins, so a stale
  `sent_request` on a now-ready preauth is ignored.
  - **Select Preauthorization card:** under-review renders **grey** (grey dot, "Under Review"
    label, neutral border, `Clock` icon) instead of the red "Activation required" treatment.
    Per-state presentation moved into a `STATE_STYLES` map.
  - **Activation Required modal:** when `sent_request` is true it renders **read-only** — title
    "Under Review", grey `Clock` icon, an explanation that the request is pending approval, and a
    single Close button. The **Send Request** button is not rendered, so no duplicate request can
    be submitted and scheduling stays blocked until support approves.
  - **Single-preauth path** (`handleScheduleClick`, picker skipped): now gates on
    `preauthState(...) === "ready"`; a not-ready preauth opens the Activation modal, which shows
    the right mode on its own. This is what gives feedback when the only preauth is under review.
  - **Post-submit refresh:** the modal gained an `onSubmitted` callback; `Appointments.tsx`
    refetches `get-approved-preauth` (new `fetchApprovedPreauths` helper, also reused by
    `handleScheduleClick`) so `sent_request` comes back true and the card reads "Under Review"
    when the picker reopens. Refetch failure is logged, not surfaced — the request itself succeeded.
- **Files/areas:** `client/src/components/SelectPreauthorizationModal.tsx`,
  `client/src/components/ActivationRequiredModal.tsx`, `client/src/pages/Appointments.tsx`.
- **Auth / case-scoping / patient-data:** No change — the state is a pure field-read of the
  backend's `sent_request` / readiness flags; the frontend never decides schedulability itself.
  The extra `get-approved-preauth` call after a submit is case-scoped by the existing interceptor.

### Schedule modal: show full name + short name in the Speciality/Service Type dropdown (fix)
- **What:** The dropdown listed only short codes (`OT`, `PT`, `Programs`). It built its options
  from each physician's `speciality_short`, which carries only the code — the full speciality
  name is on the **group** (`get-department-speciality-with-physician` returns
  `{ id, name, short_name, physicians[], visit_types[] }` per group). Options are now derived
  from the groups themselves (deduped by `short_name`) and rendered as
  `SHORT (Full Name)` — e.g. `OT (Occupational Therapy)`, `Programs (Programs)` — matching the
  reference design and the format the Visit Type dropdown already uses
  (`{visittype_code} ({visittype_name})`). The option `value` is still `short_name`, so
  `selectedGroup` resolution and the preauth preselection (`eqCi(g.short_name, preauth.service)`)
  are unaffected.
- **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx`.
- **Auth / case-scoping / patient-data:** No change — display only; no API or request changes
  (the same `get-department-speciality-with-physician` response is used, just reading the `name`
  field it already returned).

### Select Preauthorization: remove the "Approved" status badge (UI)
- **What:** Dropped the `<Badge variant="secondary">{p.status}</Badge>` from each preauth card.
  The card header now reads: facility name → sessions badge (`used/total`) → ready/activation
  indicator. The badge was redundant: `get-approved-preauth` already filters to
  `status = "Approved"`, so every record shown in this modal is approved by definition.
  `status` remains on `PreauthRecord` (it is part of the API response) but is no longer rendered.
- **Files/areas:** `client/src/components/SelectPreauthorizationModal.tsx`.
- **Auth / case-scoping / patient-data:** No change — display only.

### Select Preauthorization: render the sessions badge from the shipped API fields (fix)
- **What:** The sessions badge added earlier never rendered, because it was guarded on
  `sessions_completed`, which `get-approved-preauth` does **not** return. The backend shipped
  `no_sessions` (total approved) and `sessions_remaining` only. Added a `sessionUsage(p)` helper
  that derives `used = no_sessions - sessions_remaining` (still preferring `sessions_completed`
  if the backend later adds it) and returns `{ used, total, remaining }`, or `null` to hide the
  badge when the counts are absent. The badge now shows `used/total` (e.g. `2/6`) beside the
  "Approved" badge, and the tooltip shows `Remaining Sessions: <remaining>`.
- **Caveat (documented in BR-6):** the backend's `sessions_remaining` nets out completed **and**
  already-scheduled sessions, so the derived "used" means *completed + scheduled*, not completed
  alone. Distinguishing them requires the backend to add `sessions_completed`.
- **Files/areas:** `client/src/components/SelectPreauthorizationModal.tsx`;
  `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md` (BR-6 marked partially delivered).
- **Auth / case-scoping / patient-data:** No change — display only; no new API calls. The counts
  remain backend-owned; the frontend performs only the total−remaining subtraction the API leaves
  implicit.

### Preauth + Schedule modals: display dates as MM-DD-YYYY (fix)
- **What:** Dates in the scheduling flow now render as **MM-DD-YYYY**, while the stored/transmitted
  values remain **YYYY-MM-DD**. In the Schedule modal the **Start Date** / **End Date** fields were
  `<input type="date">`, whose displayed format is dictated by the browser locale (showing
  `10 / 07 / 2026` = DD/MM/YYYY) and cannot be forced; since both are `disabled readOnly`
  display-only fields, they are now plain text inputs rendering a formatted value (falling back to
  `--`). **Ext Date** is formatted the same way. In the Select Preauthorization modal, the service
  date range showed raw ISO (`2026-07-01 – 2026-07-31`) and is now `07-01-2026 – 07-31-2026`.
- **What (util):** Reused the existing `formatDate` from `client/src/lib/utils.ts` (already emits
  MM-DD-YYYY with timezone-safe ISO parsing) rather than adding a second formatter, so the
  scheduling modals now match the format already used by Profile, Home, Documents and Appointments.
- **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx`,
  `client/src/components/SelectPreauthorizationModal.tsx`.
- **Auth / case-scoping / patient-data:** No change — display formatting only. The underlying
  `svc_date_start` / `svc_date_end` / `ext_date` values and the `svcDateStart`/`svcDateEnd` state
  sent to `get-time-slots-date-range` stay in the backend's `YYYY-MM-DD` format.

### Schedule modal: port Medhiwa time-slot range selection + styling (feature)
- **What:** Reworked the **Select Available Time Slots** and **Selected Appointments** panels of
  the Schedule Remaining Appointments modal to match the Medhiwa reference in both styling and
  behavior. Selection changed from individual multi-slot picking to **one click = one confirmed
  appointment per day**: clicking an available slot creates a span `start → auto-end` (auto-end =
  start + visit-type duration, truncated at the next lunch/booked/blocked/close), rendered as
  `✓ …(Start)` / in-range / `✓ …(End)`; the end is adjustable via a per-day End dropdown; clicking
  the Start or End cell again clears the day. Only one appointment per day (other slots on a
  confirmed day are greyed/disabled). The counter is now **`confirmed / sessions_remaining`**
  (remaining comes from `check-sessions-completed`, replacing the hard-coded 10), with a session
  limit guard (toast when exceeded) and a "limit reached" banner when `sessions_remaining === 0`.
  Slot states are styled from the API's per-slot `type` (`available`/`lunch`/`holiday`/`booked`/
  `cross_location_booked`/`blocked`/`blocked_cross_location`) using Medhiwa's maroon `#5b0f0f`
  palette, amber Today/Lunch, green Selected panel, outlined-maroon Prev/Next, maroon date +
  `start → end` range, maroon-bordered End select, red trash, and mutually-exclusive
  Transport (green) / Virtual (purple) pill toggles. Grid opens on the page containing today.
- **What (API):** `Apis.getTimeSlotDateRange` now accepts optional `visitType`/`service` and
  appends `&visit_type=&service=` so the backend returns the real `duration_minutes` (and
  capacity-aware booking) for the auto-end. The time-slots effect now also re-runs on visit-type
  change (which resets current picks).
- **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx`, `client/src/lib/Apis.ts`.
- **Auth / case-scoping / patient-data:** No change to auth or case scoping. Availability
  (holidays/absences/blocks/bookings) remains fully backend-computed — the frontend only renders
  the returned `type`. Booking **SAVE remains a no-op (BR-1 blocked)**; the transport/virtual
  toggles store a per-day flag only (no transport address form). Intentionally uses Medhiwa's
  maroon palette for these two panels per an explicit "match the reference exactly" request,
  deviating from the portal's primary design tokens.

### Schedule modal: preselect form fields from the selected preauthorization (feature)
- **What:** The Schedule Remaining Appointments modal now preselects its fields from the
  preauth chosen on the Select Preauthorization modal, instead of always defaulting every
  dropdown to its first option. On initial open it matches the preauth record to the loaded
  option lists — **Location** ← `medauth_facility`, **Specialty** ← `service`,
  **Service Provider** ← `physician_id` (fallback `referred_by_physician`),
  **Visit Type** ← `visit_type`, **Company** ← `referred_company_name` (which also drives the
  read-only **Provider ID** = the company's `amd_code`), and **Ext Date** ← `ext_date`.
  **Start Date**/**End Date** were already sourced from `svc_date_start`/`svc_date_end`;
  **Visit Status** stays the fixed `Scheduled`. Every match is case-insensitive/trimmed and
  **falls back to the first option** when the preauth value is missing or has no matching
  option, so the form is never left empty. Preselection applies only on open (`isInit`);
  manually changing Location afterward still cascades specialties/provider/company to their
  first options. Extended `applyFirstSelections` and `fetchCompanyData` in place and added a
  small `eqCi` match helper; no rewrite of the async/loader bookkeeping.
- **Files/areas:** `client/src/components/ScheduleAppointmentModal.tsx`.
- **Auth / case-scoping / patient-data:** No change — display/preselection only. No new API
  calls (all values come from the existing `get-approved-preauth` record already passed in as
  the `preauth` prop) and no business logic computed on the frontend; field→source mapping
  mirrors the backend `getApprovedPreauth` response.

### Select Preauthorization card: sessions badge + "Remaining Sessions" tooltip (feature)
- **What:** Added a small count badge on each approved preauth card in the Select
  Preauthorization modal, shown next to the "Approved" status badge. It displays
  **completed / total** sessions in the format `4/12` (`sessions_completed` / `no_sessions`),
  and on hover shows a tooltip reading `Remaining Sessions: <n>` (`sessions_remaining`).
  Rendered with the existing shadcn `Badge` (`variant="outline"`, `tabular-nums`) wrapped in
  a `Tooltip`/`TooltipTrigger asChild`/`TooltipContent` (first product-level tooltip use; the
  `asChild` span keeps the card's outer `<button>` free of nested buttons). The badge is a
  pure field-read: it renders **only** when `no_sessions` and `sessions_completed` are present
  as numbers, so it stays absent (no layout break) until the backend returns them. Extended
  the `PreauthRecord` interface with optional `no_sessions`, `sessions_completed`, and
  `sessions_remaining` fields.
- **Files/areas:** `client/src/components/SelectPreauthorizationModal.tsx`;
  `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md` (new **BR-6** requiring these three fields on each
  `get-approved-preauth` record — the counts currently come only from
  `check-sessions-completed`; the completed-count logic already exists in the Laravel
  `getApprovedPreauth` but is commented out).
- **Auth / case-scoping / patient-data:** No change — display-only; no API calls added and no
  business logic computed on the frontend (session usage remains backend-owned). Badge shows
  real values only after the backend adds the fields (BR-6).

## 2026-07-09

### Preauth modal navigation: one modal at a time + return-to-picker (UX)
- **What:** Made the Select Preauthorization / Activation Required flow show only one
  modal at a time and let the user back out of activation. Picking a **not-ready**
  preauth in the picker now closes the picker before opening Activation Required
  (new `handleActivationFromSelect`); closing Activation Required (X / Cancel / Done)
  then reopens the picker so the user can choose a different preauthorization
  (new `closeActivationRequired`). A new `activationFromSelect` flag records the origin
  so the single-preauth path (`handleScheduleClick`, one not-ready preauth) does **not**
  reopen a picker — there is no list to return to. The ready-preauth path already closed
  the picker before opening the Schedule modal and is unchanged.
- **Files/areas:** `client/src/pages/Appointments.tsx`.
- **Auth / case-scoping / patient-data:** No change — pure client-side modal
  orchestration; no API behavior altered.

### Select Preauthorization modal: one-click selection (UX)
- **What:** Removed the **Continue** and **Cancel** buttons (and the whole footer)
  from the Select Preauthorization modal. Clicking a preauth row now triggers the
  next step immediately: a ready preauth opens the Schedule (Remaining Appointments)
  modal via `onSelect`; a not-ready one opens the Activation Required modal via
  `onActivationRequired`. Dropped the `selectedIndex` state and its reset effect, the
  per-row radio/check indicator, and the unused `useState`/`useEffect`/`Check`/`Button`
  imports. Ready rows now show a `ChevronRight` affordance (not-ready rows keep the red
  `AlertCircle`). The header **X** still closes the modal.
- **Files/areas:** `client/src/components/SelectPreauthorizationModal.tsx`.
- **Auth / case-scoping / patient-data:** No change. This modal makes no API calls;
  it only routes the parent-provided preauth list to the existing callbacks.

### Lazy-load Schedule Appointment preauth data (perf / refactor)
- **What:** Removed the eager `get-approved-preauth` fetch that ran on the
  Appointments page mount. The preauthorization list is now fetched **on demand**
  only when the user clicks **+ Schedule Appointment**, cutting one API call from
  the initial page load. `handleScheduleClick` became async: it shows the existing
  button spinner (`preauthsLoading`, now initialised `false`) while the fetch is in
  flight, then branches on the freshly fetched array (0 → "No Active Preauthorization"
  dialog, 1 ready → Schedule modal, 1 not ready → Activation Required, 2+ → picker).
  Deleted the mount `useEffect`, the now-unused `noPreauths` dimmed-button styling,
  and updated the stale "fetched on load" comment. Only `get-patient-appointments`
  (the page's own content) now fires on mount. The other flow modals already loaded
  on demand and were left unchanged.
- **Files/areas:** `client/src/pages/Appointments.tsx`.
- **Auth / case-scoping / patient-data:** No change. `get-approved-preauth` is still
  called through the same `Apis` wrapper with the standard case-scoped interceptor;
  only the timing of the call moved from mount to click.

### Schedule flow Backend Requirements Document (docs)
- **What:** Authored `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md` at the repo root — a
  comprehensive, hand-off-ready Backend Requirements Document for the schedule-flow
  steps still blocked (4.1 `get-patient-info`, 5.1 `appointment-schedule`,
  5.2 `update-transport`). Structured as itemised requirements (BR-1…BR-8), each
  with Feature / Current API / Issue / Why-blocked / Required backend changes /
  Request params / Response fields / Expected response sample (JSON) / Required
  validation / Priority, plus a triage summary table. Covers the missing
  `appointment-schedule` and `get-patient-info` responses, the unknown `patient_id`
  source, per-field confirmation of every schedule payload field, and the
  Transport/Virtual workflow definitions. No frontend code written for these steps —
  deliberately blocked pending backend answers so the frontend stays a thin,
  assumption-free UI layer shared with the future mobile app.
- **Files/areas:** `SCHEDULE_FLOW_BACKEND_REQUIREMENTS.md` (comprehensive rewrite of
  the earlier checklist).

### Preauthorization readiness indicator + Activation Required flow
- **What:** In the preauthorization scheduling flow, each preauth now shows a
  readiness status and blocks scheduling when it is not ready.
  - The **Select Preauthorization** modal renders a **green** "Ready to schedule"
    or **red** "Activation required" indicator per preauth. Readiness comes solely
    from a backend-provided flag (`is_ready_for_scheduling`, falling back to
    `is_details_missing` until the backend confirms the field) — the frontend does
    **no** validation of its own so the rules stay shared with future clients.
  - **Ready** preauths are selectable and proceed to the Schedule Remaining
    Appointments modal as before. **Not-ready** preauths are not selectable;
    clicking one opens a new **Activation Required** modal. The single-preauth
    path (no picker) is gated the same way.
  - The **Activation Required** modal explains the preauth is not ready and offers
    **Send Request**, which POSTs an activation request (`case_id`, `ma_id`) to the
    support team, then shows a **Request Submitted Successfully** confirmation
    (patient later notified via email/SMS on approval — handled server-side).
- **Files/areas:**
  - `client/src/components/SelectPreauthorizationModal.tsx` — exported
    `isPreauthReady` accessor + `is_ready_for_scheduling` field, green/red status
    dots, red rows gated to `onActivationRequired` instead of selection.
  - New `client/src/components/ActivationRequiredModal.tsx` — prompt + success views.
  - `client/src/lib/Apis.ts` — new `notifyPatientPreauthMissingDetails(caseId, maId)`
    (`POST notify-patient-preauth-missing-details?case_id=&ma_id=`, both passed
    explicitly as query params).
  - `client/src/lib/api.ts` — `notify-patient-preauth-missing-details` added to
    `CASE_ID_EXEMPT_ENDPOINTS` (the preauth's case_id may differ from the active
    case, so the interceptor must not auto-inject case_id).
  - `client/src/pages/Appointments.tsx` — activation state, single-preauth gating,
    wired the new modal.
- **Auth / case-scoping / patient-data:** No new auth surface. Readiness is decided
  solely by the backend via the `is_details_missing` key on `get-approved-preauth`
  (confirmed authoritative); the frontend performs no validation. The notify call
  passes the preauth's own `case_id` + `ma_id` explicitly and is exempt from the
  interceptor's active-case injection.
- **Backend endpoints (confirmed existing, consumed by this change):**
  `GET get-approved-preauth` (provides `is_details_missing`) and
  `POST notify-patient-preauth-missing-details?case_id=&ma_id=`.

### Preauthorization-aware Schedule flow (select preauth before scheduling)
- **What:** The **Schedule Appointment** button on the Appointments page is now
  preauthorization-aware. The active preauthorizations are fetched once on page
  load (`get-approved-preauth`, which already filters to Approved + sessions
  remaining, so every returned record is "active"), and the button branches:
  - **0 active preauths** → button appears disabled (styled, still clickable);
    clicking opens a "No Active Preauthorization Found" info modal directing the
    patient to contact support.
  - **1 active preauth** → opens the Schedule Remaining Appointments modal
    directly, in that preauth's context.
  - **>1 active preauth** → opens a new **Select Preauthorization** modal listing
    all active preauths (facility, service/visit type, referring physician,
    company, date range, status badge); after selection the scheduling modal
    opens in the chosen preauth's context.
  The preauth fetch + first-record selection was removed from
  `ScheduleAppointmentModal`; it now receives the chosen preauth via a `preauth`
  prop (also stores `ma_id` for the sessions check and future save wiring).
- **Files/areas:**
  - New `client/src/components/SelectPreauthorizationModal.tsx` (exports the
    shared `PreauthRecord` type).
  - `client/src/pages/Appointments.tsx` — fetch preauths on load, branch handler,
    button loading/disabled-look states, wired both new modals + inline
    "no preauth" info modal, passes `preauth` to `ScheduleAppointmentModal`.
  - `client/src/components/ScheduleAppointmentModal.tsx` — accepts `preauth`
    prop, dropped internal `getApprovedPreauth` call, added `preauthMaId` state.
- **Auth / case-scoping / patient-data:** No API-layer changes.
  `get-approved-preauth` is still case-scoped by the request interceptor
  (`case_id` auto-injected); `check-sessions-completed` still receives
  `case_id`/`ma_id` explicitly from the selected preauth record. Response
  normalization handles both the `{ count, data }` and bare `[]` shapes.

## 2026-07-02

### Reconciled AGENTS.md Git Workflow with local-only rules and real deploy
- **What:** Rewrote the "Git Workflow" section: developer handles all Git;
  the AI runs read-only Git only and never commits/pushes/branches unless
  explicitly asked. Corrected stale deploy facts (`staging`→Cloudways via
  `deploy-staging.yml`, not `main`→`deploy.yml`).
- **Files/areas:** `AGENTS.md`.
- **Auth / case-scoping / patient-data:** None — process/guidance only.

### Added Context Intake and UI Consistency checklists to AGENTS.md
- **What:** Added a "Context Intake Checklist" (read memory/docs → analyze →
  review code + Git status → plan → wait for approval → implement locally →
  update CHANGELOG_AI.md → summarize files; never commit/push unless asked) and
  a "UI Consistency Checklist" (design system, tokens-not-hex, typography,
  spacing, components, responsiveness, dark mode, accessibility, conventions).
- **Files/areas:** `AGENTS.md`.
- **Auth / case-scoping / patient-data:** None — process/guidance only.

### Set CHANGELOG scope to "AI + manual-on-request"
- **What:** Clarified that this log records AI-made changes automatically, and
  the developer's manual changes only when explicitly requested.
- **Files/areas:** `CHANGELOG_AI.md` (Conventions), `AGENTS.md`
  (CHANGELOG rule).
- **Auth / case-scoping / patient-data:** None — documentation/process only.

### Added AI knowledge base and CHANGELOG_AI convention
- **What:** Established a project knowledge base under `claude_docs/` (overview,
  tech stack, auth/session model, API layer, case scoping, magic-link/email
  flows, project facts, gotchas) and introduced this `CHANGELOG_AI.md`. Added a
  rule to `AGENTS.md` requiring every code change to be recorded here.
- **Files/areas:** `claude_docs/*.md` (new), `CHANGELOG_AI.md` (new),
  `AGENTS.md` (session-startup + output-required rules).
- **Auth / case-scoping / patient-data:** None — documentation and process only;
  no application code, endpoints, or auth behavior changed.

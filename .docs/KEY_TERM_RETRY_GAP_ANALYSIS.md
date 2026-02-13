# Key Term Prompting & Retry Gap Analysis

Date: 2026-02-13  
Scope: Compare the original "Key Term Prompting & Retry" PR behavior with the current architecture and UI, identify regressions, and propose production-grade remediation options.

---

## 1. What We Previously Had (PR Behavior)

The previous implementation provided an end-to-end key-term correction loop:

1. Upload-time key term entry:
- Dedicated key term input with chip UI.
- Paste handling that normalized comma/newline/tab-separated input.
- Client validation for count and per-term length.

2. Deepgram integration:
- Key terms were sent via `keyterm` (not legacy `keywords`) to improve recognition.

3. Error classification:
- Key-term-related failures (including token-limit errors) were classified distinctly (`keyterm_error`) and surfaced with user-friendly messaging.

4. Retry UX for failures:
- Projects list surfaced an `Edit Key Terms` action for key-term failures.
- Users could edit key terms in a modal and save.
- Save triggered automatic transcription retry.

5. API support:
- `PATCH /projects/{id}/key-terms` for in-place key term updates.
- `GET /projects/{id}` returned key terms.

6. Data model posture:
- Watchlist uniqueness behavior was described as part of the feature hardening.

---

## 2. What We Currently Have

Current behavior remains strong for upload + start robustness, but not for in-place key-term correction:

1. Upload-time key term entry still exists:
- Key terms are entered in the capture modal with paste normalization and case-insensitive dedupe.
- Terms are sent to `POST /api/projects` as `key_terms`, then persisted to `watchlist`.

2. Deepgram keyterm usage remains:
- Start path reads `watchlist` terms and sends them as Deepgram `keyterm` parameters.

3. Error classification remains:
- Key-term/token-limit failures are still classified to `keyterm_error`.

4. Failure handling is robust at pipeline level:
- Upload/start flow includes rollback and retry-safe outcomes (`saved_needs_retry`, `saved_status_unknown`).
- Start endpoint includes idempotency protections and race handling.

5. Missing retry UX/API loop:
- No in-place key term edit modal in Projects for failed jobs.
- No `PATCH /projects/{id}/key-terms` equivalent in the current API routes.
- Current key-term failure guidance tells users to re-upload instead of edit+retry in place.

---

## 3. Regressions vs the Original PR

The following capabilities regressed relative to the original intent:

1. Lost in-place remediation:
- Users cannot fix invalid key terms on an existing failed project.

2. Lost automatic retry flow:
- Saving corrected terms no longer auto-triggers a retry because the edit/save path no longer exists.

3. Lost API contract:
- No current route for project-level key-term patch/update.
- No explicit project-read contract returning key terms for edit UX.

4. Validation hardening gap:
- Count limits are enforced in current capture UI, but per-term length constraints are not as explicitly enforced in the active flow as before.

5. Data integrity gap:
- Current Supabase `watchlist` schema does not define a uniqueness constraint for `(project_id, canonical)` in the active migration set.

6. Test coverage gap:
- Current tests touch watchlist read path in start route, but there is no dedicated integration test for "keyterm failure -> edit terms -> retry success" because that UX/API path is absent.

---

## 4. Options to Address the Gap

### Option A: Keep Current Behavior (Re-upload Only)
Description:
- Do not restore edit-in-place retry.
- Clarify product/docs that key-term failure remediation is re-upload + retry only.

Pros:
- Zero engineering effort.
- No new API surface area.

Cons:
- Regressed UX remains.
- Additional user friction and duplicated uploads.
- Not aligned with prior product promise for key-term correction.

When to choose:
- If key-term failure incidence is low and speed of cleanup is highest priority.

---

### Option B: Minimal Recovery Restore (Recommended Baseline)
Description:
- Reintroduce a lightweight edit-and-retry path in current architecture:
  - Add `PATCH /api/projects/[id]/key-terms` route.
  - Re-add Projects-level "Edit Key Terms" action only for `keyterm_error`.
  - On save, update watchlist terms then call existing `/api/projects/[id]/start`.

Pros:
- Restores the critical user-facing recovery loop with modest scope.
- Uses current architecture (Next API + Supabase + existing start endpoint).
- Minimal product risk; fast to deliver.

Cons:
- Does not fully address deeper data-integrity and observability hardening by itself.

When to choose:
- If we want to restore intended behavior quickly without broad refactor.

---

### Option C: Full Production-Grade Hardening
Description:
- Implement Option B plus backend/data safeguards:
  - Server-side validation and normalization for key terms (count, per-term length, trim/collapse whitespace, canonical dedupe).
  - Replace-watchlist update with transactional semantics.
  - Add unique index on `watchlist(project_id, canonical)` and use upsert-safe behavior.
  - Emit structured audit fields in job payload for retry attempts and source of key terms.
  - Add end-to-end tests for failure classification and edit-retry recovery path.

Pros:
- Strongest correctness and consistency guarantees.
- Protects against malformed clients and duplicate watchlist terms.
- Provides durable observability and lower operational risk.

Cons:
- Highest implementation scope.
- Requires migration + test work.

When to choose:
- If production robustness and long-term maintainability are top priority.

---

## 5. Most Elegant Production-Grade Path

Recommended approach: **Option C executed in two phases**.

Phase 1 (fast user-value restore):
1. Implement Option B to restore edit-in-place retry UX/API quickly.
2. Keep UI consistent with current Olivetti patterns (do not revive old modal styling verbatim).

Phase 2 (hardening):
1. Add server-side normalization/validation in the key-term patch route.
2. Add `(project_id, canonical)` uniqueness migration for watchlist.
3. Add focused tests for:
- key-term token-limit failure classification,
- project-level edit/save behavior,
- automatic retry success/failure handling,
- duplicate key term handling via canonical form.

This sequence restores user capability immediately while converging to production-grade correctness and resilience.

---

## 6. Reference Points (Current Code)

- Upload + key term input: `frontend/components/CaptureModal.tsx`
- Capture flow with retry-safe outcomes: `frontend/lib/hooks/useCapture.ts`
- Deepgram keyterm + classification: `frontend/lib/deepgram.ts`
- Start route reading watchlist terms: `frontend/app/api/projects/[id]/start/route.ts`
- Project creation with key_terms -> watchlist: `frontend/app/api/projects/route.ts`
- Current keyterm error UX in Projects (re-upload guidance): `frontend/app/projects/page.tsx`
- Watchlist schema in active migration set: `infra/supabase/migrations/20260114000000_initial_schema.sql`


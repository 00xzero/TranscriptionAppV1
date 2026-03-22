# V3.1 Revised Plan — Targeted Hardening & Decomposition

**Date:** 2026-03-10
**Supersedes:** V3_REWRITE_SCOPE.md (2026-02-13)
**Approach:** Cherry-pick the highest-value V3 items. Descope the full data model migration. Revise frontend targets to reflect the post-V2/virtualization codebase.

> [!IMPORTANT]
> This revision was prompted by a reassessment of the original V3 scope after the V2 Olivetti UI overhaul (Feb 15), transcript virtualization (Mar 5), and editor performance work (Mar 9). The pipeline/backend remained untouched during that period — those V3 recommendations are just as valid today. The frontend landscape shifted significantly.

## Guiding Constraints (Unchanged)

- Keep async pipeline orchestration with Inngest.
- No big-bang rewrite or downtime migration.
- Every change must be testable and deployable independently.
- Prefer additive migrations; never drop tables without a rollback window.

---

## What Changed Since V3 (Feb 13 → Mar 10)

| Area                      | What Happened                                                                                          | Impact on V3                                                  |
| :------------------------ | :----------------------------------------------------------------------------------------------------- | :------------------------------------------------------------ |
| UI Overhaul (V2 Olivetti) | Complete redesign: sidebar shell, contextual header, glassmorphism modals, design tokens, theme system | Frontend decomposition targets shifted                        |
| Transcript Virtualization | `react-virtuoso` integration, new scroll/sync logic, follow mode rewrite                               | Editor page grew to **1551 lines** — now the #1 God Component |
| Editor Performance        | Parallel data fetching, optimistic audio loading, scrubbing improvements                               | More code coupling in the editor page                         |
| Pipeline / Backend        | **Nothing changed**                                                                                    | V3 pipeline recommendations remain fully valid                |
| Data Model                | **Nothing changed** (still 8 tables, 6 migrations)                                                     | Full migration is now more expensive due to UI dependencies   |

### Current File Sizes (Baseline for V3.1)

| File                                   | Lines | Role                                                                |
| :------------------------------------- | :---- | :------------------------------------------------------------------ |
| `app/editor/[id]/page.tsx`             | 1551  | Editor — transcript, audio, sync, modals, editing, virtualization   |
| `lib/inngest/functions.ts`             | 878   | Pipeline orchestration — Deepgram, DB writes, consolidation, errors |
| `components/CaptureModal.tsx`          | 528   | Upload flow — drag-drop, validation, key terms, progress            |
| `lib/supabase/queries.ts`              | 367   | All database query functions                                        |
| `components/FindReplaceModal.tsx`      | 357   | Search/replace with highlighting and navigation                     |
| `components/Sidebar.tsx`               | 332   | Navigation, project info, settings                                  |
| `components/LibraryView.tsx`           | 315   | Project list with search, filtering, status                         |
| `lib/exports.ts`                       | 302   | DOCX and VTT generation                                             |
| `lib/consolidation.ts`                 | 291   | Segment merging algorithm                                           |
| `app/api/webhooks/deepgram/route.ts`   | 259   | Webhook handler — token verification, persist, emit                 |
| `lib/deepgram.ts`                      | 256   | Deepgram API integration                                            |
| `lib/inngest/consolidation-service.ts` | 246   | Consolidation DB bridge (extracted from functions.ts)               |

---

## V3.1 Scope — What's In

### Phase 1: Transcription State Machine

**Why:** Status transitions currently happen across 5 uncoordinated code paths. `projects.status` and `jobs.status` are independently mutated columns that can desync — a project with a `completed` job but `processing` status is a valid database state, and that's a bug by design. This is the single highest-value architectural improvement with zero UI risk.

**Current Problem — 5 mutation sites, no single source of truth:**

- `app/api/projects/[id]/start/route.ts` — sets project status to `processing` and job status to `queued`
- `lib/inngest/functions.ts` (`handleRequested`) — sets job to `processing`
- `lib/inngest/functions.ts` (`handleWebhook`) — triggers completed event
- `lib/inngest/functions.ts` (`handleCompleted`) — sets project + job to `completed`
- `app/api/webhooks/deepgram/route.ts` — sets both to `error` on failure via `persistWebhookFailure()`
- No validation that a transition is legal (e.g., nothing prevents `completed` → `queued`)
- `projects.status` is mutated independently from job status — desync is possible and undetected

**Deliverables:**

1. `lib/state-machine.ts` — Pure function defining legal transitions with guards:
   ```
   uploaded → queued → processing → completed
                                  → failed
                       failed → queued (retry)
   ```
2. `transitionJob(jobId, toStatus, metadata?)` — Single function all code paths call. Validates the transition is legal, persists the new status, and writes a `job_events` audit record (see Phase 2). Throws on invalid transitions.
3. **`projects.status` becomes a derived value — never written directly.**
   - `deriveProjectStatus(projectId)` computes project status from its jobs:
     - Any job `processing` → project is `processing`
     - Any job `queued` → project is `queued`
     - Otherwise → status of newest terminal job (`completed` or `error`)
   - **Database-level enforcement:** Create a Postgres trigger on `jobs` that automatically recomputes and writes `projects.status` after any job status change. This ensures consistency even if application code bypasses `transitionJob()`. The application-level `deriveProjectStatus()` function uses the same logic and can be called for reads, but the trigger is the authoritative write path.
   - Alternative (evaluated but deferred): A Postgres view (`project_status_v`) would be the purest approach but requires changing every query that reads `projects.status` to join the view. The trigger approach preserves the existing column and read patterns while enforcing write correctness.
4. Refactor all 5 mutation sites (start route, 3 Inngest handlers, webhook handler) to use `transitionJob()` exclusively. Remove all direct writes to `projects.status` from application code.

**Tests:**

- Every valid transition succeeds
- Every invalid transition throws (e.g., `completed` → `processing`)
- Derived project status follows precedence rules across multiple jobs
- Concurrent transition attempts don't corrupt state
- Postgres trigger correctly updates `projects.status` when job status changes
- No application code writes to `projects.status` directly (enforced by grep/lint)

**Risk:** Low. Pure logic extraction, additive table (job_events), additive trigger. No UI changes.

**Dependencies:** None.

---

### Phase 2: Job Events Audit Table

**Why:** No audit trail for job state changes (overwritten, not appended). An additive migration with immediate operational value.

**Deliverables:**

#### `job_events` table

```sql
create table job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  from_status text,
  to_status text not null,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);
create index idx_job_events_job_id on job_events(job_id);
create index idx_job_events_created_at on job_events(created_at);

alter table job_events enable row level security;
create policy "Users can view events for their jobs"
  on job_events for select
  using (
    job_id in (
      select j.id from jobs j
      join projects p on j.project_id = p.id
      where p.user_id = auth.uid()
    )
  );
```

- Written by `transitionJob()` on every state change (Phase 1)
- Enables derived metrics: queue latency, processing time, failure rate
- Queryable via Supabase SQL or future dashboard

**Tests:**

- `job_events` rows are created on every state transition
- Metrics queries return correct latency/duration values

**Risk:** Low. Additive table, no schema changes to existing tables.

**Dependencies:** Phase 1 (state machine writes to `job_events`).

---

### Phase 3: Webhook Idempotency

**Why:** No idempotency guard on webhook delivery — Deepgram may retry callbacks and every retry is currently processed fully, creating duplicate segments. This phase creates the `webhook_receipts` table (previously scoped under Phase 2) and wires it into the webhook handler as a duplicate-delivery guard.

**Deliverables:**

#### a. `webhook_receipts` table

```sql
create table webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'deepgram',
  request_id text not null,
  project_id uuid references projects(id) on delete set null,
  received_at timestamptz not null default now(),
  verified boolean not null default false,
  constraint uq_webhook_receipt unique (provider, request_id)
);
create index idx_webhook_receipts_project on webhook_receipts(project_id);

alter table webhook_receipts enable row level security;
-- Admin-only table: no authenticated user policies needed
-- Written by webhook handler via admin client
```

#### b. Idempotency guard in webhook handler

- Check `webhook_receipts` for existing `request_id` before processing
- Duplicate `request_id` → return `200 OK` (no-op)
- On new receipt: insert row, then proceed with existing persist + Inngest emit flow
- Unique constraint on `(provider, request_id)` ensures DB-level safety even under concurrent delivery

**Tests:**

- Duplicate webhook returns 200 with no DB side effects
- Valid webhook creates receipt + persists payload + emits Inngest event
- Concurrent duplicate deliveries don't create duplicate segments

**Risk:** Low. Additive table + a small guard clause in the existing webhook handler.

**Dependencies:** Phase 2 (`job_events` table should exist first so the pipeline is auditable).

---

### Phase 3.5 (Deferred): Webhook Hardening

**Why deferred:** The items below are defense-in-depth measures that matter at scale but are not launch-blocking. The existing `dg-token` timing-safe comparison is adequate pre-launch, and the idempotency guard (Phase 3) closes the only user-facing bug risk.

**Deferred items:**

1. **HMAC signature verification** — Validate Deepgram HMAC before processing. Record result in `webhook_receipts.verified`. Depends on Deepgram plan/API support.
2. **Ack-fast cleanup** — Return `200 OK` immediately after persisting raw payload + inserting receipt. Move all heavy work to Inngest handler exclusively.
3. **Logging cleanup** — Replace 23 `console.log` lines with structured, leveled logging (debug for dev, info/error for production).
4. **Payload-size intake guardrail** — At upload time, warn users about files likely to exceed Vercel's 4.5 MB callback limit (heuristic: >2.5 hour files). Soft warning, not a hard block.

**Revisit when:** Production traffic patterns reveal webhook reliability issues, or Deepgram HMAC support is confirmed.

---

### Phase 4: Editor Page Decomposition

**Why:** `app/editor/[id]/page.tsx` is **1551 lines** — by far the largest file in the repo. It handles transcript rendering, audio playback/sync, follow mode, waveform interaction, find/replace orchestration, export orchestration, speaker editing, inline text editing, virtualization, keyboard shortcuts, and scrubbing. This is the revised version of V3 §8, retargeted at the actual God Component.

**Current Responsibilities (all in one file):**

- Audio state management (play/pause, seek, current time, duration)
- Transcript data fetching and state
- Segment rendering with virtuoso
- Follow mode / sync-to-audio logic
- Scroll detection (user vs programmatic)
- Find/replace state and highlighting
- Export modal orchestration
- Speaker editing and popover state
- Inline text editing with save/cancel
- Keyboard shortcut handling
- Waveform collapse/expand interaction
- Active segment tracking

**Target Structure:**

```
app/editor/[id]/
├── page.tsx                    # Shell: layout + composition (~150 lines)
├── hooks/
│   ├── useEditorData.ts        # Data fetching: project, transcript, speakers, media URL
│   ├── useAudioPlayback.ts     # Audio state: play/pause, seek, currentTime, duration
│   ├── useTranscriptSync.ts    # Follow mode, active segment, scroll detection
│   ├── useTranscriptEditing.ts # Inline editing, save/cancel, optimistic updates
│   └── useSpeakerEditing.ts    # Speaker rename, reassign, create, popover state
├── components/
│   ├── TranscriptList.tsx      # Virtuoso list + segment rendering
│   ├── SegmentCard.tsx         # Single transcript segment (speaker, text, timestamp)
│   └── EditorShell.tsx         # Header + sidebar + waveform + player deck layout
```

**Approach:**

1. Extract hooks first (pure logic, testable independently)
2. Then extract sub-components that consume the hooks
3. Keep `page.tsx` as a thin orchestrator that composes hooks + components
4. Each extracted file should be ≤ 200 lines

**Tests:**

- Existing 13+ editor tests must continue passing after every extraction step
- Add targeted tests for each extracted hook (data fetching, sync logic, editing)

**Risk:** Medium. Refactoring a 1551-line file requires careful incremental extraction to avoid regressions. Virtuoso integration adds complexity.

**Dependencies:** None (but benefits from Phases 1–3 being stable first).

---

### Phase 5: Inngest Functions Split

**Why:** `lib/inngest/functions.ts` at 878 lines contains the entire pipeline: Deepgram submission, webhook processing, segment/word storage, consolidation orchestration, timeout detection, and error handling. This is the original V3 §1 target, scoped to just the Inngest layer.

**Current Functions in the File:**

1. `handleTranscriptionRequested` — Submit to Deepgram
2. `handleTranscriptionWebhook` — Process Deepgram response, store segments/words, run consolidation
3. `handleTranscriptionTimeout` — Detect and mark stuck jobs

**Target Structure:**

```
lib/inngest/
├── client.ts                      # Inngest client (unchanged)
├── events.ts                      # Event types (unchanged)
├── functions/
│   ├── handle-transcription-requested.ts  # Deepgram submission
│   ├── handle-transcription-webhook.ts    # Webhook processing + consolidation
│   └── handle-transcription-timeout.ts    # Stuck job detection
├── consolidation-service.ts       # Already extracted (unchanged)
└── index.ts                       # Re-exports all functions for registration
```

**Rules:**

- Each function file contains one Inngest function definition
- DB operations use `transitionJob()` from Phase 1 (not direct status updates)
- Deepgram-specific logic stays in `lib/deepgram.ts`
- Consolidation logic stays in `lib/inngest/consolidation-service.ts`

**Tests:**

- Existing `inngestHandlers.test.ts` and `transcriptionTimeouts.test.ts` must pass
- Add per-function tests for edge cases (Deepgram rejection, partial webhook, timeout race)

**Risk:** Low. File splitting with no logic changes. Import paths update.

**Dependencies:** Phase 1 (uses `transitionJob()`).

---

### Phase 6: Incremental Typed Contracts

**Why:** Types are currently scattered across `lib/supabase/types.ts` (manual, dated Jan 17), `lib/inngest/events.ts` (plain TS types), and inline in route handlers. This is the pragmatic version of V3 §2 — applied incrementally to new/modified code rather than as a dedicated rewrite phase.

**Approach:**

- **Not** a big-bang creation of a `contracts/` directory
- Instead, as each phase touches code, add Zod schemas at the boundary:
  - Phase 1: Zod schema for state transition inputs
  - Phase 3: Zod schema for webhook payload structure
  - Phase 4: Zod schemas for editor data fetching responses
- Migrate `lib/supabase/types.ts` to Zod-inferred types when it's next modified
- New API routes validate input with `schema.parse()` instead of manual checks

**Deliverables:**

- `lib/schemas/` directory (created as needed, not upfront)
- Each schema file co-located with the domain it validates
- TypeScript types inferred from Zod schemas (single source of truth)

**Tests:**

- Each schema rejects malformed input
- Each schema accepts valid input with correct type inference

**Risk:** Very low. Incremental adoption, no existing code broken.

**Dependencies:** None (applied alongside other phases).

---

## V3.1 Scope — What's Out (Deferred)

| Item                                              | V3 Section | Reason for Deferral                                                                                                                                                                                                                                              |
| :------------------------------------------------ | :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full normalized data model (11 tables)            | §4         | Migration cost increased substantially. Editor (1551 lines), virtualization, find/replace, and exports all depend on current `chunks`/`chunk_words` schema. Cherry-picked `job_events` + `webhook_receipts` capture the highest-value tables without disruption. |
| `media_files` table separation                    | §4         | Still 1:1 with projects. "Re-transcribe with different settings" is not on the near-term roadmap.                                                                                                                                                                |
| `transcript_versions`                             | §4         | Editor was rebuilt without versioning in mind. Adding it requires rethinking the editor's entire data layer. Revisit when user-facing undo/history is prioritized.                                                                                               |
| `raw_transcriptions` table                        | §4         | Webhook payload is already stored in `jobs.payload`. A separate table is cleaner but not blocking anything. Can be added later if `jobs` table size becomes a concern.                                                                                           |
| Unify `segments`/`words` + `chunks`/`chunk_words` | §4         | The dual representation isn't causing user-facing bugs. Editor operates on chunks; segments/words are pipeline-internal. Unification would require rewriting consolidation, all Inngest handlers, and the editor's data layer simultaneously.                    |
| React Server Components                           | §9         | V2 Olivetti made everything more client-interactive. Converting to RSC would require untangling state that was just wired in. Low ROI until Next.js 15+ migration.                                                                                               |
| Billing/limits/permissions domain layer           | §7         | No production users. In-memory rate limiter works for dev. Build billing interfaces when there's a billing need.                                                                                                                                                 |
| `core/` + `infra/` architecture restructuring     | §1         | Directionally correct but high effort with no user-facing benefit. The Inngest split (Phase 5) achieves the most impactful part. Further restructuring can happen organically.                                                                                   |
| CaptureModal decomposition                        | §8         | Grew to 528 lines but has `useCapture` hook already extracted. Not the priority — editor is 3× larger. Can be split if it grows further.                                                                                                                         |
| E2E Playwright tests                              | §10        | Valuable but not gating V3.1 phases. Add after pipeline hardening stabilizes.                                                                                                                                                                                    |

---

## Phasing Summary

| Phase   | Work                                        | Effort            | Risk     | Dependencies                             |
| :------ | :------------------------------------------ | :---------------- | :------- | :--------------------------------------- |
| **1**   | Transcription state machine                 | Small (2–3 days)  | Low      | None                                     |
| **2**   | `job_events` audit table                    | Small (1 day)     | Low      | Phase 1                                  |
| **3**   | `webhook_receipts` + idempotency guard      | Small (1 day)     | Low      | Phase 2                                  |
| **3.5** | Webhook hardening (HMAC, logging, ack-fast) | Deferred          | —        | Phase 3 (revisit post-launch)            |
| **4**   | Editor page decomposition                   | Medium (4–5 days) | Medium   | None (but benefits from stable pipeline) |
| **5**   | Inngest functions split                     | Small (1–2 days)  | Low      | Phase 1                                  |
| **6**   | Incremental typed contracts                 | Ongoing           | Very Low | None (applied alongside other phases)    |

**Total estimated effort:** ~10–12 working days for Phases 1–5 (excluding 3.5), with Phase 6 as ongoing practice.

**Each phase is independently deployable.** Phase 2 needs Phase 1's `transitionJob()` to write events, and Phase 3 needs Phase 2 to exist first. Phase 3.5 is deferred until post-launch.

---

## Success Criteria

- [ ] All job status transitions go through a single validated function
- [ ] Every state change has an audit record in `job_events`
- [ ] Duplicate webhook delivery is a no-op (verified via `webhook_receipts`)
- [ ] `editor/[id]/page.tsx` is ≤ 200 lines (orchestrator only)
- [ ] `lib/inngest/functions.ts` is replaced by per-function files ≤ 300 lines each
- [ ] All existing tests pass after every phase
- [ ] New tests cover state machine transitions, webhook idempotency, and editor hooks

---

## Open Questions

1. **Deepgram HMAC support (Phase 3.5):** Does the current Deepgram plan/API version support signed webhook payloads (beyond the `dg-token` header)? Check post-launch before revisiting Phase 3.5.
2. **Editor extraction order:** Should hooks be extracted top-down (data fetching first) or bottom-up (editing/speakers first)? Top-down is recommended since data hooks have the fewest internal dependencies.
3. **V3 full data model — when to revisit:** Suggest revisiting the normalized schema when (a) transcript versioning becomes a user-facing feature request, or (b) the `chunks`/`chunk_words` dual layer causes a concrete bug or performance issue.

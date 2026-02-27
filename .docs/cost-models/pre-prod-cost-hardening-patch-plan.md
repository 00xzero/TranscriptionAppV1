# Pre-Prod Cost Hardening Patch Plan

Date: 2026-02-14  
Scope: Concrete patch plan for polling, autosave batching, export caching, and payload offloading hotspots.

## Savings Method (for this document)

Baseline model source:
- `.docs/cost-models/production-cost-model-500-users.csv`
- `.docs/cost-models/production-cost-model-500-users.md`

Baseline monthly cost used for estimates:
- Expected scenario total: `$306.95`
- Expected scenario variable spend: `$186.95`  
  Breakdown: egress `$142.44`, storage `$31.23`, DB disk `$13.28`

How to read savings numbers:
- **Direct metered savings**: high-confidence impact on billed usage lines (egress/storage/DB disk).
- **Indirect savings**: medium/low-confidence impact from reduced load that may delay capacity upgrades.
- Ranges are monthly estimates at the same 500-user behavior model.

## 1) PR-01: Realtime Polling Hardening (Highest Priority)

Goal: eliminate paid reads while realtime is healthy.

### Files
- `frontend/lib/supabase/realtime.ts`
- `frontend/lib/supabase/hooks.ts`

### Patch
- In `SUBSCRIBED`, remove the connected backup polling interval (`setInterval(... pollingInterval * 2)`).
- Only start polling on `CHANNEL_ERROR`, `CLOSED`, or `CONNECTING`.
- Pause polling when `document.hidden === true`.
- Add exponential backoff while disconnected: 5s -> 10s -> 20s (max 60s).
- Add env guard `NEXT_PUBLIC_REALTIME_CONNECTED_POLL_MS` default `0` (disabled), allowing temporary low-frequency connected polling only when explicitly set.

### Acceptance Criteria
- With stable realtime, no periodic `fetchProjects()` for 10 minutes.
- With forced channel error, polling starts, backs off, and stops after reconnection.

### Expected Cost Impact
- Large reduction in Supabase read/egress churn from list pages.

### Potential Savings
- Relative impact: about `85-95%` reduction in polling-driven reads while realtime is healthy.
- Direct metered savings (Expected scenario): about `$1.10-$1.25/month` from poll-egress reduction.
- Direct metered savings (Heavy scenario): about `$15.80-$17.70/month` from poll-egress reduction.
- Indirect savings: reduced sustained query load; can help delay compute tier upgrades (tier price dependent).

## 1b) PR-01b: Auth Call De-duplication (Same Release Train)

Goal: remove duplicate auth reads and subscriptions per page render.

### Files
- `frontend/components/Sidebar.tsx`
- `frontend/components/ContextualHeader.tsx`
- `frontend/components/LibraryView.tsx`
- `frontend/lib/auth/AuthProvider.tsx` (new)
- `frontend/app/layout.tsx`

### Patch
- Add a shared `AuthProvider`.
- Execute one `supabase.auth.getUser()` and one `onAuthStateChange` subscription per tab.
- Consume auth context in `Sidebar`, `ContextualHeader`, and `LibraryView`.

### Acceptance Criteria
- One auth fetch/subscription path per tab (not three).

### Expected Cost Impact
- Moderate read reduction and cleaner session behavior.

### Potential Savings
- Relative impact: typically `60-70%` fewer duplicate client auth reads/subscriptions per tab.
- Direct metered savings: usually low (`$0-$2/month` in this model), because auth call volume is not the main billed driver.
- Indirect savings: lower auth API and client load, fewer noisy retries/session edge cases.

## 2) PR-02: Autosave Batching + Flush Discipline

Goal: reduce write frequency from per-keystroke bursts to controlled batches.

### Files
- `frontend/app/editor/[id]/page.tsx`
- `frontend/lib/supabase/queries.ts`
- `frontend/app/api/projects/[id]/chunks/batch/route.ts` (new)

### Patch
- Replace per-segment timer writes with project-level queue (`Map<chunkId, text>`).
- Global flush interval every 2s.
- Cap batch size at 25 updates/request.
- Skip unchanged text compared to last persisted snapshot.
- Force flush on textarea blur, replace-all completion, route change, and `visibilitychange`.
- Batch endpoint performs set-based update (single DB roundtrip per batch) instead of N individual updates.

### Acceptance Criteria
- 20 edits in one segment => <=1 DB write.
- Replace-all across 100 segments => <=4 batch requests.

### Expected Cost Impact
- Major reduction in Supabase write operations and client/network chatter.

### Potential Savings
- Relative impact: about `50-80%` fewer write requests from the editor path; row updates usually drop less due to real content changes.
- Direct metered savings: typically low to modest (`$1-$5/month`) in this model.
- Indirect savings: lower DB write pressure and WAL churn, reducing risk of needing larger compute under peak edit traffic.

## 3) PR-03: Export Caching with Versioned Invalidation

Goal: avoid regenerating identical DOCX/VTT repeatedly.

### Files
- `frontend/app/api/projects/[id]/export/docx/route.ts`
- `frontend/app/api/projects/[id]/export/vtt/route.ts`
- `frontend/lib/exports/data.ts`
- `frontend/lib/exports/cache.ts` (new)
- `infra/supabase/migrations/*` (new migration)

### Patch
- Add `projects.export_version` integer.
- Increment `export_version` via DB triggers when `chunks` or `speakers` change.
- Export route checks storage path keyed by `projectId + format + export_version`.
- Cache hit: serve existing artifact.
- Cache miss: generate export, store artifact, and serve.

### Acceptance Criteria
- Second export with unchanged transcript hits cache (no full regeneration path).

### Expected Cost Impact
- Reduced function CPU/runtime and repeated DB reads.

### Potential Savings
- Relative impact: with a `40-70%` export cache hit ratio, export generation CPU and read load drops proportionally.
- Direct metered savings: usually modest (`$1-$6/month`) in this model, unless runtime usage is already above included credits.
- Indirect savings: much better tail latency and lower peak pressure during heavy export bursts.

## 4) PR-04: Deepgram Payload Offloading (DB Pressure Fix)

Goal: stop storing full Deepgram JSON in `jobs.payload`.

### Files
- `frontend/app/api/webhooks/deepgram/route.ts`
- `frontend/lib/inngest/functions.ts`
- `infra/supabase/migrations/*` (new migration)

### Patch
- In webhook route, gzip Deepgram payload and upload to private storage bucket `job-payloads`.
- Store only summary + `payload_ref` in `jobs`.
- Keep UI-safe error summary in `payload` for project error display.
- In Inngest `store-transcription`, load payload from `payload_ref` first.
- Keep fallback to legacy inline payload for backward compatibility.
- Add retention cleanup job (Inngest cron) to delete old payload objects and clear refs (e.g., 30-90 days).

### Acceptance Criteria
- `jobs` row size remains small regardless of transcription length.
- Pipeline succeeds for both new offloaded jobs and old inline-payload jobs.

### Expected Cost Impact
- Lower DB disk growth and replication/WAL pressure.

### Potential Savings
- Relative impact: moves large webhook payload bytes from expensive DB disk to cheaper object storage.
- Direct metered savings (Expected scenario): about `$3.30-$7.90/month` net.
  - Assumes `0.5-1.2 MB` payload moved per transcript over a 3-month retention window.
- Direct metered savings (Heavy scenario): about `$13.20-$31.70/month` net.
  - Same payload-move assumption over a 12-month retention window.
- Indirect savings: better long-term DB health and lower probability of DB size-related incidents.

## 5) PR-05: Observability + Budget Guardrails

Goal: detect spend regressions early.

### Files
- `frontend/lib/cost-metrics.ts` (new)
- Instrumentation in touched routes/hooks/components

### Patch
- Add structured counters for:
  - `poll_fetch_count`
  - `autosave_batch_size`
  - `export_cache_hit`
  - `payload_offload_bytes`
- Add weekly budget checks and threshold alerts in monitoring.

### Acceptance Criteria
- Team can identify top cost driver quickly from logs/metrics.

### Potential Savings
- Direct metered savings: not immediate; this item is primarily preventative.
- Indirect savings: when it prevents a spend regression, avoided cost is often meaningful.
  - Rule-of-thumb avoided variable spend: about `10-30%` during a regression window.
  - Using this model's expected variable spend (`$186.95`), that is about `$19-$56` avoided for that period.

## Recommended Implementation Order
1. PR-01 + PR-01b
2. PR-02
3. PR-04
4. PR-03
5. PR-05

## Immediate Next Action
- Start implementation with PR-01 (realtime polling hardening) as a single commit-sized patch.

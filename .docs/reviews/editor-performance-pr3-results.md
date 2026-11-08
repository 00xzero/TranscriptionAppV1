# Editor performance PR 3 verification

Integration base `9d5e0edf`. The first commit is `dcd8290` (retained Find).
Metadata seeding and the word projection are in `9db39de`.

## Retained Find typing

Chrome 156 used an isolated Next.js production build and a disposable copy of
the local 10-hour fixture, with 5,000 segments and 100,000 words. The sidebar was
closed, CPU slowdown was 4×, and the Find dialog was closed with the term kept.
Word pages finished before typing. Each term had one warm-up batch and three
measured batches of 32 trusted inputs. Each batch saved and was undone before
the next. Durations are renderer tasks containing the input event.

| Term | Batch p95, ms | Pooled p95, ms |
| --- | --- | ---: |
| `the` | 15.42, 11.87, 10.24 | 13.28 |
| `a` | 13.38, 12.75, 14.02 | 14.02 |
| `e` | 11.64, 10.17, 12.14 | 11.64 |

The pooled and per-batch values pass the 16 ms gate. Earlier candidates that
still flattened all results, and later candidates that still forced textarea
layout on each input, exceeded the threshold in some runs. The final build uses
native sizing where supported and retains the JavaScript sizing fallback.

## Initial segment loading

Two isolated production builds used the same local disposable 2-hour and
10-hour copies and a synthetic media URL. Both used the PR 3 metadata and word
projection. The second build changed only the initial segment read to use the
snapshot RPC. These are three warm Chrome navigations per condition at 1× CPU.

| Fixture | Sequential first card, ms | Snapshot first card, ms | Segment requests | Encoded segment bytes, approximate |
| --- | --- | --- | --- | --- |
| 2 h | 139, 140, 98 | 196, 265, 193 | 2 → 1 | 503 KB → 525 KB |
| 10 h | 159, 152, 254 | 229, 314, 522 | 6 → 1 | 2.52 MB → 2.63 MB |

Sequential paging stays on initial load. Focus and repair use the snapshot to
reconcile against one database state. The comparison measured segment traffic
separately from the embedded word requests.

## Local migration

`20261108000000_editor_segment_snapshot.sql` was the only pending local
migration. The owner received all 5,000 segments through the RPC. Anonymous
execution was denied and an unrelated authenticated subject received no
transcript snapshot. No hosted migration was applied.

## Recovery verification

On a disposable local 2-hour copy, two isolated Chrome tabs exercised a
guarded conflict. The losing tab adopted the saved text, closed its textarea,
and copied the full local edit. Escape and copy left the toast open. Close
dismissed it. A separate run verified focus refresh on a clean external edit
and deletion while the other tab had a draft. The dirty tab returned to the
library with its sticky toast. The tab that confirmed deletion showed no
copy offer.

Deterministic coverage exercises retry-before-resave, typing during refresh,
lost and capped answers, revision pairing, split/rejoin, and the stopped-account
copy after leaving the editor. The browser runs used synthetic media. A live
WorkOS account switch and real macOS Japanese IME in Safari and Chrome remain
integration coverage gaps.

The 10-hour copy matched its pre-test text and timing checksum before cleanup.
Both named recordings matched their checksums, and both disposable copies
were removed.

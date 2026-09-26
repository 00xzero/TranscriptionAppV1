---
name: verify
description: Run and drive the app locally to verify a change at its surface (editor, library, projects), including layout-shift (CLS) measurement.
---

# Verifying on the local stack

## Start
- `cd infra && ./start-local.sh` starts local Supabase, Inngest, the Docker frontend on http://localhost:3000 and an ngrok tunnel for Deepgram callbacks.
- Use the Docker frontend. Host `npm run dev` (and the `frontend` entry in `.claude/launch.json`) talks to the HOSTED Supabase project.
- The user signs in; never type the password yourself. The built-in browser and the user's Chrome usually already hold a local session.
- DB: `docker exec -i supabase_db_transcription-app-local psql -U postgres -d postgres`. Never `supabase db reset` (wipes local test data); check migrations with `supabase db diff --local --schema public`.

## Drive
- Pages: `/` (Library), `/transcripts`, `/projects`, `/projects/<id>`, `/editor/<transcriptId>`.
- Editor speaker popover: click `[aria-label^="Change speaker"]`; the popover is `[role="dialog"][aria-label="Speaker assignment"]`.
- Radix tabs need `pointerdown` + `mousedown` + `click` when driven from JS.

## Layout shift (CLS)
- Chrome records `layout-shift` entries only while the page is on screen. A background tab or a hidden browser pane records nothing, so a 0 there is meaningless. Check `document.visibilityState === 'visible'` first.
- To bring the user's Chrome tab forward (ask first), set a unique `document.title` from JS, then run AppleScript that finds the tab by title, sets `active tab index` and window `index` to 1, and calls `activate`.
- Measure per page: navigate, wait ~6s, read `new PerformanceObserver(...).observe({ type: 'layout-shift', buffered: true })`. Score CLS as the largest session window (gaps < 1s, window < 5s), skipping `hadRecentInput`. Log `entry.sources` to name the moving nodes.
- The dev server is slower than production, so treat dev numbers as an upper bound.
- Known baseline (26 Sep 2026): Library 0.004, Transcripts 0.000, Projects 0.000, a project page 0.004. The editor scores 0.10–0.11; its shift comes from the waveform strip changing height while audio and peaks load.

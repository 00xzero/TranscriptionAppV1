# Soniox Async Transcription — POC

Standalone proof of concept. Uploads a media file to Soniox's async API, polls
until done, and pretty-prints the transcript (by-speaker / plain text / raw JSON).
Not wired into the main app.

## Use it

1. Open `index.html` in a browser (double-click, or drag into a tab).
2. Paste your temp Soniox API key into the **Soniox API key** field
   (or hardcode `const API_KEY = "..."` near the top of the `<script>`).
3. Choose a media file and click **Transcribe**.

The flow: `POST /v1/files` (upload) → `POST /v1/transcriptions` (create job) →
poll `GET /v1/transcriptions/{id}` → `GET /v1/transcriptions/{id}/transcript`.

## If you hit a CORS / network error

Browser-to-`api.soniox.com` calls may be blocked by CORS (the API likely expects
server-side calls). If the activity log shows a network/CORS failure:

```bash
node proxy.js          # requires Node 18+
```

Then set the POC's **API base** field to `http://localhost:8787` and retry.
The proxy just forwards requests to Soniox and adds permissive CORS headers.

## Notes

- Polls every 2.5s. Async jobs are typically faster than realtime audio length.
- Speaker grouping merges consecutive tokens sharing a `speaker` value.
- This is throwaway code — delete `soniox-poc/` when done.

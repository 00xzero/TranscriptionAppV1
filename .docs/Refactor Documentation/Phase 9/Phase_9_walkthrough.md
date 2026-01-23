# Phase 9: Local Dev via Docker-Only - Walkthrough

## Summary

Phase 9 added a one-command local development setup using Supabase CLI for database/auth/storage and Docker Compose for Inngest/Frontend services. It also resolved Docker networking issues (auth cookies, media URLs) to ensure full functionality in a containerized environment.

## What Changed

### New Files

| File | Purpose |
|:---|:---|
| [config.toml](infra/supabase/config.toml) | Supabase CLI local configuration |
| [docker-compose.dev.yml](infra/docker-compose.dev.yml) | Docker Compose for Inngest + Frontend |
| [.env.docker.example](infra/.env.docker.example) | Environment template for Docker dev |
| [start-local.sh](infra/start-local.sh) | One-command startup script (with ngrok integration) |
| [stop-local.sh](infra/stop-local.sh) | Stop script for all services |
| [auth/callback/route.ts](frontend/app/auth/callback/route.ts) | Auth code exchange callback endpoint |
| [api/media-proxy/route.ts](frontend/app/api/media-proxy/route.ts) | Media proxy for Deepgram to access local storage via ngrok |

### Modified Files

| File | Changes |
|:---|:---|
| [README.md](/README.md) | Added Docker local dev quickstart section, tech stack update |
| [REFACTOR_README.md](../REFACTOR_README.md) | Added Phase 9 link |
| [PHASE_STATUS.md](../PHASE_STATUS.md) | Marked Phase 9 complete, added handoff notes |
| [lib/supabase/client.ts](frontend/lib/supabase/client.ts) | Added `cookieOptions` for consistent cookie names in Docker |
| [lib/supabase/server.ts](frontend/lib/supabase/server.ts) | Added `SUPABASE_URL` env var support + `cookieOptions` |
| [lib/supabase/admin.ts](frontend/lib/supabase/admin.ts) | Added `SUPABASE_URL` env var fallback |
| [middleware.ts](frontend/middleware.ts) | Added callback route exclusion + `SUPABASE_URL` support |
| [auth/page.tsx](frontend/app/auth/page.tsx) | Added session check on mount + improved auth state handling |
| [api/projects/[id]/media-url/route.ts](frontend/app/api/projects/[id]/media-url/route.ts) | Fix `host.docker.internal` → `localhost` for browser access |
| [api/projects/[id]/start/route.ts](frontend/app/api/projects/[id]/start/route.ts) | Media proxy integration for Deepgram via ngrok |

---

## Key Implementation Details

### Docker Networking Fixes
- **Cookie mismatch issue**: In Docker, server-side uses `host.docker.internal:54321` but browser uses `localhost:54321`. Supabase hashes the URL into cookie names, causing auth to fail. Fixed by setting explicit `cookieOptions.name` in all Supabase clients.
- **Media URL fix**: Signed URLs from storage contain `host.docker.internal` which browsers can't resolve. The `media-url` route now replaces this with `localhost`.

### Deepgram + ngrok Integration
- Deepgram needs a publicly accessible URL for callbacks AND media access
- `start-local.sh` automatically starts ngrok and displays the tunnel URL
- `DEEPGRAM_USE_PROXY=true` enables the media proxy endpoint
- The media proxy (`/api/media-proxy`) streams files from local Supabase storage through ngrok

### Auth Flow
- Added `/auth/callback` route for Supabase auth code exchange
- Middleware now excludes callback routes from redirect logic
- Auth page checks for existing session on mount

---

## How to Test

### Prerequisites
```bash
# Install Supabase CLI (one-time)
brew install supabase/tap/supabase

# Install ngrok (optional, for transcription)
brew install ngrok
```

### Start Local Dev Stack
```bash
cd infra && ./start-local.sh
```

### Access Services
| Service | URL |
|:---|:---|
| Frontend | http://localhost:3000 |
| Supabase Studio | http://localhost:54323 |
| Inngest | http://localhost:8288 |
| Inbucket (email) | http://localhost:54324 |
| ngrok Inspector | http://localhost:4040 |
| Supabase API | http://localhost:54321 |

### Stop All Services
```bash
cd infra && ./stop-local.sh
```

### Reset Database
```bash
cd infra/supabase && supabase db reset
```

---

## Environment Variables (Docker)

| Variable | Purpose |
|:---|:---|
| `SUPABASE_URL` | Server-side URL (`host.docker.internal:54321`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-side URL (`localhost:54321`) |
| `DEEPGRAM_CALLBACK_URL` | ngrok URL for Deepgram callbacks |
| `DEEPGRAM_USE_PROXY` | Set to `true` to use media proxy |
| `MEDIA_PROXY_SECRET` | Token for media proxy authentication |

---

## Gotchas

- **Supabase CLI required**: `brew install supabase/tap/supabase`
- **ngrok required for transcription**: Without it, Deepgram can't callback or fetch media
- **Cookie persistence**: All Supabase clients must use same `cookieOptions.name`
- **Docker `host.docker.internal`**: Used for container-to-host communication
- **Migrations auto-apply**: On `supabase start`, migrations run automatically

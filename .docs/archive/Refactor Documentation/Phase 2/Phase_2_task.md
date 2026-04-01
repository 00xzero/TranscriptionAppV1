# Phase 2: Auth and Session Wiring

## Tasks

- [x] **Update REFACTOR_PLAN.md** - Change auth to email/password only (defer magic link)
- [x] **Install Supabase packages** - Add `@supabase/supabase-js` and `@supabase/ssr`
- [x] **Create Supabase client utilities**
  - [x] Browser client (`lib/supabase/client.ts`)
  - [x] Server client (`lib/supabase/server.ts`)
  - [x] Middleware for session refresh
- [x] **Create Auth UI**
  - [x] Auth page with Supabase pre-built UI (`app/auth/page.tsx`)
  - [x] Sign out functionality
- [x] **Add route protection**
  - [x] Middleware to redirect unauthenticated users
  - [x] Protected layout wrapper
- [x] **Update environment configuration**
  - [x] Add Supabase env vars to `.env.example`
  - [x] Document required env vars
- [x] **Verification**
  - [x] Test sign up flow
  - [x] Test sign in flow
  - [x] Test protected routes
  - [x] Test session persistence

## Notes
- Using pre-built Supabase Auth UI (UI overhaul planned post-refactor)
- Email/password auth only for now
- Cookie-based sessions with `@supabase/ssr`
- Defer API migration to later phases

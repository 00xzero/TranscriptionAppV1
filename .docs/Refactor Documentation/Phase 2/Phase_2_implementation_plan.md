# Phase 2: Auth and Session Wiring

Implement Supabase Auth with cookie-based sessions in the Next.js 14 App Router frontend. This phase focuses on auth UI and route protection; API migration is deferred to later phases.

## Proposed Changes

### Supabase Client Setup

#### [NEW] `frontend/lib/supabase/client.ts`

Browser-side Supabase client for client components:

```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

#### [NEW] `frontend/lib/supabase/server.ts`

Server-side Supabase client for RSC and API routes:

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  )
}
```

---

### Middleware for Session Refresh

#### [NEW] `frontend/middleware.ts`

Refreshes auth tokens on every request; redirects unauthenticated users to `/auth`:

- Matches all routes except static files
- Creates server client with request/response cookie handling
- Calls `getUser()` to refresh session
- Redirects to `/auth` if no user and accessing protected routes
- Protected routes: `/projects`, `/editor/*`, `/upload`, `/import`

---

### Auth UI Page

#### [NEW] `frontend/app/auth/page.tsx`

Login/signup page using Supabase pre-built Auth UI:

- Uses `@supabase/auth-ui-react` with `ThemeSupa`
- Email/password only (magic link and OAuth disabled)
- Redirects to `/projects` on successful login

---

### Sign Out Action

#### [NEW] `frontend/app/auth/actions.ts`

Server action for logout:

```typescript
'use server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/auth')
}
```

---

### Layout Updates

#### [MODIFY] `frontend/app/layout.tsx`

Add sign out button to header for authenticated users.

---

### Environment Configuration

#### [MODIFY] .env.example

Add required Supabase environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://svzeffnmlqbdnjzhcgyx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

---

### Dependencies

Install the following npm packages:

```bash
npm install @supabase/supabase-js @supabase/ssr @supabase/auth-ui-react @supabase/auth-ui-shared
```

---

## Verification Plan

### Automated Tests

No existing auth tests to build on. Writing unit tests for auth UI is deferred since we're using Supabase's pre-built components. The existing tests in `frontend/__tests__/consolidation.test.ts` and `frontend/__tests__/editor.test.tsx` test unrelated features.

Run existing tests to ensure no regressions:
```bash
cd frontend && npm test
```

### Manual Verification (Browser Testing)

I will use the browser tool to verify the following flows:

1. **Auth page renders**: Navigate to `http://localhost:3000/auth`, verify login form appears
2. **Sign up flow**: Create a new account with email/password, verify redirect to `/projects`
3. **Sign out flow**: Click sign out, verify redirect to `/auth`
4. **Sign in flow**: Log in with existing credentials, verify redirect to `/projects`
5. **Protected routes**: Attempt to access `/projects` when logged out, verify redirect to `/auth`
6. **Session persistence**: After sign in, refresh page, verify still authenticated

> [!IMPORTANT]
> The dev server must be running (`npm run dev`) for browser testing.

# Docker Local Development

## Tech Stack
- **Supabase CLI**: Manages Postgres, Storage, Realtime, Studio (Auth only verifies WorkOS tokens)
- **Docker Compose**: Manages Inngest (Jobs) and Frontend (Next.js)
- **WorkOS AuthKit**: Sign-in (staging environment for local development)

## Quickstart

1. **Install Prerequisites**
   ```bash
   brew install supabase/tap/supabase
   ```

2. **Set up WorkOS sign-in** (once)
   - In the WorkOS dashboard's staging environment, under Redirects, add
     `http://localhost:3000/auth/callback` as a redirect URI and
     `http://localhost:3000/auth` as the sign-out redirect and the initiate login URI.
   - Under Authentication → Sessions → JWT Template, set the template to
     `{ "role": "authenticated", "user_role": {{organization_membership.role}} }`:
     Supabase reads `role` to pick the Postgres role, so WorkOS's own role moves
     to `user_role`.
   - Put the `WORKOS_*` values in `infra/.env.docker` (see `.env.docker.example`).
   - Put `WORKOS_ISSUER_URL=https://api.workos.com/user_management/<WORKOS_CLIENT_ID>`
     in `infra/supabase/.env` (gitignored), so local Supabase accepts WorkOS tokens.

   A person's first sign-in creates their `app_users` row, which gives them our own
   user id. Run `infra/supabase/seed.sql` after the test account's first sign-in to
   give it sample transcripts.

3. **Start Stack**
   ```bash
   cd infra && ./start-local.sh
   ```

   To prepare for travel while connected, then start from cached resources later:

   ```bash
   cd infra && ./start-local.sh --prepare-offline
   cd infra && ./start-local.sh --offline
   ```

   Offline mode skips ngrok and cannot run the Deepgram transcription pipeline.
   Re-run `--prepare-offline` after dependency, Docker image, or Supabase CLI updates.

4. **Access Services**
   - Frontend: [http://localhost:3000](http://localhost:3000)
   - Studio: [http://localhost:54323](http://localhost:54323)
   - Inngest: [http://localhost:8288](http://localhost:8288)
   - Mailpit: [http://localhost:54324](http://localhost:54324)

5. **Stop Stack**
   ```bash
   cd infra && ./stop-local.sh
   ```

## Importing Production Data

To pull data from your production Supabase project to local:

1. **Login to Supabase CLI**
   ```bash
   supabase login
   ```

2. **Link Project** (get Reference ID from Supabase Dashboard URL)
   ```bash
   supabase link --project-ref <your-project-ref>
   ```

3. **Dump and Restore**
   ```bash
   # Dump data only (schema is handled by migrations)
   supabase db dump --data-only --linked > prod_data.sql

   # Import to local
   # Password is 'postgres'
   psql -h localhost -p 54322 -U postgres -d postgres -f prod_data.sql
   ```

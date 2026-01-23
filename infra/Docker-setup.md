# Docker Local Development

## Tech Stack
- **Supabase CLI**: Manages Postgres, Auth, Storage, Realtime, Studio
- **Docker Compose**: Manages Inngest (Jobs) and Frontend (Next.js)

## Quickstart

1. **Install Prerequisites**
   ```bash
   brew install supabase/tap/supabase
   ```

2. **Start Stack**
   ```bash
   cd infra && ./start-local.sh
   ```

3. **Access Services**
   - Frontend: [http://localhost:3000](http://localhost:3000)
   - Studio: [http://localhost:54323](http://localhost:54323)
   - Inngest: [http://localhost:8288](http://localhost:8288)
   - Mailpit: [http://localhost:54324](http://localhost:54324)

4. **Stop Stack**
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

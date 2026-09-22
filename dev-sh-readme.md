# `dev.sh` walkthrough

`dev.sh` is the lightweight host-mode helper for running the frontend, the
local Inngest Dev Server, and an optional ngrok tunnel. It does not start
Supabase or Docker. Use [`infra/start-local.sh`](infra/start-local.sh) when you
want the complete Docker-based local stack.

## Prerequisites

- Node.js 24 or newer and npm
- Dependencies installed in `frontend/` with `npm ci`
- Supabase running separately when the app needs database access
- ngrok installed and configured only when Deepgram callbacks are required

For the direct workflow, copy `frontend/.env.example` to
`frontend/.env.local`, set the local Supabase values, and keep
`INNGEST_DEV=1` enabled.

The ngrok service reads the hostname from `DEEPGRAM_CALLBACK_URL` in
`frontend/.env.local`. You can also provide `DEEPGRAM_NGROK_DOMAIN` in the
shell. The callback URL should end with `/api/webhooks/deepgram`.

## Usage

Run commands from the repository root:

```bash
./dev.sh start
./dev.sh stop
./dev.sh restart
```

The helper can also control one service at a time:

```bash
./dev.sh start frontend
./dev.sh start inngest
./dev.sh start ngrok

./dev.sh stop frontend
./dev.sh restart inngest
```

Valid service names are `frontend`, `inngest`, and `ngrok`.

When everything starts successfully:

- Frontend: http://localhost:3000
- Inngest Dev Server: http://localhost:8288
- ngrok Inspector: http://localhost:4040

The helper's direct Inngest command uses the CLI resolved by
`npx inngest-cli@latest`; the Docker workflow uses the version pinned in
`infra/docker-compose.dev.yml`.

## Logs and runtime files

Logs are written to the repository-local `.dev_logs/` directory:

- `.dev_logs/frontend.log`
- `.dev_logs/inngest.log`
- `.dev_logs/ngrok.log`

Process IDs are stored in `.dev_pids_dir/`. These are runtime files and should
not be committed.

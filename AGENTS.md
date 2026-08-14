# Repository Guidelines

## Product Status

This app is currently in development. We have no users yet and are building toward the MVP. Treat local accounts, test credentials, and development services as non-production resources.

## Project Structure & Module Organization

- `frontend/` is the active Next.js App Router application (Next.js 16.2.1, React 19, TypeScript, Tailwind CSS) with API routes and Inngest functions.
  - `frontend/app/`: pages, layouts, and API routes.
  - `frontend/components/`: shared React UI components.
  - `frontend/contracts/`: Zod schemas and shared runtime-validated contracts.
  - `frontend/core/`: domain logic and application services.
  - `frontend/infra/`: external-service adapters, including Supabase, Deepgram, and Inngest integrations.
  - `frontend/lib/`: cross-cutting utilities, recording logic, hooks, and shared helpers.
  - `frontend/__tests__/`: Jest tests.
- `infra/` contains the local development stack: Supabase CLI configuration, Docker Compose, and `start-local.sh` / `stop-local.sh`.
- `.docs/` contains architecture, refactor, and supporting documentation.
- `soniox-poc/` is a separate proof-of-concept; avoid changing it unless the task explicitly targets it.
- The old `backend/` and `worker/` stacks are not present in the active repository and should not be recreated unless explicitly requested.

## Build, Test, and Development Commands

The frontend requires Node.js 24 or newer and npm. Run frontend commands from `frontend/`:

```bash
npm install
npm run dev          # Next.js development server at http://localhost:3000
npm run build
npm run start
npm run lint
npm run typecheck
npm test
npm run test:ci      # Jest in-band
```

### Recommended Local Stack

The primary local workflow uses Supabase CLI plus Docker Compose. Docker Desktop and the Supabase CLI are required; ngrok is needed for Deepgram webhook callbacks.

```bash
cd infra
./start-local.sh
```

`start-local.sh` starts Supabase, creates `infra/.env.docker` from its example when needed, injects local Supabase keys, starts the frontend and Inngest containers, and starts ngrok when available. Set `DEEPGRAM_API_KEY` and `DEEPGRAM_API_KEY_IDENTIFIER` in `infra/.env.docker`. When ngrok is available, the script updates `DEEPGRAM_CALLBACK_URL` automatically; otherwise configure it manually with `/api/webhooks/deepgram` appended to the public URL.

```bash
cd infra
docker compose -f docker-compose.dev.yml logs -f
./stop-local.sh
```

Useful local URLs:

- Frontend: `http://localhost:3000`
- Supabase API: `http://localhost:54321`
- Supabase Studio: `http://localhost:54323`
- Inngest: `http://localhost:8288`
- ngrok Inspector: `http://localhost:4040`

### Local Development Without Docker

Run the frontend and Inngest directly in separate terminals:

```bash
cd frontend
npm run dev
```

```bash
cd frontend
npm run inngest
```

Set `INNGEST_DEV=1` in `frontend/.env.local` for the non-Docker workflow. The optional root helper script can start or stop these services (and ngrok):

```bash
./dev.sh start
./dev.sh stop
./dev.sh restart
```

## App Test Authentication (login)

Use this development test account to log in to the app:

- Email: `ui5nvlw97q@mkzaso.com`
- Password: `4qdGNrheWHR25Js`

Keep these credentials available for UI testing. Do not use them as production credentials or move them into committed environment files.

## Testing Guidelines

- Frontend tests use Jest 30 with `jest-environment-jsdom`; keep test files under `frontend/__tests__/` and run targeted tests when possible.
- Use `npm run typecheck` in addition to lint for TypeScript validation.
- `npm run lint` uses the current flat ESLint configuration in `frontend/eslint.config.mjs`.
- The project currently uses TypeScript 6.0.2 while the nested `typescript-eslint` 8.57.2 dependency used by `eslint-config-next` declares support for TypeScript versions below 6.0. The current install resolves TypeScript 6.0.2 for ESLint and npm reports that range as invalid; the separate TypeScript 5.9.3 install belongs to `@inngest/ai`. Lint and typecheck are complementary; do not rely on lint alone for TypeScript 6-specific behavior.

## Coding Style & Naming Conventions

- TypeScript/React: 2-space indentation, PascalCase components, and Tailwind CSS utilities for styling.
- Keep style consistent with surrounding files; no repo-wide formatter is enforced.
- For theme-aware UI responsibilities, use semantic role utilities such as `text-foreground`, `bg-surface`, and `border-border`. Reserve palette utilities such as `text-ink` and `bg-ember-red` for intentional brand, status, highlight, or inverse treatments. Declare reusable semantic roles through `@theme inline` rather than unlayered helper classes.
- Legacy Python conventions are not applicable to the active stack. If legacy code is explicitly targeted, use 4-space indentation, snake_case names, and type hints.

## Commit & Pull Request Guidelines

- Commit messages follow Conventional Commits, such as `feat: ...`, `fix: ...`, and `fix(frontend): ...`.
- Codex-authored commits should include a concise narrative plus concrete bullets covering important files, behavior, tests, and verification when the change is more than trivial.
- PRs should include a short summary, test commands run, and screenshots for UI changes when applicable. Link related issues when available.

## Security & Configuration Tips

- Use `infra/.env.docker` and `frontend/.env.local` for local secrets; never commit API keys, tokens, or generated environment files.
- `DEEPGRAM_API_KEY` is required for transcription. A public ngrok callback is required when running the webhook flow through local Docker.
- Supabase local seed and test-account setup are intended for development only.
- Before changing Docker, Supabase, storage, or recording behavior, check whether local databases, recordings, volumes, or secrets may be affected.

## Documentation

- Product requirements: `PRD.md`
- Change history: `CHANGELOG.md`
- Refactor documentation archive: `.docs/archive/Refactor Documentation/REFACTOR_README.md`

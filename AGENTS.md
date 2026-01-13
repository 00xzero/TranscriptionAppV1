# Repository Guidelines

## Project Structure & Module Organization
- `frontend/` Next.js 14 app (App Router). UI lives in `frontend/app/`, shared UI in `frontend/components/`, and tests in `frontend/__tests__/`.
- `backend/` FastAPI service. Main code in `backend/app/`, DB migrations in `backend/alembic/`, and tests in `backend/tests/`.
- `worker/` Celery worker service (shares models with the backend).
- `infra/` Docker Compose config for local stack (Postgres, Redis, MinIO, API, worker, frontend).
- Repo docs: `README.md`, `PRD.md`, `CHANGELOG.md`.

## Build, Test, and Development Commands
```bash
# Copy config
cp env.example .env

# Run full stack via Docker Compose (primary workflow)
docker compose -f infra/docker-compose.yml up --build

# Backend tests (pytest) inside the API container
docker compose -f infra/docker-compose.yml exec api python -m pytest -v
```
Notes: the primary workflow is Docker-based; compose config lives at `infra/docker-compose.yml`. Backend tests are pytest-based and some are integration-style (they may skip if the API is not running). Run any frontend checks inside the `frontend` container.

## Coding Style & Naming Conventions
- TypeScript/React: 2-space indentation, PascalCase components, and Tailwind CSS utilities for styling.
- Python: 4-space indentation, snake_case functions/variables, type hints in Pydantic models.
- Keep style consistent with surrounding files; no repo-wide formatter is enforced.

## Testing Guidelines
- Frontend: Jest (`frontend/jest.config.js`), test files under `frontend/__tests__/`.
- Backend: Pytest (`backend/pytest.ini`), test files named `test_*.py`.
- Prefer targeted tests for new logic (unit in backend, component/integration in frontend).

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits (examples from history: `feat: ...`, `fix: ...`, `fix(frontend): ...`).
- PRs should include a short summary, test command(s) run, and screenshots for UI changes when applicable. Link related issues if they exist.

## Security & Configuration Tips
- Use `.env` (from `env.example`) for secrets; never commit API keys or tokens.
- Default local token is `devtoken`. Deepgram API key is required for transcription.

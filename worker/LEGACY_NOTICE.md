# Legacy Worker Notice

This directory (`worker/`) contains the legacy Celery worker implementation.
As of Phase 10 of the refactor (2026-01-23), this stack has been replaced by:
- **Background Jobs**: Inngest (managed via `frontend/lib/inngest/`)
- **Transcription**: Deepgram Async with Webhooks

This code is preserved for reference only and is no longer part of the active development stack.

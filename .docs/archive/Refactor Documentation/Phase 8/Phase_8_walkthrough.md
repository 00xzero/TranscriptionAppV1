# Phase 8: Export Parity - Walkthrough

## Summary

Phase 8 replaced the legacy FastAPI export endpoints with new Next.js API routes that use Supabase for data fetching and authentication.

## What Changed

### New Files

| File | Purpose |
|:---|:---|
| [exports.ts](../../../frontend/lib/exports.ts) | TypeScript export generators (DOCX, VTT) |
| [data.ts](../../../frontend/lib/exports/data.ts) | Shared data fetching helper |
| [docx/route.ts](../../../frontend/app/api/projects/%5Bid%5D/export/docx/route.ts) | DOCX export endpoint |
| [vtt/route.ts](../../../frontend/app/api/projects/%5Bid%5D/export/vtt/route.ts) | VTT export endpoint |
| [exports.test.ts](../../../frontend/__tests__/exports.test.ts) | 22 unit tests |

### Modified Files

| File | Changes |
|:---|:---|
| [ExportModal.tsx](../../../frontend/components/ExportModal.tsx) | Uses new `/api/projects/{id}/export/{format}` endpoints, PDF disabled |
| [package.json](../../../frontend/package.json) | Added `docx@^9.0.0` |

---

## How to Test

### Unit Tests
```bash
cd frontend && npm test -- --testPathPattern=exports
```

### Manual Testing
1. Start the dev server: `npm run dev`
2. Navigate to a completed project in the Editor
3. Click **Export** button
4. Select DOCX or VTT format
5. Verify file downloads with correct content
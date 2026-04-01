# API Route Mapping

> **Purpose**: Map current FastAPI endpoints to target implementation in the new stack.

## Legend

| Target | Description |
|:---|:---|
| **Supabase Direct** | Frontend calls Supabase client directly (RLS protects data) |
| **Next.js API** | Server-side route handler (for signed URLs, exports, triggers) |
| **Inngest** | Background job function |

---

## Projects

| Current Endpoint | Method | Target | Notes |
|:---|:---|:---|:---|
| `/projects` | POST | Next.js API + Supabase | Create project, initialize storage path |
| `/projects` | GET | Supabase Direct | List with RLS filter by `user_id` |
| `/projects/{id}` | GET | Supabase Direct | Single project read |
| `/projects/{id}` | PATCH | Supabase Direct | Update title |
| `/projects/{id}` | DELETE | Supabase Direct | Cascade delete (RLS + FK) |
| `/projects/{id}/start` | POST | Next.js API → Inngest | Trigger `transcription.requested` event |
| `/projects/{id}/media-url` | GET | Next.js API | Generate signed download URL |

---

## Key Terms / Watchlist

| Current Endpoint | Method | Target | Notes |
|:---|:---|:---|:---|
| `/projects/{id}/key-terms` | PATCH | Supabase Direct | Update watchlist terms |

---

## Jobs

| Current Endpoint | Method | Target | Notes |
|:---|:---|:---|:---|
| `/projects/{id}/jobs` | GET | Supabase Direct | List jobs for project |

---

## Segments & Import

| Current Endpoint | Method | Target | Notes |
|:---|:---|:---|:---|
| `/projects/{id}/segments` | GET | Supabase Direct | List raw segments |
| `/projects/{id}/segments/import` | POST | Next.js API → Inngest | Bulk import + trigger consolidation |
| `/segments/{id}` | PATCH | Supabase Direct | Edit segment text |

---

## Chunks (Editor Data)

| Current Endpoint | Method | Target | Notes |
|:---|:---|:---|:---|
| `/projects/{id}/chunks` | GET | Supabase Direct | List chunks for editor display |
| `/chunks/{id}` | PATCH | Supabase Direct | Edit chunk (sets `is_edited=true`) |

---

## Speakers

| Current Endpoint | Method | Target | Notes |
|:---|:---|:---|:---|
| `/projects/{id}/speakers` | GET | Supabase Direct | List speakers |
| `/projects/{id}/speakers` | POST | Supabase Direct | Create speaker |
| `/speakers/{id}` | PATCH | Supabase Direct | Rename/update speaker |

---

## Exports

| Current Endpoint | Method | Target | Notes |
|:---|:---|:---|:---|
| `/projects/{id}/export/docx` | GET | Next.js API | Node runtime, `docx` library |
| `/projects/{id}/export/vtt` | GET | Next.js API | Plain text formatting |
| `/projects/{id}/export/pdf` | GET | Next.js API | Optional, `pdf-lib` or defer |

---

## Summary

| Category | Supabase Direct | Next.js API | Inngest |
|:---|:---:|:---:|:---:|
| **Projects CRUD** | 4 | 1 | - |
| **Transcription** | - | 1 | 1 |
| **Media URLs** | - | 1 | - |
| **Segments/Chunks** | 4 | - | - |
| **Import** | - | 1 | 1 |
| **Speakers** | 3 | - | - |
| **Exports** | - | 3 | - |
| **Jobs** | 1 | - | - |
| **Key Terms** | 1 | - | - |
| **Total** | **13** | **7** | **2** |

---

## Post-Refactor Location

> After refactor completion, move this file to:  
> `docs/architecture/API_ROUTE_MAPPING.md` (frontend codebase root)

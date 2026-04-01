# Glossary

Quick reference for domain terms and technical concepts.

## Domain Terms

| Term | Definition |
|:---|:---|
| **Transcription** | Converting audio/video speech to text |
| **Diarization** | Detecting who spoke when (speaker identification) |
| **Utterance** | A continuous speech segment from one speaker |
| **Key Term** | A domain-specific word/phrase sent to Deepgram for better recognition |
| **Watchlist** | Collection of key terms for a project |

## Data Model Terms

| Term | Definition |
|:---|:---|
| **Project** | Container for one transcription job (1 file = 1 project) |
| **Speaker** | A labeled voice (e.g., "Speaker 0", "John") with a color |
| **Segment** | Raw Deepgram output chunk with start/end timestamps and speaker |
| **Word** | Individual word with timestamp and confidence score |
| **Chunk** | Post-processed segment for display (consolidates fragmented utterances) |
| **ChunkWord** | Link between Chunk and original Words (for word-level highlighting) |
| **Job** | Background processing record with status lifecycle |

## Job Statuses

| Status | Meaning |
|:---|:---|
| `queued` | Job created, waiting to start |
| `processing` | Actively transcribing |
| `completed` | Successfully finished |
| `error` | Failed (check `payload` for details) |

## Project Statuses

| Status | Meaning |
|:---|:---|
| `pending` | Created, awaiting upload |
| `uploaded` | File received, ready for transcription |
| `transcribing` | Deepgram processing |
| `completed` | Transcript ready for editing |
| `error` | Transcription failed |

## Technical Stack Terms

| Term | Definition |
|:---|:---|
| **Supabase** | Open-source Firebase alternative (Postgres + Auth + Storage + Realtime) |
| **Inngest** | Event-driven background job platform |
| **Deepgram Nova 3** | STT API with diarization support |
| **RLS** | Row-Level Security (Postgres feature for access control) |
| **Signed URL** | Temporary URL with embedded auth for storage access |

## Error Types

| Type | Meaning |
|:---|:---|
| `keyterm_error` | Deepgram rejected key terms (e.g., invalid characters) |
| `transcription_error` | General transcription failure |

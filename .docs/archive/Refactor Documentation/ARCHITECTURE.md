# Architecture Documentation

## System Diagrams

### Current Architecture (Legacy)

```mermaid
flowchart TB
    subgraph Client
        Browser["Browser"]
    end

    subgraph Frontend["Frontend (Next.js 14)"]
        Upload["Upload Page"]
        Projects["Projects List"]
        Editor["Transcript Editor"]
    end

    subgraph Backend["Backend (FastAPI)"]
        API["FastAPI API"]
        Auth["Token Auth"]
        Services["Services"]
    end

    subgraph Worker["Worker (Celery)"]
        Transcriber["Transcription Pipeline"]
    end

    subgraph Storage
        PostgreSQL[("PostgreSQL")]
        MinIO[("MinIO")]
        Redis[("Redis")]
    end

    subgraph External
        Deepgram["Deepgram API"]
    end

    Browser --> Frontend
    Frontend --> API
    API --> Services
    Services --> PostgreSQL
    Services --> MinIO
    Services --> Redis
    Redis --> Transcriber
    Transcriber --> Deepgram
    Transcriber --> PostgreSQL
```

### Target Architecture (After Refactor)

```mermaid
flowchart TB
    subgraph Client
        Browser["Browser"]
    end

    subgraph Vercel["Vercel"]
        NextJS["Next.js 14"]
        APIRoutes["API Routes"]
    end

    subgraph Supabase["Supabase"]
        Auth["Auth"]
        DB[("PostgreSQL")]
        Storage[("Storage")]
        Realtime["Realtime"]
    end

    subgraph Inngest["Inngest"]
        Jobs["Background Jobs"]
    end

    subgraph External
        Deepgram["Deepgram API"]
    end

    Browser --> NextJS
    NextJS --> Supabase
    APIRoutes --> Inngest
    Inngest --> Deepgram
    Inngest --> DB
    Realtime --> Browser
```

## Data Model

```mermaid
erDiagram
    PROJECT ||--o{ SPEAKER : has
    PROJECT ||--o{ SEGMENT : has
    PROJECT ||--o{ CHUNK : has
    PROJECT ||--o{ JOB : has
    PROJECT ||--o{ WATCHLIST : has
    
    SPEAKER ||--o{ SEGMENT : owns
    SPEAKER ||--o{ CHUNK : owns
    
    SEGMENT ||--o{ WORD : contains
    CHUNK ||--o{ CHUNK_WORD : contains
    WORD ||--o{ CHUNK_WORD : referenced_by

    PROJECT {
        string id PK
        string user_id FK
        string title
        string status
        int duration_ms
        string s3_key
    }
    
    SPEAKER {
        string id PK
        string project_id FK
        string label
        string color
    }
    
    CHUNK {
        string id PK
        string project_id FK
        string speaker_id FK
        int start_ms
        int end_ms
        string text
        bool is_edited
    }
    
    JOB {
        string id PK
        string project_id FK
        string status
        string job_type
    }
```

## Transcription Flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant API as API
    participant Storage as Storage
    participant Queue as Job Queue
    participant Worker as Worker
    participant DG as Deepgram

    U->>FE: Upload file
    FE->>API: Create project
    API->>Storage: Get signed upload URL
    FE->>Storage: Upload file
    FE->>API: Start transcription
    API->>Queue: Enqueue job
    Queue->>Worker: Process job
    Worker->>Storage: Get file URL
    Worker->>DG: Transcribe (async)
    DG-->>Worker: Webhook callback
    Worker->>API: Save results
    FE->>API: Poll for status
    API-->>FE: Completed
```

## Key Components

### Frontend
- **Upload Page**: File upload + key terms input
- **Projects Page**: List with status, actions, error handling
- **Editor Page**: Waveform player + editable transcript + exports

### Backend (Legacy → Supabase)
- **Projects Router**: CRUD + transcription triggers
- **Export Service**: DOCX, VTT, PDF generation
- **Consolidation Service**: Merges raw segments into display chunks

### Worker (Legacy → Inngest)
- **transcribe_project**: Main transcription task
- Calls Deepgram, parses response, stores segments/words
- Triggers consolidation after import

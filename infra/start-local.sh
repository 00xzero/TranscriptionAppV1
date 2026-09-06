#!/bin/bash
# start-local.sh - One-command local development startup
# Starts Supabase (via CLI) and Inngest + Frontend (via Docker Compose)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE="online"

print_usage() {
    cat <<'EOF'
Usage: ./start-local.sh [--offline | --prepare-offline]

  --offline          Start only from cached images and dependencies. Skips
                     ngrok; Deepgram transcription is unavailable.
  --prepare-offline  While connected, pull/build and start everything needed
                     for a later --offline startup. Skips ngrok.
EOF
}

if [ "$#" -gt 1 ]; then
    print_usage >&2
    exit 2
fi

case "${1:-}" in
    "") ;;
    --offline) MODE="offline" ;;
    --prepare-offline) MODE="prepare-offline" ;;
    -h|--help)
        print_usage
        exit 0
        ;;
    *)
        echo "Unknown option: $1" >&2
        print_usage >&2
        exit 2
        ;;
esac

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

upsert_env_var() {
    local file="$1"
    local key="$2"
    local value="$3"

    if grep -q "^${key}=" "$file"; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|^${key}=.*|${key}=${value}|g" "$file"
        else
            sed -i "s|^${key}=.*|${key}=${value}|g" "$file"
        fi
    else
        echo "${key}=${value}" >> "$file"
    fi
}

if [ "$MODE" = "offline" ]; then
    echo -e "${YELLOW}✈️  Starting Local Development Stack (offline)${NC}"
elif [ "$MODE" = "prepare-offline" ]; then
    echo -e "${YELLOW}📦 Preparing Local Development Stack for offline use${NC}"
else
    echo -e "${YELLOW}🚀 Starting Local Development Stack${NC}"
fi
echo "================================================"

# Check prerequisites
if ! command -v supabase &> /dev/null; then
    echo -e "${RED}Error: Supabase CLI not found${NC}"
    echo "Install with: brew install supabase/tap/supabase"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker not found${NC}"
    echo "Install Docker Desktop from: https://docker.com/products/docker-desktop"
    exit 1
fi

# Step 1: Start Supabase
echo -e "\n${YELLOW}[1/4] Starting Supabase...${NC}"
# This app has no Supabase Edge Functions. Excluding the unused runtime also
# avoids its remote Deno/JSR bootstrap, which would make local startup depend on
# external package registries.
start_supabase() {
    if [ "$MODE" = "offline" ]; then
        (cd supabase && SUPABASE_TELEMETRY_DISABLED=1 supabase start --exclude edge-runtime)
    else
        (cd supabase && supabase start --exclude edge-runtime)
    fi
}

if ! start_supabase; then
    if [ "$MODE" = "offline" ]; then
        echo -e "${RED}Offline Supabase startup failed.${NC}" >&2
        echo "A required Supabase image may not be cached. Reconnect and run:" >&2
        echo "  ./start-local.sh --prepare-offline" >&2
    fi
    exit 1
fi

# Step 2: Extract Supabase keys and create .env.docker if needed
echo -e "\n${YELLOW}[2/4] Configuring environment...${NC}"
if [ ! -f ".env.docker" ]; then
    echo "Creating .env.docker from template..."
    cp .env.docker.example .env.docker
    
    # Get keys from Supabase status
    ANON_KEY=$(cd supabase && supabase status -o env | grep "ANON_KEY" | cut -d'=' -f2)
    SERVICE_KEY=$(cd supabase && supabase status -o env | grep "SERVICE_ROLE_KEY" | cut -d'=' -f2)
    
    # Update .env.docker with actual keys (macOS compatible sed)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|<paste ANON_KEY from supabase status>|$ANON_KEY|g" .env.docker
        sed -i '' "s|<paste SERVICE_ROLE_KEY from supabase status>|$SERVICE_KEY|g" .env.docker
    else
        sed -i "s|<paste ANON_KEY from supabase status>|$ANON_KEY|g" .env.docker
        sed -i "s|<paste SERVICE_ROLE_KEY from supabase status>|$SERVICE_KEY|g" .env.docker
    fi
    
    echo -e "${YELLOW}⚠️  Please update DEEPGRAM_API_KEY in .env.docker${NC}"
else
    echo ".env.docker already exists, skipping..."
fi

# Ensure media proxy settings are present for local Deepgram proxy usage
if [ -f ".env.docker" ]; then
    if ! grep -q '^MEDIA_PROXY_SECRET=' .env.docker; then
        if command -v uuidgen &> /dev/null; then
            PROXY_SECRET=$(uuidgen | tr '[:upper:]' '[:lower:]')
        elif command -v openssl &> /dev/null; then
            PROXY_SECRET=$(openssl rand -hex 16)
        else
            PROXY_SECRET=$(date +%s%N)
        fi
        echo "MEDIA_PROXY_SECRET=${PROXY_SECRET}" >> .env.docker
        echo -e "${YELLOW}Added MEDIA_PROXY_SECRET to .env.docker${NC}"
    fi

    if ! grep -q '^DEEPGRAM_USE_PROXY=' .env.docker; then
        echo "DEEPGRAM_USE_PROXY=true" >> .env.docker
        echo -e "${YELLOW}Set DEEPGRAM_USE_PROXY=true in .env.docker${NC}"
    fi
fi

# Step 3: Start ngrok for Deepgram (required for transcription in Docker)
echo -e "\n${YELLOW}[3/4] Configuring ngrok tunnel (for Deepgram)...${NC}"
if [ "$MODE" != "online" ]; then
    echo -e "${YELLOW}Skipping ngrok in ${MODE} mode.${NC}"
    echo "   Deepgram transcription will be unavailable; local app features remain usable."
elif command -v ngrok &> /dev/null; then
    # Kill any existing ngrok processes
    pkill -f ngrok 2>/dev/null || true
    sleep 1
    
    # Start ngrok detached so the tunnel survives after this script exits
    nohup ngrok http 3000 </dev/null >/tmp/transcription-app-ngrok.log 2>&1 &
    NGROK_PID=$!
    disown "$NGROK_PID" 2>/dev/null || true
    sleep 3
    
    # Get the ngrok URL
    NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -n "$NGROK_URL" ]; then
        CALLBACK_URL="${NGROK_URL}/api/webhooks/deepgram"
        if [ -f ".env.docker" ]; then
            upsert_env_var ".env.docker" "DEEPGRAM_CALLBACK_URL" "$CALLBACK_URL"
        fi
        echo -e "${GREEN}ngrok tunnel active: ${NGROK_URL}${NC}"
        echo -e "${GREEN}Updated .env.docker with:${NC}"
        echo -e "   DEEPGRAM_CALLBACK_URL=${CALLBACK_URL}"
    else
        echo -e "${YELLOW}⚠️  ngrok started but URL not detected. Check: http://localhost:4040${NC}"
        echo -e "   Logs: /tmp/transcription-app-ngrok.log"
    fi
else
    echo -e "${YELLOW}⚠️  ngrok not found. Install with: brew install ngrok${NC}"
    echo "   Transcription will not work without ngrok tunnel."
fi

# Step 4: Start Docker services after the callback URL is written
echo -e "\n${YELLOW}[4/4] Starting Inngest + Frontend...${NC}"
if [ "$MODE" = "offline" ]; then
    MISSING_IMAGES=""
    for image in $(docker compose -f docker-compose.dev.yml config --images); do
        if ! docker image inspect "$image" >/dev/null 2>&1; then
            MISSING_IMAGES="${MISSING_IMAGES}\n  - ${image}"
        fi
    done

    if [ -n "$MISSING_IMAGES" ]; then
        echo -e "${RED}Offline startup is missing required cached images:${NC}${MISSING_IMAGES}" >&2
        echo "Reconnect and run: ./start-local.sh --prepare-offline" >&2
        exit 1
    fi

    OFFLINE_MODE=1 NEXT_TELEMETRY_DISABLED=1 docker compose -f docker-compose.dev.yml up --no-build --pull never -d
elif [ "$MODE" = "prepare-offline" ]; then
    docker compose -f docker-compose.dev.yml pull inngest
    docker compose -f docker-compose.dev.yml build --pull frontend
    OFFLINE_MODE=0 docker compose -f docker-compose.dev.yml up -d
else
    OFFLINE_MODE=0 docker compose -f docker-compose.dev.yml up --build -d
fi

# Wait for services to be ready
echo -e "\n${YELLOW}Waiting for services to start...${NC}"
sleep 5

if ! docker compose -f docker-compose.dev.yml ps --status running --services | grep -qx 'frontend'; then
    echo -e "${RED}Frontend did not remain running.${NC}" >&2
    docker compose -f docker-compose.dev.yml logs --tail 30 frontend >&2 || true
    if [ "$MODE" = "offline" ]; then
        echo "Reconnect and run: ./start-local.sh --prepare-offline" >&2
    fi
    exit 1
fi

if [ "$MODE" = "prepare-offline" ]; then
    FRONTEND_READY=false
    for _ in {1..30}; do
        if curl -fsS http://127.0.0.1:3000 >/dev/null 2>&1; then
            FRONTEND_READY=true
            break
        fi
        sleep 1
    done

    if [ "$FRONTEND_READY" != "true" ]; then
        echo -e "${RED}Frontend did not become ready while preparing offline mode.${NC}" >&2
        docker compose -f docker-compose.dev.yml logs --tail 30 frontend >&2 || true
        exit 1
    fi
fi

if [ "$MODE" = "offline" ]; then
    NGROK_STATUS="skipped (offline)"
elif [ "$MODE" = "prepare-offline" ]; then
    NGROK_STATUS="skipped (preparation)"
else
    NGROK_STATUS="http://localhost:4040 (tunnel inspector)"
fi

echo -e "
${GREEN}✅ Local development stack is running!${NC}
================================================

  ${GREEN}Frontend:${NC}  http://localhost:3000
  ${GREEN}Studio:${NC}    http://localhost:54323
  ${GREEN}Inngest:${NC}   http://localhost:8288
  ${GREEN}ngrok:${NC}     ${NGROK_STATUS}
  ${GREEN}Inbucket:${NC}  http://localhost:54324 (email testing)
  ${GREEN}API:${NC}       http://localhost:54321

${YELLOW}Commands:${NC}
  Stop all:     ./stop-local.sh
  View logs:    docker compose -f docker-compose.dev.yml logs -f
  Reset DB:     cd supabase && supabase db reset
"

if [ "$MODE" = "offline" ]; then
    echo -e "${YELLOW}Offline mode:${NC} ngrok and Deepgram transcription are unavailable."
elif [ "$MODE" = "prepare-offline" ]; then
    echo -e "${GREEN}Offline prerequisites are ready.${NC} You can now stop the stack and later run:"
    echo "  ./start-local.sh --offline"
fi

#!/bin/bash
# start-local.sh - One-command local development startup
# Starts Supabase (via CLI) and Inngest + Frontend (via Docker Compose)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🚀 Starting Local Development Stack${NC}"
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
cd supabase
supabase start
cd ..

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

# Step 3: Start Docker services
echo -e "\n${YELLOW}[3/4] Starting Inngest + Frontend...${NC}"
docker compose -f docker-compose.dev.yml up --build --renew-anon-volumes -d

# Step 4: Start ngrok for Deepgram (required for transcription in Docker)
echo -e "\n${YELLOW}[4/4] Starting ngrok tunnel (for Deepgram)...${NC}"
if command -v ngrok &> /dev/null; then
    # Kill any existing ngrok processes
    pkill -f ngrok 2>/dev/null || true
    sleep 1
    
    # Start ngrok in background
    ngrok http 3000 > /dev/null 2>&1 &
    NGROK_PID=$!
    sleep 3
    
    # Get the ngrok URL
    NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -n "$NGROK_URL" ]; then
        echo -e "${GREEN}ngrok tunnel active: ${NGROK_URL}${NC}"
        echo -e "${YELLOW}⚠️  Update .env.docker with:${NC}"
        echo -e "   DEEPGRAM_CALLBACK_URL=${NGROK_URL}/api/webhooks/deepgram"
    else
        echo -e "${YELLOW}⚠️  ngrok started but URL not detected. Check: http://localhost:4040${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  ngrok not found. Install with: brew install ngrok${NC}"
    echo "   Transcription will not work without ngrok tunnel."
fi

# Wait for services to be ready
echo -e "\n${YELLOW}Waiting for services to start...${NC}"
sleep 5

echo -e "
${GREEN}✅ Local development stack is running!${NC}
================================================

  ${GREEN}Frontend:${NC}  http://localhost:3000
  ${GREEN}Studio:${NC}    http://localhost:54323
  ${GREEN}Inngest:${NC}   http://localhost:8288
  ${GREEN}ngrok:${NC}     http://localhost:4040 (tunnel inspector)
  ${GREEN}Inbucket:${NC}  http://localhost:54324 (email testing)
  ${GREEN}API:${NC}       http://localhost:54321

${YELLOW}Commands:${NC}
  Stop all:     ./stop-local.sh
  View logs:    docker compose -f docker-compose.dev.yml logs -f
  Reset DB:     cd supabase && supabase db reset
"

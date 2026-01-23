#!/bin/bash
# stop-local.sh - Stop all local development services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🛑 Stopping Local Development Stack${NC}"
echo "================================================"

# Stop Docker services
echo -e "\n${YELLOW}[1/3] Stopping Inngest + Frontend...${NC}"
docker compose -f docker-compose.dev.yml down

# Stop Supabase
echo -e "\n${YELLOW}[2/3] Stopping Supabase...${NC}"
cd supabase
supabase stop
cd ..

# Stop ngrok
echo -e "\n${YELLOW}[3/3] Stopping ngrok...${NC}"
pkill -f ngrok 2>/dev/null || echo "ngrok not running"

echo -e "\n${GREEN}✅ All services stopped${NC}"

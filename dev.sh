#!/bin/bash

# Configuration
NGROK_DOMAIN="janiya-slinkier-cursorily.ngrok-free.dev"
# Get the directory where the script is stored
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PID_DIR="$SCRIPT_DIR/.dev_pids_dir"
LOG_DIR="$SCRIPT_DIR/.dev_logs"

setup_dirs() {
    mkdir -p "$LOG_DIR"
    mkdir -p "$PID_DIR"
}

# --- Helper Functions ---

get_pid() {
    local service=$1
    if [ -f "$PID_DIR/$service.pid" ]; then
        cat "$PID_DIR/$service.pid"
    fi
}

save_pid() {
    local service=$1
    local pid=$2
    echo "$pid" > "$PID_DIR/$service.pid"
}

remove_pid() {
    local service=$1
    rm -f "$PID_DIR/$service.pid"
}

# --- Service Control Functions ---

start_ngrok() {
    if [ -n "$(get_pid ngrok)" ]; then
        echo "Ngrok is already running (PID: $(get_pid ngrok))"
        # We don't return here because we might be restarting other services
        # providing a "start" command should be idempotent-ish or at least noisy
    else
        echo "Starting Ngrok on domain $NGROK_DOMAIN..."
        ngrok http --domain="$NGROK_DOMAIN" 3000 > "$LOG_DIR/ngrok.log" 2>&1 &
        local pid=$!
        save_pid ngrok $pid
        echo "Ngrok started (PID: $pid)"
    fi
}

stop_ngrok() {
    local pid=$(get_pid ngrok)
    if [ -n "$pid" ]; then
        if ps -p "$pid" > /dev/null; then
            kill "$pid"
            echo "Killed Ngrok (PID: $pid)"
        fi
        remove_pid ngrok
    fi
    # Fallback cleanup
    pkill -f "ngrok http.*$NGROK_DOMAIN" 2>/dev/null || true
    pkill -f "ngrok http.*3000" 2>/dev/null || true
}

start_inngest() {
    if [ -n "$(get_pid inngest)" ]; then
        echo "Inngest is already running (PID: $(get_pid inngest))"
    else
        echo "Starting Inngest..."
        cd "$SCRIPT_DIR/frontend" && npm run inngest > "$LOG_DIR/inngest.log" 2>&1 &
        local pid=$!
        save_pid inngest $pid
        echo "Inngest started (PID: $pid)"
    fi
}

stop_inngest() {
    local pid=$(get_pid inngest)
    if [ -n "$pid" ]; then
        if ps -p "$pid" > /dev/null; then
            kill "$pid"
            echo "Killed Inngest (PID: $pid)"
        fi
        remove_pid inngest
    fi
    # Fallback cleanup
    if command -v lsof >/dev/null; then
        local pids=$(lsof -ti:8288)
        [ ! -z "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null
    fi
    pkill -f "inngest-cli" 2>/dev/null || true
}

start_frontend() {
    if [ -n "$(get_pid frontend)" ]; then
        echo "Frontend is already running (PID: $(get_pid frontend))"
    else
        echo "Starting Frontend..."
        cd "$SCRIPT_DIR/frontend" && npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
        local pid=$!
        save_pid frontend $pid
        echo "Frontend started (PID: $pid)"
    fi
}

stop_frontend() {
    local pid=$(get_pid frontend)
    if [ -n "$pid" ]; then
        if ps -p "$pid" > /dev/null; then
            kill "$pid"
            echo "Killed Frontend (PID: $pid)"
        fi
        remove_pid frontend
    fi
    # Fallback cleanup
    if command -v lsof >/dev/null; then
        local pids=$(lsof -ti:3000)
        [ ! -z "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null
    fi
}

start_all() {
    setup_dirs
    start_ngrok
    start_inngest
    start_frontend
    echo "-----------------------------------"
    echo "Frontend: http://localhost:3000"
    echo "Inngest:  http://localhost:8288"
}

stop_all() {
    stop_frontend
    stop_inngest
    stop_ngrok
    echo "All services stopped."
}

# --- Main Logic ---

SERVICE=$2
VALID_SERVICES="frontend inngest ngrok"

# Validate service name if provided
if [ -n "$SERVICE" ]; then
    if [[ ! " $VALID_SERVICES " =~ " $SERVICE " ]]; then
        echo "Error: Unknown service '$SERVICE'"
        echo "Valid services: $VALID_SERVICES"
        exit 1
    fi
fi

case "$1" in
    start)
        setup_dirs
        if [ "$SERVICE" == "frontend" ]; then start_frontend
        elif [ "$SERVICE" == "inngest" ]; then start_inngest
        elif [ "$SERVICE" == "ngrok" ]; then start_ngrok
        elif [ -z "$SERVICE" ]; then start_all
        fi
        ;;
    stop)
        if [ "$SERVICE" == "frontend" ]; then stop_frontend
        elif [ "$SERVICE" == "inngest" ]; then stop_inngest
        elif [ "$SERVICE" == "ngrok" ]; then stop_ngrok
        elif [ -z "$SERVICE" ]; then stop_all
        fi
        ;;
    restart)
        setup_dirs
        if [ "$SERVICE" == "frontend" ]; then 
            stop_frontend
            sleep 1
            start_frontend
        elif [ "$SERVICE" == "inngest" ]; then 
            stop_inngest
            sleep 1
            start_inngest
        elif [ "$SERVICE" == "ngrok" ]; then 
            stop_ngrok
            sleep 1
            start_ngrok
        elif [ -z "$SERVICE" ]; then 
            stop_all
            sleep 2
            start_all
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|restart} [frontend|inngest|ngrok]"
        exit 1
        ;;
esac

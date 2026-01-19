# Dev Script Walkthrough

I have created a [dev.sh](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/dev.sh) script to easily manage your development environment.

## Features

- **Start**: Launches the following services in the background:
    - **Frontend**: `http://localhost:3000`
    - **Inngest**: `http://localhost:8288`
    - **Ngrok**: Forwards to port 3000 using your specific domain `janiya-slinkier-cursorily.ngrok-free.dev`.
- **Stop**: Safely terminates all background processes created by the script.
- **Restart**: Stops and then starts the services.

## Usage

Make sure the script is executable (I've already run this for you):
```bash
chmod +x dev.sh
```

### Start Services
```bash
# Start all
./dev.sh start

# Start specific service
./dev.sh start frontend
./dev.sh start inngest
./dev.sh start ngrok
```

### Stop Services
```bash
# Stop all
./dev.sh stop

# Stop specific service
./dev.sh stop frontend
```

### Restart Services
You can restart all services or just one:
```bash
# Restart all
./dev.sh restart

# Restart only Frontend
./dev.sh restart frontend

# Restart only Inngest
./dev.sh restart inngest

# Restart only Ngrok
./dev.sh restart ngrok
```

## Logs

Logs for each service are stored in the `.dev_logs` directory:
- [.dev_logs/frontend.log](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/.dev_logs/frontend.log)
- [.dev_logs/inngest.log](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/.dev_logs/inngest.log)
- [.dev_logs/ngrok.log](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/.dev_logs/ngrok.log)

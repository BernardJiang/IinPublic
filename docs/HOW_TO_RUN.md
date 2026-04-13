# How to Run IinPublic Web Application

This guide will walk you through running the IinPublic web application step-by-step.

## Prerequisites

Before starting, ensure you have:

- **Node.js** version 18.0.0 or higher ([Download here](https://nodejs.org/))
- **npm** (comes with Node.js)
- **Git** (for cloning the repository)
- A modern web browser (Chrome, Firefox, Safari, or Edge)

### Check Prerequisites

```bash
# Check Node.js version (should be 18.0.0 or higher)
node --version

# Check npm version
npm --version

# Check Git version
git --version
```

## Step 1: Clone or Navigate to the Project

If you haven't already cloned the repository:

```bash
git clone <repository-url>
cd IinPublic
```

Or if you already have it:

```bash
cd IinPublic
```

## Step 2: Install Dependencies

Install all required npm packages:

```bash
npm install
```

This will install ~710 packages and may take 2-5 minutes depending on your internet connection.

**Expected output:**

```
added 710 packages, and audited 711 packages in 2m
```

## Step 3: Choose Your Running Method

You have three options:

### Option A: Run Everything (Web + Server) - Recommended

Run both the web frontend and backend server concurrently:

```bash
npm run dev
```

This will start:

- **Web Frontend**: http://localhost:3001
- **Backend Server**: http://localhost:8080

**Expected output:**

```
[web] webpack 5.89.0 compiled successfully
[server] 🚀 IinPublic server running on port 8080
```

### Option B: Run Web Frontend Only

If you only want to run the web interface without the backend:

```bash
npm run dev:web
```

**Expected output:**

```
<i> [webpack-dev-server] Project is running at:
<i> [webpack-dev-server] Loopback: http://localhost:3001/
```

### Option C: Run Backend Server Only

If you only want to run the backend server:

```bash
npm run dev:server
```

**Expected output:**

```
🚀 IinPublic server running on port 8080
```

## Step 4: Open the Application

1. **Open your web browser**
2. **Navigate to:** http://localhost:3001
3. **Allow location access** when prompted (required for location-based features)

### What You'll See

When the app loads successfully, you should see:

```
🚀 Initializing IinPublic Web App
📍 Location obtained: 37.774, -122.419
✅ IinPublic Web App initialized successfully
```

The app will display a loading spinner while connecting to the IinPublic network.

## Step 5: Verify Everything is Working

### Check the Web Frontend

1. Open http://localhost:3001 in your browser
2. Open Developer Console (F12 or Ctrl+Shift+I)
3. Look for initialization messages (no red errors)

### Check the Backend Server

1. Open http://localhost:8080/health in your browser
2. You should see: `{"status":"ok","timestamp":"2024-..."}`

### Check Location Services

The app uses your browser's Geolocation API. If location is blocked:

1. Click the location icon in your browser's address bar
2. Change permission to "Allow"
3. Refresh the page

## Common Issues & Solutions

### Issue: Port Already in Use

**Error:** `Error: listen EADDRINUSE: address already in use :::3001`

**Solution:**

```bash
# Find and kill the process using the port
# On Linux/Mac:
lsof -ti:3001 | xargs kill -9

# On Windows (PowerShell):
Get-Process -Id (Get-NetTCPConnection -LocalPort 3001).OwningProcess | Stop-Process

# Then try running again
npm run dev
```

### Issue: Location Access Denied

**Error:** `Failed to initialize app: Location error`

**Solution:**

1. Click the lock/location icon in your browser's address bar
2. Set Location permission to "Allow"
3. Refresh the page
4. Alternatively, use mock location (enabled in test mode)

### Issue: Dependencies Not Installed

**Error:** `Error: Cannot find module 'express'`

**Solution:**

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

### Issue: TypeScript Compilation Errors

**Error:** `error TS2307: Cannot find module...`

**Solution:**

```bash
# Rebuild TypeScript
npm run build:server
npm run build:web
```

### Issue: Webpack Build Fails

**Error:** `Module not found` or `Can't resolve...`

**Solution:**

```bash
# Clear webpack cache and rebuild
rm -rf dist/
npm run build:web
```

## Development Workflow

### Hot Reload

When running `npm run dev`, the app automatically reloads when you change files:

- **TypeScript files**: Auto-recompile and restart server
- **Web files**: Auto-refresh browser
- **No manual restart needed!**

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (auto-rerun on changes)
npm run test:watch

# Run with coverage report
npm run test:coverage
```

**Expected test output:**

```
PASS src/test/unit/reputation.test.ts
PASS src/test/unit/location.test.ts
PASS src/test/unit/talk-engine.test.ts
PASS src/test/integration/services.test.ts

Test Suites: 4 passed, 4 total
Tests:       1 skipped, 41 passed, 42 total
Time:        2.338 s
```

### Code Quality

```bash
# Check TypeScript types
npm run test:type

# Lint code
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format code with Prettier
npm run format
```

## Production Build

To create production-optimized builds:

```bash
# Build everything
npm run build

# Or build individually
npm run build:web      # Web frontend
npm run build:server   # Backend server
```

Build output:

- **Web**: `dist/web/`
- **Server**: `dist/server/`

## Stopping the Application

### If running in foreground:

- Press `Ctrl+C` in the terminal

### If running in background:

```bash
# Find the process
ps aux | grep node

# Kill it
kill <process-id>
```

## Architecture Overview

```
┌─────────────────────────────────────┐
│   Browser (localhost:3001)          │
│   - Web Frontend (TypeScript)       │
│   - Location Services               │
│   - Gun.js Client                   │
└────────────┬────────────────────────┘
             │ HTTP/WebSocket
             │
┌────────────▼────────────────────────┐
│   Server (localhost:8080)           │
│   - REST API (Express)              │
│   - Socket.io (Real-time)           │
│   - Gun.js Relay                    │
│   - Services Layer                  │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│   Gun.js Decentralized Database     │
│   - User Data                       │
│   - Chatrooms                       │
│   - Talks & Conversations           │
└─────────────────────────────────────┘
```

## Available Endpoints

Once running, these endpoints are available:

### Backend API (localhost:8080)

- `GET /health` - Health check
- `POST /api/users` - Create user
- `GET /api/users/:id` - Get user
- `POST /api/talks` - Create talk
- `GET /api/talks/:id` - Get talk
- `POST /api/chatrooms` - Create/join chatroom
- `GET /api/chatrooms/:id` - Get chatroom

### Web Frontend (localhost:3001)

- `/` - Main application
- Opens to location-based chatroom interface

## Next Steps

After successfully running the app:

1. **Explore the UI** - Navigate through chatrooms and talks
2. **Check the docs** - See `docs/` folder for detailed documentation
3. **Review the code** - Core logic is in `src/shared/` and `src/web/`
4. **Run tests** - Verify everything works with `npm test`
5. **Read the migration guide** - See `TYPESCRIPT_MIGRATION.md` for architecture details

## Getting Help

- **Check the logs** in your terminal for error messages
- **Open browser console** (F12) to see frontend errors
- **Review documentation** in the `docs/` folder
- **Run tests** to verify system integrity: `npm test`
- **Check test setup** in `src/test/setup.ts` for mock configurations

## Quick Reference

```bash
# Development
npm run dev                # Run everything
npm run dev:web           # Web only (port 3001)
npm run dev:server        # Server only (port 8080)

# Testing
npm test                  # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage

# Building
npm run build             # Build everything
npm run build:web         # Build web
npm run build:server      # Build server

# Code Quality
npm run lint              # Check linting
npm run lint:fix          # Fix linting
npm run format            # Format code
npm run test:type         # Type checking
```

## Troubleshooting Checklist

- [ ] Node.js version is 18.0.0 or higher
- [ ] All dependencies installed (`npm install` completed)
- [ ] Ports 3001 and 8080 are not in use
- [ ] Location permissions granted in browser
- [ ] No TypeScript compilation errors
- [ ] Tests pass (`npm test`)

---

**Happy coding! 🚀**

For more information, see:

- Main README: [README.md](./README.md)
- TypeScript Migration: [TYPESCRIPT_MIGRATION.md](./TYPESCRIPT_MIGRATION.md)
- Project Status: [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md)

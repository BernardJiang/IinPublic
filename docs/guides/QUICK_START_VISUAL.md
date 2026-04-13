# Quick Start Visual Guide

## Running IinPublic in 3 Steps

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Install Dependencies                               │
│  ─────────────────────────────────────────────────────────  │
│  $ npm install                                              │
│  ✓ Installs 710 packages (~2 minutes)                      │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Start the Application                              │
│  ─────────────────────────────────────────────────────────  │
│  $ npm run dev                                              │
│  ✓ Starts web frontend (port 3001)                         │
│  ✓ Starts backend server (port 8080)                       │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: Open Browser                                       │
│  ─────────────────────────────────────────────────────────  │
│  🌐 http://localhost:3001                                   │
│  ✓ Allow location permissions                              │
│  ✓ App initializes and connects                            │
└─────────────────────────────────────────────────────────────┘
```

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR BROWSER                            │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  http://localhost:3001                                │ │
│  │                                                       │ │
│  │  [IinPublic Web UI]                                  │ │
│  │  • Location-based chatrooms                          │ │
│  │  • Interactive talks (Q&A)                           │ │
│  │  • User profiles & reputation                        │ │
│  │  • Real-time messaging                               │ │
│  └───────────────┬───────────────────────────────────────┘ │
└──────────────────┼─────────────────────────────────────────┘
                   │ HTTP + WebSocket
                   │
┌──────────────────▼─────────────────────────────────────────┐
│              BACKEND SERVER                                 │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  http://localhost:8080                                │ │
│  │                                                       │ │
│  │  [Express.js + Socket.io]                            │ │
│  │  • REST API endpoints                                │ │
│  │  • Real-time WebSocket connections                   │ │
│  │  • Gun.js relay server                               │ │
│  │  • Business logic services                           │ │
│  └───────────────┬───────────────────────────────────────┘ │
└──────────────────┼─────────────────────────────────────────┘
                   │
                   │ Gun.js Protocol
                   │
┌──────────────────▼─────────────────────────────────────────┐
│           GUN.JS DECENTRALIZED DATABASE                     │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  Peer-to-Peer Data Storage                           │ │
│  │                                                       │ │
│  │  • Users & Profiles                                  │ │
│  │  • Chatrooms & Messages                              │ │
│  │  • Talks & Conversations                             │ │
│  │  • Reputation Data                                   │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## What Happens When You Run `npm run dev`

```
Terminal Output:                          What's Happening:
───────────────────────────────────────────────────────────────
$ npm run dev                             ▶ Starting both services

[web] webpack 5.89.0 compiling...        ▶ Webpack builds frontend
[web] Compiled successfully in 2.3s      ✓ TypeScript → JavaScript
[web] Project is running at:             ✓ CSS loaded
[web] http://localhost:3001/             ✓ Dev server ready

[server] Compiling TypeScript...         ▶ Building backend
[server] 🚀 IinPublic server             ✓ Services initialized
[server] running on port 8080            ✓ API endpoints ready
[server] ✅ All services initialized     ✓ Socket.io connected

Both servers running!                     🎉 Ready to use!
Press Ctrl+C to stop                      📱 Open http://localhost:3001
```

## Browser Experience

```
┌─────────────────────────────────────────────────────────────┐
│  🌐 http://localhost:3001                          [x] [ ]  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│      🔄  Connecting to IinPublic network...                 │
│                                                              │
│      Location Access Required                               │
│      [Allow]  [Block]                      ← Click Allow    │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  Console (F12):                                             │
│  🚀 Initializing IinPublic Web App                         │
│  📍 Location obtained: 37.774, -122.419                    │
│  ✅ IinPublic Web App initialized successfully             │
└─────────────────────────────────────────────────────────────┘
```

## Available While Running

### Web Frontend (localhost:3001)

- Main application interface
- Real-time chatrooms
- Interactive talk system
- User profiles

### Backend API (localhost:8080)

- `GET /health` - Health check
- `POST /api/users` - Create user
- `GET /api/users/:id` - Get user details
- `POST /api/talks` - Create new talk
- `GET /api/talks/:id` - Get talk details
- `POST /api/chatrooms` - Join chatroom

### Development Features

- **Hot Reload**: Changes auto-refresh
- **Source Maps**: Debug TypeScript directly
- **Error Overlay**: See errors in browser
- **Console Logging**: Detailed debug info

## Testing While Running

```bash
# In a new terminal (keep app running):
$ npm test

PASS src/test/unit/reputation.test.ts
PASS src/test/unit/location.test.ts
PASS src/test/unit/talk-engine.test.ts
PASS src/test/integration/services.test.ts

Test Suites: 4 passed, 4 total
Tests:       41 passed, 1 skipped, 42 total
Time:        2.338 s
```

## Common Commands While Running

```bash
# Check if services are running
curl http://localhost:8080/health
# Should return: {"status":"ok","timestamp":"..."}

# Check web server
curl http://localhost:3001
# Should return: HTML content

# View real-time logs
# Just watch your terminal - logs appear automatically!

# Stop the application
# Press Ctrl+C in the terminal
```

## Quick Troubleshooting

| Problem                  | Solution                                        |
| ------------------------ | ----------------------------------------------- |
| Port 3001 already in use | `lsof -ti:3001 \| xargs kill -9`                |
| Port 8080 already in use | `lsof -ti:8080 \| xargs kill -9`                |
| Location not working     | Click lock icon in address bar → Allow location |
| Blank page               | Check console (F12) for errors                  |
| Changes not appearing    | Hard refresh: Ctrl+Shift+R                      |
| Module not found         | Run `npm install` again                         |

## Next Steps

1. ✅ App is running
2. 📖 Read [HOW_TO_RUN.md](./HOW_TO_RUN.md) for details
3. 🧪 Run tests: `npm test`
4. 📚 Explore docs: `docs/` folder
5. 💻 Start coding!

---

**Need help?** See [HOW_TO_RUN.md](./HOW_TO_RUN.md) for detailed troubleshooting.

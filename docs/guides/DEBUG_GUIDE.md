# Gun.js Peer Sync Debugging Guide

## Current Status

- ✅ Backend server running on port 8080 with Gun.js enabled
- ✅ Web app running on port 3001 with webpack dev server
- ✅ Gun.js configured on both client and server with `axe: false`
- ✅ Chatroom service using proper Gun.js graph structure
- ✅ User discovery UI implemented
- ❓ Need to verify actual peer connections in browser

## Quick Test Steps

### Step 1: Test Gun.js Connection Directly

1. Open http://localhost:8080/gun-test.html in your browser
2. Click "Join Chatroom as TestUser"
3. Watch the console for:
   - ✅ "Connected to peer: http://localhost:8080/gun"
   - ✅ "Write successful"
   - ✅ "Active members: TestUser-[id]"

### Step 2: Test Multi-Browser Sync

1. Open gun-test.html in **two different browser tabs/windows**
2. In **Tab 1**: Click "Join Chatroom as TestUser"
3. In **Tab 2**: Click "Join Chatroom as TestUser"
4. Both tabs should show **2 active members**
5. If this works, Gun.js server sync is working! 🎉

### Step 3: Test Main Application

1. Open http://localhost:3001 in **Chrome** (call yourself "a2")
2. Open http://localhost:3001 in **Firefox** (call yourself "b3")
3. Open browser console (F12) in both
4. Look for these logs in order:

#### Expected Console Logs:

```
🔗 Gun.js web service initialized with peers: ["http://localhost:8080/gun"]
🤝 Gun.js peer connected: [some-id]
📊 Gun.js mesh status: [should show peer]
👥 Joining chatroom: [location] as user: [your-id]
📝 User data: {joinedAt, isActive, lastSeen, userId}
✅ Successfully joined chatroom: [location]
👂 Subscribing to chatroom members: [location]
📡 Received chatroom data update: [object with users]
  - User [user-id]: [user data]
👥 Active members in chatroom: [array of user IDs]
```

### Step 4: Diagnose Issues

#### If gun-test.html shows "Active members: 0"

- Gun.js server connection failed
- Check: `curl http://localhost:8080/gun` should return Gun.js response
- Check server logs: `tail -f /tmp/server.log | grep -i gun`

#### If gun-test.html works but main app doesn't

- Check for JavaScript errors in console
- Verify chatroom IDs match (they're based on location)
- Check localStorage: Application → Local Storage → localhost:3001
  - Should see Gun.js data with 'chatrooms' key

#### If you see "Connected to peer" but no members

- Data is being written to localStorage only, not syncing
- Check Network tab for WebSocket connection to ws://localhost:8080/gun
- If no WebSocket, Gun.js HTTP long-polling fallback should work

#### If both users in different chatrooms

- This is expected! Chatroom is based on location
- Solution: Both users need same GPS coordinates
- Temporary fix: Hardcode same location in app.ts for testing

## Common Issues

### Issue: "Cannot see each other"

**Cause**: Users assigned to different chatrooms based on location
**Fix**: Check `this.currentChatroomId` in both browsers' console:

```javascript
// In browser console:
window.app.chatroomService.getCurrentChatroomId();
```

If different, that's your problem!

### Issue: "No WebSocket connection"

**Cause**: Gun.js falls back to HTTP long-polling (still works, just slower)
**Fix**: Not actually a problem, data should still sync

### Issue: "Active members: []"

**Cause**: Gun.js subscription not receiving data
**Fix**: Check if `joinChatroom()` was called successfully

```javascript
// Manually test in console:
const gun = Gun({ peers: ['http://localhost:8080/gun'] });
gun.get('chatrooms').get('test').get('users').get('user1').put({
  isActive: true,
  joinedAt: new Date().toISOString(),
});

// In another tab:
gun
  .get('chatrooms')
  .get('test')
  .get('users')
  .on((data) => {
    console.log('Users:', data);
  });
```

## Manual Testing Commands

### Test Server is Serving Gun.js

```bash
curl http://localhost:8080/gun
# Should return: Gun.js HTTP endpoint response
```

### Check Active Connections

```bash
# Server logs
tail -f /tmp/server.log | grep -E "(peer|Gun)"

# Web logs
tail -f /tmp/web.log | grep -E "(Compiled|ERROR)"
```

### Clear All Gun.js Data (Fresh Start)

In browser console:

```javascript
localStorage.clear();
location.reload();
```

### Manually Write Test Data

In browser console:

```javascript
const gun = Gun({ peers: ['http://localhost:8080/gun'] });
gun.get('chatrooms').get('test-room').get('users').get('test-user-123').put({
  userId: 'test-user-123',
  isActive: true,
  joinedAt: new Date().toISOString(),
  lastSeen: new Date().toISOString(),
});
```

### Manually Read Test Data

In browser console:

```javascript
const gun = Gun({ peers: ['http://localhost:8080/gun'] });
gun
  .get('chatrooms')
  .get('test-room')
  .get('users')
  .on((users) => {
    console.log('All users:', users);
    for (let userId in users) {
      if (!userId.startsWith('_')) {
        console.log(`User ${userId}:`, users[userId]);
      }
    }
  });
```

## What to Report Back

Please test and report:

1. ✅/❌ gun-test.html shows peer connection
2. ✅/❌ gun-test.html shows active members across tabs
3. ✅/❌ Main app shows peer connection in console
4. ✅/❌ Main app shows "Joined chatroom" in console
5. ✅/❌ Main app shows "Received chatroom data update" in console
6. ✅/❌ Main app displays user list in UI
7. 📝 Chatroom ID from Chrome: **\_\_\_**
8. 📝 Chatroom ID from Firefox: **\_\_\_**
9. 📝 Any JavaScript errors: **\_\_\_**

## Next Steps Based on Results

### If gun-test.html works ✅

→ Issue is in main application logic

### If gun-test.html fails ❌

→ Issue is in Gun.js server/network configuration

### If chatroom IDs are different

→ Need to standardize location or add manual chatroom selection

### If everything logs correctly but UI doesn't update

→ Issue is in UI rendering logic

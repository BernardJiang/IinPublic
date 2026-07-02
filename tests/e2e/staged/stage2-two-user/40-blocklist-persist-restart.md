# Blocklist Persists After Browser Restart

Bootstrap two users (Alice, Bobby). Alice blocks Bobby via UI or API.
Close Alice's browser context and create a new one reusing her IndexedDB/localStorage.
After reload, verify Bobby still appears as blocked in Alice's Contacts UI
and the blockedUserIds are still persisted in her private data.

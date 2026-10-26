import { settingsStorage } from '../services/core-storage';
export type ChatroomBrowseMode = 'list' | 'map';

const CHATROOM_BROWSE_MODE_KEY = 'iinpublic_chatroom_browse_mode';

/**
 * Rooms open on the map; the user's last list/map choice is remembered on this device. E2E web
 * builds (`DISABLE_HMR=true`) keep the list, which most room-navigation specs click through.
 */
export function initialChatroomBrowseMode(): ChatroomBrowseMode {
  try {
    const saved = settingsStorage.getItem(CHATROOM_BROWSE_MODE_KEY);
    if (saved === 'list' || saved === 'map') return saved;
  } catch { /* storage unavailable */ }
  return process.env.DISABLE_HMR === 'true' ? 'list' : 'map';
}

export function saveChatroomBrowseMode(mode: ChatroomBrowseMode): void {
  try { settingsStorage.setItem(CHATROOM_BROWSE_MODE_KEY, mode); } catch { /* storage unavailable */ }
}

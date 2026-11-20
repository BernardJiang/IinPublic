export type ChatroomBrowseMode = 'list' | 'map';

/**
 * The app always opens on the map (owner, 2026-11-19); switching to the list lasts for this visit
 * only. E2E web builds (`DISABLE_HMR=true`) keep the list, which most room-navigation specs click
 * through.
 */
export function initialChatroomBrowseMode(): ChatroomBrowseMode {
  return process.env.DISABLE_HMR === 'true' ? 'list' : 'map';
}

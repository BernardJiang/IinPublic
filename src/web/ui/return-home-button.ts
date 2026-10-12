export type ReturnHomeButtonDeps = {
  getHomeChatroomId: () => string;
  currentChatroom: string;
  resolveChatroomTitle: (chatroomId: string) => string;
  /** Visiting another group of the same Nearby area: 🏠 returns to the default group. */
  awayFromDefaultGroup?: boolean;
};

export function syncReturnHomeButton(deps: ReturnHomeButtonDeps): void {
  const btn = document.getElementById('return-home-btn') as HTMLButtonElement | null;
  if (!btn) return;
  const home = deps.getHomeChatroomId();
  let effectiveRoom = deps.currentChatroom;
  if (!effectiveRoom) {
    const fromApp = (
      window as unknown as {
        __iinpublic_app?: { getApp: () => { chatroomService?: { getCurrentChatroomId: () => string } } };
      }
    ).__iinpublic_app?.getApp?.()?.chatroomService?.getCurrentChatroomId?.();
    if (fromApp) effectiveRoom = fromApp;
  }
  effectiveRoom = effectiveRoom || 'global';
  const away = effectiveRoom !== home;
  btn.disabled = !away && !deps.awayFromDefaultGroup;
  btn.title = away
    ? `Return to ${deps.resolveChatroomTitle(home)}`
    : deps.awayFromDefaultGroup ? 'Return to your own group' : 'Already in your home room';
}

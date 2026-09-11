export type ReturnHomeButtonDeps = {
  getHomeChatroomId: () => string;
  currentChatroom: string;
  resolveChatroomTitle: (chatroomId: string) => string;
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
  btn.disabled = !away;
  btn.title = away ? `Return to ${deps.resolveChatroomTitle(home)}` : 'Already in your home room';
}

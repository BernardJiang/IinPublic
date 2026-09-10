/** P0 step 7: server talk delivery removed. Always route via mesh (sendDirectTalkToPeer). */
export async function registerTalkForPeer(talkId: string, talkData: any, peerId: string, peerName: string): Promise<void> {
  const app = (
    window as unknown as {
      __iinpublic_app?: {
        getApp: () => {
          sendDirectTalkToPeer?: (
            talkId: string,
            talkData: unknown,
            peerId: string,
            peerName: string,
          ) => Promise<void>;
        };
      };
    }
  ).__iinpublic_app?.getApp?.();
  if (app?.sendDirectTalkToPeer) {
    await app.sendDirectTalkToPeer(talkId, talkData, peerId, peerName);
    return;
  }
  // No mesh connection available — no-op (star path removed).
  console.warn('registerTalkForPeer: sendDirectTalkToPeer unavailable, skipping delivery to', peerId);
}

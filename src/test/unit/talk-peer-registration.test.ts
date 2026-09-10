/** @jest-environment jsdom */

import { registerTalkForPeer } from '../../web/ui/talk-peer-registration';

function setIinpublicApp(getApp: () => { sendDirectTalkToPeer?: (...args: any[]) => Promise<void> } | undefined): void {
  (window as unknown as { __iinpublic_app?: unknown }).__iinpublic_app = { getApp };
}

beforeEach(() => {
  delete (window as unknown as { __iinpublic_app?: unknown }).__iinpublic_app;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('registerTalkForPeer', () => {
  it('routes through app.sendDirectTalkToPeer when the mesh app is available', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    setIinpublicApp(() => ({ sendDirectTalkToPeer: send }));
    await registerTalkForPeer('t1', { title: 'Talk' }, 'peer1', 'Peer One');
    expect(send).toHaveBeenCalledWith('t1', { title: 'Talk' }, 'peer1', 'Peer One');
  });

  it('warns and no-ops when __iinpublic_app is not present at all', async () => {
    await expect(registerTalkForPeer('t1', {}, 'peer1', 'Peer One')).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      'registerTalkForPeer: sendDirectTalkToPeer unavailable, skipping delivery to',
      'peer1',
    );
  });

  it('warns and no-ops when getApp() returns an object without sendDirectTalkToPeer', async () => {
    setIinpublicApp(() => ({}));
    await expect(registerTalkForPeer('t1', {}, 'peer1', 'Peer One')).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it('warns and no-ops when getApp() itself returns undefined', async () => {
    setIinpublicApp(() => undefined);
    await expect(registerTalkForPeer('t1', {}, 'peer1', 'Peer One')).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it('propagates a rejection from sendDirectTalkToPeer rather than swallowing it', async () => {
    setIinpublicApp(() => ({ sendDirectTalkToPeer: jest.fn().mockRejectedValue(new Error('boom')) }));
    await expect(registerTalkForPeer('t1', {}, 'peer1', 'Peer One')).rejects.toThrow('boom');
  });
});

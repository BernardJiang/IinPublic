/** @jest-environment jsdom */
import { HostLifecycleHandlers } from '../../web/app/host-lifecycle-handlers';

describe('HostLifecycleHandlers', () => {
  it('registers native resume, visibility and unload boundaries', () => {
    const win = { addEventListener: jest.fn() } as unknown as Window;
    const doc = { addEventListener: jest.fn(), hidden: false } as unknown as Document;
    new HostLifecycleHandlers({
      hasSession: () => true,
      recoverForeground: jest.fn(),
      enterBackground: jest.fn(),
      beforeUnload: jest.fn(),
      window: win,
      document: doc,
    }).register();
    expect(win.addEventListener).toHaveBeenCalledWith('iinpublic-native-resume', expect.any(Function));
    expect(win.addEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(doc.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});

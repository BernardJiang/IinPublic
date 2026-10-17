/**
 * Android's embedded Node (v18.20.4) differs from the host Node that runs Jest: it has no global
 * WebCrypto and no ICU, so String.prototype.normalize('NFKC') returns its input. The portable unit
 * files found both on four phones (2026-10-17, native-app/34). These tests recreate each gap on the
 * host; they fail without the fixes in wifi-direct-link.ts and reputation.ts.
 */
import { ContentFilter } from '../../shared/reputation';
import { DEFAULT_DIRTY_WORDS } from '../../shared/talk-intake-filters';
import { sha256Hex } from '../../shared/wifi-direct-link';
import { portableSha256Hex } from '../../shared/portable-sha256';

describe('shared code on a runtime like Android embedded Node', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sha256Hex works without global WebCrypto and gives the same digest', async () => {
    const withWebCrypto = await sha256Hex('iinpublic-nearby:pub:room:42');
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    try {
      expect(typeof crypto).toBe('undefined');
      await expect(sha256Hex('iinpublic-nearby:pub:room:42')).resolves.toBe(withWebCrypto);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    }
    expect(withWebCrypto).toBe(portableSha256Hex('iinpublic-nearby:pub:room:42'));
  });

  it('the dirty-word filter folds fullwidth letters without ICU normalization', () => {
    jest.spyOn(String.prototype, 'normalize').mockImplementation(function (this: string) { return String(this); });
    expect('ｆｕｃｋ'.normalize('NFKC')).toBe('ｆｕｃｋ');
    expect(ContentFilter.findDirtyWord('ｆｕｃｋ', [...DEFAULT_DIRTY_WORDS])).toBe('fuck');
    expect(ContentFilter.findDirtyWord('ＦＵＣＫ　you', [...DEFAULT_DIRTY_WORDS])).toBe('fuck');
    expect(ContentFilter.findDirtyWord('ａ　ｒｉｐｅ　ｂａｎａｎａ', ['ＢＡＮＡＮＡ'])).toBe('banana');
  });
});

/**
 * @jest-environment jsdom
 *
 * TODO §I — URL-fragment same-device linking shortcut (spec §10.3). Pure logic: building
 * the shareable `#link=<code>` URL, parsing/validating it back out, and clearing it from
 * the visible URL without a navigation.
 */

import {
  buildLinkFragmentUrl,
  shareLinkCode,
  parseLinkFragment,
  parseLinkFragmentPayload,
  clearLinkFragmentFromUrl,
} from '../../web/services/identity-link-fragment';
import { createPairingPayload, encodePairingCode, type LinkCrypto } from '../../shared/identity-linking';

const crypto: LinkCrypto = {
  sign: async () => 'sig',
  verify: async () => true,
  hash: async () => 'hash',
  randomSecret: () => 'secret-value',
};

describe('buildLinkFragmentUrl', () => {
  it('appends #link=<code> to the current origin+pathname', () => {
    const url = buildLinkFragmentUrl('abc123');
    expect(url).toBe(`${window.location.origin}${window.location.pathname}#link=abc123`);
  });

  it('points a native build (loopback origin) at the public site instead', () => {
    (window as unknown as { iinpublicNative?: unknown }).iinpublicNative = { platform: 'android', version: '1.0.0' };
    try {
      expect(buildLinkFragmentUrl('abc123')).toBe('https://www.iinpublic.com/#link=abc123');
    } finally {
      delete (window as unknown as { iinpublicNative?: unknown }).iinpublicNative;
    }
  });

  it('URL-encodes characters the base64url code shouldn\'t contain but a caller might pass', () => {
    const url = buildLinkFragmentUrl('a b&c');
    expect(url).toContain('%20');
    expect(url).toContain('%26');
  });
});

describe('parseLinkFragment', () => {
  it('extracts the raw code from a #link= hash', () => {
    expect(parseLinkFragment('#link=abc123')).toBe('abc123');
  });

  it('returns null for a hash with a different prefix', () => {
    expect(parseLinkFragment('#other=abc123')).toBeNull();
  });

  it('returns null for an empty hash or an empty code', () => {
    expect(parseLinkFragment('')).toBeNull();
    expect(parseLinkFragment('#link=')).toBeNull();
  });

  it('URL-decodes the extracted code', () => {
    expect(parseLinkFragment('#link=a%20b')).toBe('a b');
  });
});

describe('parseLinkFragmentPayload', () => {
  it('returns the code and decoded payload for a structurally valid pairing code', () => {
    const payload = createPairingPayload('self-pub', crypto);
    const code = encodePairingCode(payload);
    const result = parseLinkFragmentPayload(`#link=${code}`);
    expect(result).not.toBeNull();
    expect(result?.code).toBe(code);
    expect(result?.payload.pub).toBe('self-pub');
  });

  it('returns null when the fragment has no link code at all', () => {
    expect(parseLinkFragmentPayload('#somethingElse')).toBeNull();
  });

  it('returns null for a #link= fragment carrying a malformed/garbage code', () => {
    // Confirms an unrelated or corrupted `#link=...` hash never triggers UI — see
    // app.ts's checkForPendingIdentityLinkFragment.
    expect(parseLinkFragmentPayload('#link=not-a-real-pairing-code')).toBeNull();
  });
});

describe('clearLinkFragmentFromUrl', () => {
  it('removes the hash without changing pathname/search', () => {
    window.history.pushState(null, '', '/app?x=1#link=abc123');
    expect(window.location.hash).toBe('#link=abc123');
    clearLinkFragmentFromUrl();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/app');
    expect(window.location.search).toBe('?x=1');
  });
});

describe('shareLinkCode', () => {
  const nav = navigator as Navigator & { share?: unknown };
  afterEach(() => {
    delete (nav as { share?: unknown }).share;
  });

  it('uses the OS share sheet with the link and the raw code when available', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(nav, 'share', { value: share, configurable: true });
    await expect(shareLinkCode('abc123', 'Open this:')).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: 'Open this:\nabc123', url: expect.stringContaining('#link=abc123') });
  });

  it('does not fall back to copying when the person dismisses the sheet', async () => {
    const abort = Object.assign(new Error('dismissed'), { name: 'AbortError' });
    Object.defineProperty(nav, 'share', { value: jest.fn().mockRejectedValue(abort), configurable: true });
    await expect(shareLinkCode('abc123', 'Open this:')).resolves.toBeNull();
  });

  it('copies the same text when no share sheet exists', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await expect(shareLinkCode('abc123', 'Open this:')).resolves.toBe('copied');
    expect(writeText.mock.calls[0][0]).toContain('abc123');
    expect(writeText.mock.calls[0][0]).toContain('#link=abc123');
  });
});

import { resolveTlsMode } from '../../server/tls-mode';

describe('HTTPS-only server transport', () => {
  it('uses direct HTTPS when a key and certificate exist', () => {
    expect(resolveTlsMode({}, { keyExists: true, certExists: true })).toBe('direct-https');
  });

  it('allows plaintext only behind a declared HTTPS proxy', () => {
    expect(resolveTlsMode(
      { IINPUBLIC_TLS_TERMINATED_BY_PROXY: '1' },
      { keyExists: false, certExists: false },
    )).toBe('https-proxy');
  });

  it('keeps explicit E2E transport isolated from the user-facing policy', () => {
    expect(resolveTlsMode(
      { E2E_GUN_MEMORY_ONLY: '1' },
      { keyExists: false, certExists: false },
    )).toBe('plaintext-test');
  });

  it('allows HTTP only when an embedded app node is also loopback-only', () => {
    expect(resolveTlsMode(
      {
        IINPUBLIC_EMBEDDED_NODE: '1',
        IINPUBLIC_LOOPBACK_ONLY: '1',
      },
      { keyExists: false, certExists: false },
    )).toBe('plaintext-loopback');

    expect(() => resolveTlsMode(
      { IINPUBLIC_EMBEDDED_NODE: '1' },
      { keyExists: false, certExists: false },
    )).toThrow('HTTPS is required');
    expect(() => resolveTlsMode(
      { IINPUBLIC_LOOPBACK_ONLY: '1' },
      { keyExists: false, certExists: false },
    )).toThrow('HTTPS is required');
  });

  it('refuses to start when no HTTPS mechanism is configured', () => {
    expect(() => resolveTlsMode({}, { keyExists: false, certExists: false })).toThrow(
      'HTTPS is required',
    );
  });
});

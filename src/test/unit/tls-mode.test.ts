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

  it('refuses to start when no HTTPS mechanism is configured', () => {
    expect(() => resolveTlsMode({}, { keyExists: false, certExists: false })).toThrow(
      'HTTPS is required',
    );
  });
});

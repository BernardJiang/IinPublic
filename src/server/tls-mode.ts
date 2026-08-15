export type TlsMode = 'direct-https' | 'https-proxy' | 'plaintext-test';

export function resolveTlsMode(
  env: NodeJS.ProcessEnv,
  files: { keyExists: boolean; certExists: boolean },
): TlsMode {
  const plaintextTest =
    env.TLS_DISABLE === '1' ||
    env.E2E_GUN_MEMORY_ONLY === '1' ||
    env.E2E_GUN_MEMORY_ONLY === 'true';
  if (plaintextTest) return 'plaintext-test';

  if (env.IINPUBLIC_TLS_TERMINATED_BY_PROXY === '1') return 'https-proxy';
  if (files.keyExists && files.certExists) return 'direct-https';

  throw new Error(
    'HTTPS is required. Provide TLS_KEY_PATH and TLS_CERT_PATH (or certs/dev-*.pem), ' +
      'or set IINPUBLIC_TLS_TERMINATED_BY_PROXY=1 behind an HTTPS-only reverse proxy.',
  );
}

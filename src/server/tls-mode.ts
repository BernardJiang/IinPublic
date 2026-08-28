export type TlsMode = 'direct-https' | 'https-proxy' | 'plaintext-loopback' | 'plaintext-test';

export function isLoopbackEmbeddedNode(env: NodeJS.ProcessEnv): boolean {
  return env.IINPUBLIC_EMBEDDED_NODE === '1' && env.IINPUBLIC_LOOPBACK_ONLY === '1';
}

export function isPlaintextHttpAllowed(env: NodeJS.ProcessEnv): boolean {
  return isLoopbackEmbeddedNode(env) ||
    env.TLS_DISABLE === '1' ||
    env.E2E_GUN_MEMORY_ONLY === '1' ||
    env.E2E_GUN_MEMORY_ONLY === 'true';
}

export function resolveTlsMode(
  env: NodeJS.ProcessEnv,
  files: { keyExists: boolean; certExists: boolean },
): TlsMode {
  if (isLoopbackEmbeddedNode(env)) return 'plaintext-loopback';

  const plaintextTest = isPlaintextHttpAllowed(env);
  if (plaintextTest) return 'plaintext-test';

  if (env.IINPUBLIC_TLS_TERMINATED_BY_PROXY === '1') return 'https-proxy';
  if (files.keyExists && files.certExists) return 'direct-https';

  throw new Error(
    'HTTPS is required. Provide TLS_KEY_PATH and TLS_CERT_PATH (or certs/dev-*.pem), ' +
      'or set IINPUBLIC_TLS_TERMINATED_BY_PROXY=1 behind an HTTPS-only reverse proxy.',
  );
}

/**
 * Embedded-node configuration (S3 cross-platform native clients).
 *
 * The native shells (Electron desktop; nodejs-mobile Android/iOS) bundle the
 * existing `src/server` code and run it as a *local Gun peer*. That local node:
 *   - persists application data on-device (radisk), satisfying the
 *     "Gun-on-device is the source of truth" invariant,
 *   - syncs discovery/signaling/presence/room-membership through a narrow
 *     upstream relay channel (the relay-only data classes — see
 *     `P2PNodeProtocolSpec.syncPolicy.relayOnlyDataClasses`),
 *   - serves the prebuilt web SPA (`dist/web`) so the WebView/renderer can
 *     reuse 100% of the browser UI by loading `http://127.0.0.1:<port>`.
 *
 * Because the renderer loads the UI from this local node, the web client's
 * `WebGunService.deriveGunHubUrl()` already resolves Gun to `127.0.0.1:<port>`
 * with no code change — the browser talks to the local node, and the local
 * node relays discovery to the hub.
 *
 * This module is intentionally dependency-free so it can be imported from both
 * the Node entry (`src/node-app/embedded-node.ts`) and unit tests.
 */

export type EmbeddedPlatform = 'windows' | 'ubuntu' | 'macos' | 'android' | 'ios' | 'unknown';
export type EmbeddedHubRelayMode = 'explicit-http' | 'gun-peer';

export interface EmbeddedNodeConfig {
  /** True when the server should boot in embedded local-node mode. */
  enabled: boolean;
  /** Which native shell is hosting this node (best-effort). */
  platform: EmbeddedPlatform;
  /** Local HTTP/Gun/Socket.IO port the UI connects to (127.0.0.1:<port>). */
  localPort: number;
  /**
   * Upstream hub Gun URL(s) this node dials for discovery only.
   * In explicit-http mode this remains the shell-facing configuration source,
   * but attachGun does not use it as a generic peer list.
   * Empty array means "offline / LAN-only" (no hub reachable).
   */
  hubGunPeers: string[];
  /** Base URL for the explicit relay-only HTTP channel, derived from /gun. */
  upstreamHubBaseUrl?: string;
  /** How embedded nodes communicate with the upstream hub. */
  hubRelayMode: EmbeddedHubRelayMode;
  /** Absolute path to the prebuilt web bundle (dist/web) to serve. */
  webRoot: string;
  /**
   * Absolute path to the on-device writable data dir (radisk + keystore).
   * On mobile this is the app sandbox; on desktop it is the per-user app dir.
   */
  dataDir: string;
  /** Restrict the local listener to loopback. Always true on shipped apps. */
  loopbackOnly: boolean;
}

export interface EmbeddedNodeEnv {
  /** Index signature so `process.env` (NodeJS.ProcessEnv) is assignable. */
  [key: string]: string | undefined;
  IINPUBLIC_EMBEDDED_NODE?: string;
  IINPUBLIC_PLATFORM?: string;
  IINPUBLIC_HUB_GUN_URL?: string;
  IINPUBLIC_EMBEDDED_HUB_MODE?: string;
  IINPUBLIC_LOCAL_PORT?: string;
  IINPUBLIC_WEB_ROOT?: string;
  IINPUBLIC_DATA_DIR?: string;
  IINPUBLIC_LOOPBACK_ONLY?: string;
  PORT?: string;
}

const DEFAULT_LOCAL_PORT = 8080;
/** Default public hub. Native shells override via IINPUBLIC_HUB_GUN_URL. */
const DEFAULT_HUB_GUN_URL = 'https://www.iinpublic.com/gun';
const DEFAULT_HUB_RELAY_MODE: EmbeddedHubRelayMode = 'explicit-http';

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function normalizePlatform(raw: string | undefined): EmbeddedPlatform {
  switch ((raw || '').trim().toLowerCase()) {
    case 'windows':
    case 'win':
    case 'win32':
      return 'windows';
    case 'ubuntu':
    case 'linux':
      return 'ubuntu';
    case 'macos':
    case 'mac':
    case 'darwin':
      return 'macos';
    case 'android':
      return 'android';
    case 'ios':
    case 'iphoneos':
      return 'ios';
    default:
      return 'unknown';
  }
}

/** Split a comma/space-separated peer list and drop blanks. */
export function parseHubPeers(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function normalizeEmbeddedHubRelayMode(raw: string | undefined): EmbeddedHubRelayMode {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'gun' || v === 'gun-peer' || v === 'legacy-gun-peer') return 'gun-peer';
  return DEFAULT_HUB_RELAY_MODE;
}

export function deriveUpstreamHubBaseUrl(hubGunUrl: string | undefined): string | undefined {
  const first = parseHubPeers(hubGunUrl)[0];
  if (!first) return undefined;
  const trimmed = first.replace(/\/+$/, '');
  return trimmed.endsWith('/gun') ? trimmed.slice(0, -4) : trimmed;
}

/**
 * Resolve embedded-node configuration from process env.
 *
 * `defaults` lets the native shell inject host-specific absolute paths
 * (web bundle, data dir) that env vars may not carry.
 */
export function resolveEmbeddedNodeConfig(
  env: EmbeddedNodeEnv = {},
  defaults: Partial<EmbeddedNodeConfig> = {},
): EmbeddedNodeConfig {
  const enabled = isTruthy(env.IINPUBLIC_EMBEDDED_NODE) || defaults.enabled === true;

  const portRaw = env.IINPUBLIC_LOCAL_PORT ?? env.PORT;
  const parsedPort = portRaw ? parseInt(portRaw, 10) : NaN;
  const localPort = Number.isFinite(parsedPort)
    ? parsedPort
    : defaults.localPort ?? DEFAULT_LOCAL_PORT;

  const hubFromEnv = parseHubPeers(env.IINPUBLIC_HUB_GUN_URL);
  const hubGunPeers =
    hubFromEnv.length > 0
      ? hubFromEnv
      : defaults.hubGunPeers ?? (enabled ? [DEFAULT_HUB_GUN_URL] : []);
  const hubRelayMode = normalizeEmbeddedHubRelayMode(
    env.IINPUBLIC_EMBEDDED_HUB_MODE ?? defaults.hubRelayMode,
  );
  const upstreamHubBaseUrl =
    defaults.upstreamHubBaseUrl ?? deriveUpstreamHubBaseUrl(hubGunPeers[0]);

  return {
    enabled,
    platform: normalizePlatform(env.IINPUBLIC_PLATFORM ?? defaults.platform),
    localPort,
    hubGunPeers,
    ...(upstreamHubBaseUrl ? { upstreamHubBaseUrl } : {}),
    hubRelayMode,
    webRoot: env.IINPUBLIC_WEB_ROOT ?? defaults.webRoot ?? 'dist/web',
    dataDir: env.IINPUBLIC_DATA_DIR ?? defaults.dataDir ?? 'radata',
    // Shipped native apps must never expose the local node beyond loopback.
    loopbackOnly:
      env.IINPUBLIC_LOOPBACK_ONLY !== undefined
        ? isTruthy(env.IINPUBLIC_LOOPBACK_ONLY)
        : defaults.loopbackOnly ?? true,
  };
}

export const EMBEDDED_NODE_DEFAULT_HUB = DEFAULT_HUB_GUN_URL;
export const EMBEDDED_NODE_DEFAULT_PORT = DEFAULT_LOCAL_PORT;

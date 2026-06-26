import {
  resolveEmbeddedNodeConfig,
  parseHubPeers,
  EMBEDDED_NODE_DEFAULT_HUB,
  EMBEDDED_NODE_DEFAULT_PORT,
} from '../../shared/embedded-node-config';

describe('embedded-node-config', () => {
  describe('parseHubPeers', () => {
    it('returns empty for undefined/blank', () => {
      expect(parseHubPeers(undefined)).toEqual([]);
      expect(parseHubPeers('   ')).toEqual([]);
    });

    it('splits on commas and whitespace and drops blanks', () => {
      expect(parseHubPeers('https://a/gun, https://b/gun')).toEqual([
        'https://a/gun',
        'https://b/gun',
      ]);
      expect(parseHubPeers('https://a/gun\nhttps://b/gun')).toEqual([
        'https://a/gun',
        'https://b/gun',
      ]);
    });
  });

  describe('resolveEmbeddedNodeConfig', () => {
    it('is disabled by default with no env', () => {
      const cfg = resolveEmbeddedNodeConfig({});
      expect(cfg.enabled).toBe(false);
      // disabled → no hub peers are assumed
      expect(cfg.hubGunPeers).toEqual([]);
      expect(cfg.localPort).toBe(EMBEDDED_NODE_DEFAULT_PORT);
    });

    it('enables via IINPUBLIC_EMBEDDED_NODE and defaults the hub', () => {
      const cfg = resolveEmbeddedNodeConfig({ IINPUBLIC_EMBEDDED_NODE: '1' });
      expect(cfg.enabled).toBe(true);
      expect(cfg.hubGunPeers).toEqual([EMBEDDED_NODE_DEFAULT_HUB]);
      expect(cfg.loopbackOnly).toBe(true);
    });

    it('enables via defaults arg even when env is empty', () => {
      const cfg = resolveEmbeddedNodeConfig({}, { enabled: true });
      expect(cfg.enabled).toBe(true);
    });

    it('honours explicit hub url(s) over the default', () => {
      const cfg = resolveEmbeddedNodeConfig({
        IINPUBLIC_EMBEDDED_NODE: 'true',
        IINPUBLIC_HUB_GUN_URL: 'https://hub.example/gun, https://hub2.example/gun',
      });
      expect(cfg.hubGunPeers).toEqual([
        'https://hub.example/gun',
        'https://hub2.example/gun',
      ]);
    });

    it('parses port from IINPUBLIC_LOCAL_PORT then PORT', () => {
      expect(resolveEmbeddedNodeConfig({ IINPUBLIC_LOCAL_PORT: '9099' }).localPort).toBe(9099);
      expect(resolveEmbeddedNodeConfig({ PORT: '7077' }).localPort).toBe(7077);
      expect(resolveEmbeddedNodeConfig({ IINPUBLIC_LOCAL_PORT: '9099', PORT: '7077' }).localPort).toBe(9099);
    });

    it('normalizes platform aliases', () => {
      expect(resolveEmbeddedNodeConfig({ IINPUBLIC_PLATFORM: 'win32' }).platform).toBe('windows');
      expect(resolveEmbeddedNodeConfig({ IINPUBLIC_PLATFORM: 'linux' }).platform).toBe('ubuntu');
      expect(resolveEmbeddedNodeConfig({ IINPUBLIC_PLATFORM: 'darwin' }).platform).toBe('macos');
      expect(resolveEmbeddedNodeConfig({ IINPUBLIC_PLATFORM: 'android' }).platform).toBe('android');
      expect(resolveEmbeddedNodeConfig({ IINPUBLIC_PLATFORM: 'ios' }).platform).toBe('ios');
      expect(resolveEmbeddedNodeConfig({ IINPUBLIC_PLATFORM: 'wat' }).platform).toBe('unknown');
    });

    it('allows the shell to inject host-specific absolute paths via defaults', () => {
      const cfg = resolveEmbeddedNodeConfig(
        { IINPUBLIC_EMBEDDED_NODE: '1' },
        { webRoot: '/app/dist/web', dataDir: '/data/iinpublic' },
      );
      expect(cfg.webRoot).toBe('/app/dist/web');
      expect(cfg.dataDir).toBe('/data/iinpublic');
    });

    it('lets IINPUBLIC_LOOPBACK_ONLY=0 open beyond loopback (LAN testing)', () => {
      const cfg = resolveEmbeddedNodeConfig({
        IINPUBLIC_EMBEDDED_NODE: '1',
        IINPUBLIC_LOOPBACK_ONLY: '0',
      });
      expect(cfg.loopbackOnly).toBe(false);
    });
  });
});

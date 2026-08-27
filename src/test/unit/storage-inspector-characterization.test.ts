/** @jest-environment jsdom */

import { refreshStorageInspector } from '../../web/ui/storage-inspector';
import { uiText, type UiTranslationKey } from '../../web/ui/ui-translations';

function text(key: UiTranslationKey): string {
  return uiText('en', key);
}

function options() {
  return {
    apiBase: 'https://relay.example',
    text,
    appState: {
      currentUserId: 'local-user',
      supportActive: true,
      allowedLanguages: 'English, Español',
      defaultTalkLanguage: 'English',
      roomVisitCounts: [
        { roomId: 'z-room', visitCount: 0, uniqueVisitorCount: 0 },
        { roomId: 'a-room', visitCount: 4, uniqueVisitorCount: 3 },
      ],
    },
  };
}

describe('storage inspector characterization', () => {
  const originalFetch = global.fetch;
  const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

  beforeEach(() => {
    document.body.innerHTML = '<div id="settings-storage-inspector-body"></div>';
    localStorage.clear();
    global.fetch = jest.fn();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { databases: jest.fn().mockResolvedValue([{ name: 'z-db' }, { name: 'a-db' }]) },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB);
    else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    jest.restoreAllMocks();
  });

  it('does no browser or network work when its settings panel is absent', async () => {
    document.body.innerHTML = '';

    await refreshStorageInspector(options());

    expect(global.fetch).not.toHaveBeenCalled();
    expect(indexedDB.databases).not.toHaveBeenCalled();
  });

  it('renders app, browser, relay, protocol, and ownership diagnostics safely', async () => {
    localStorage.setItem('beta', '12');
    localStorage.setItem('alpha', 'abc');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        mode: '<img src=x onerror=alert(1)>',
        flags: { starServerPersistence: 'durable', p2pNodeEnabled: true },
        pathClassifications: [
          {
            path: 'users/{userId}/profile',
            category: '<script>public</script>',
            purpose: 'unsafe fallback',
          },
        ],
        localNode: {
          status: 'running',
          sessionPairing: { trustModel: 'paired', bridgeUrl: 'http://localhost:8765' },
          permissionDisclosures: [{ label: 'Storage', required: true }],
          persistenceControls: [{ dataClass: 'messages', enabled: true }],
        },
        seaIdentityPolicy: {
          keyCustodyFormats: ['SEA'],
          publicKeys: ['pub'],
          forbiddenPrivateKeys: ['priv'],
        },
        seaStorageScan: { ok: true },
        conversationTransport: {
          activeMode: 'gun-local',
          availableModes: ['gun-local', 'relay'],
          messageBodyStorage: 'encrypted',
          receiptsStorage: 'local',
          fallback: 'star',
        },
        p2pNetworkProtocol: {
          version: 2,
          substrate: 'libp2p',
          peerDiscovery: { ttlSeconds: 60 },
          identity: { signature: 'SEA' },
          platforms: [{ platform: 'web', nodeAvailability: 'available' }],
          capabilities: ['direct-chat'],
        },
        neighborMemory: {
          controls: {
            enabled: true,
            localOnly: true,
            privateGraphPublishedByDefault: false,
            exportFormat: 'encrypted-json',
          },
          blockedPeerIds: ['blocked-peer'],
          bootstrapCandidates: [{ peerId: 'peer-1', transportType: 'webrtc' }],
          neighbors: [{ peerId: 'peer-2', endpointStatus: 'online' }],
          publicStarFallback: 'enabled',
        },
        dataOwnership: {
          policy: {
            deviceLocalDelete: { label: "Delete this device's local data", clears: ['identity'] },
            serverHeldDataRequest: { label: 'Request/delete server-held data' },
            migration: { target: 'local node' },
          },
          localDeletion: { deletedAt: '2026-08-25' },
          serverHeldRequests: [{ requestType: 'delete', status: 'queued' }],
          migrationPlan: { movedCount: 2, items: [{ path: 'talks', action: 'review' }] },
        },
        relayTtlPolicy: { message: { ttlSeconds: 3600 } },
        transportDiagnostics: [{ mode: 'direct', storedTelemetry: false }],
      }),
    });

    await refreshStorageInspector(options());

    expect(global.fetch).toHaveBeenCalledWith('https://relay.example/api/debug/storage', {
      cache: 'no-store',
    });
    expect(document.querySelector('#storage-inspector-app-state')?.textContent).toContain('English, Español');
    expect(document.querySelector('#storage-inspector-room-visits')?.textContent).toContain('a-room');
    expect(document.querySelector('#storage-inspector-room-visits')?.textContent).not.toContain('z-room');
    expect(document.querySelector('#storage-inspector-local')?.textContent).toContain('alpha3 B');
    expect(document.querySelector('#storage-inspector-indexeddb')?.textContent).toContain('a-db, z-db');
    expect(document.querySelector('#storage-inspector-local-node')).not.toBeNull();
    expect(document.querySelector('#storage-inspector-sea-identity')?.textContent).toContain('clean');
    expect(document.querySelector('#storage-inspector-conversation-transport')?.textContent).toContain('gun-local');
    expect(document.querySelector('#storage-inspector-p2p-protocol')?.textContent).toContain('libp2p');
    expect(document.querySelector('#storage-inspector-p2p-neighbor-memory')?.textContent).toContain('peer-2');
    expect(document.querySelector('#storage-inspector-data-ownership')?.textContent).toContain('3600s');
    expect(document.querySelector('#storage-inspector-server')?.textContent).toContain(
      text('storagePurposeProfile'),
    );
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('#settings-storage-inspector-body')?.textContent).toContain(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('escapes a relay failure and still renders local diagnostics', async () => {
    localStorage.setItem('offline-data', 'ok');
    (global.fetch as jest.Mock).mockRejectedValue(new Error('<img src=x onerror=alert(1)>'));

    await refreshStorageInspector(options());

    expect(document.querySelector('#storage-inspector-server-error')?.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
    expect(document.querySelector('#storage-inspector-local')?.textContent).toContain('offline-data');
    expect(document.querySelector('img')).toBeNull();
  });
});

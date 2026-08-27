import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

export interface StorageInspectorAppState {
  currentUserId?: string;
  supportActive: boolean;
  allowedLanguages: string;
  defaultTalkLanguage: string;
  roomVisitCounts: Array<{
    roomId: string;
    visitCount: number;
    uniqueVisitorCount: number;
  }>;
}

export interface StorageInspectorOptions {
  apiBase: string;
  text: (key: UiTranslationKey) => string;
  appState: StorageInspectorAppState;
}

interface BrowserStorageSnapshot {
  localStorageKeys: Array<{ key: string; bytes: number }>;
  indexedDBNames: string[];
}

async function getBrowserStorageSnapshot(): Promise<BrowserStorageSnapshot> {
  const localStorageKeys = Object.keys(localStorage)
    .sort()
    .map((key) => ({
      key,
      bytes: new Blob([localStorage.getItem(key) || '']).size,
    }));
  let indexedDBNames: string[] = [];
  try {
    const dbs = typeof indexedDB !== 'undefined' && 'databases' in indexedDB
      ? await (indexedDB as any).databases()
      : [];
    indexedDBNames = dbs.map((db: { name?: string }) => db.name || '(unnamed)').filter(Boolean).sort();
  } catch {
    indexedDBNames = ['unavailable'];
  }
  return { localStorageKeys, indexedDBNames };
}

function storageValue(value: string, text: StorageInspectorOptions['text']): string {
  const keys: Partial<Record<string, UiTranslationKey>> = {
    unknown: 'storageUnknown',
    durable: 'storageDurable',
    enabled: 'storageEnabled',
    disabled: 'storageDisabled',
    stopped: 'storageStopped',
    starting: 'storageStarting',
    running: 'storageRunning',
    unhealthy: 'storageUnhealthy',
    stopping: 'storageStopping',
    wiped: 'storageWiped',
    unconfigured: 'storageUnconfigured',
    'local-only': 'storageLocalOnly',
    'gun-local': 'storageLocalOnly',
    available: 'storageAvailable',
    active: 'storageActiveValue',
    required: 'storageRequired',
    optional: 'storageOptional',
    clean: 'storageClean',
    'needs review': 'storageNeedsReview',
    supported: 'storageSupported',
    local: 'storageLocal',
    off: 'storageOff',
    shared: 'storageShared',
    private: 'storagePrivate',
    published: 'storagePublished',
    clears: 'storageClears',
    'not run': 'storageNotRun',
    none: 'storageNone',
    queued: 'storageQueued',
    review: 'storageReview',
    'telemetry-free': 'storageTelemetryFree',
    'local-visible': 'storageLocalVisible',
    'star fallback': 'storageStarFallback',
  };
  const key = keys[value];
  return key ? text(key) : value;
}

function storagePathPurpose(path: string, purpose: string, text: StorageInspectorOptions['text']): string {
  const keys: Partial<Record<string, UiTranslationKey>> = {
    'users/{userId}/profile': 'storagePurposeProfile',
    'users/{userId}/publicProfile': 'storagePurposePublicProfile',
    'users/{userId}/reputation': 'storagePurposeReputation',
    'chatrooms/{chatroomId}': 'storagePurposeChatrooms',
    'talks/{talkId}': 'storagePurposeTalks',
    'incomingTalksByUser/{userId}': 'storagePurposeIncoming',
    'conversations/{conversationId}': 'storagePurposeConversations',
    'talkAnswerTemplateByUser/{userId}': 'storagePurposeTemplates',
    'exactChatbotMemoryByUser/{userId}': 'storagePurposeExactMemory',
    'stats/*': 'storagePurposeStats',
  };
  const key = keys[path];
  return key ? text(key) : purpose;
}

function storageDisclosureLabel(value: string, text: StorageInspectorOptions['text']): string {
  const keys: Partial<Record<string, UiTranslationKey>> = {
    Storage: 'storageDisclosureStorage',
    Bandwidth: 'storageDisclosureBandwidth',
    Battery: 'storageDisclosureBattery',
    'Background behavior': 'storageDisclosureBackground',
    'Local port': 'storageDisclosurePort',
    'Stop and delete': 'storageDisclosureStopDelete',
  };
  const key = keys[value];
  return key ? text(key) : value;
}

function storagePolicyLabel(value: string | undefined, text: StorageInspectorOptions['text']): string {
  if (value === "Delete this device's local data") return text('storageDeleteDeviceLocal');
  if (value === 'Request/delete server-held data') return text('storageRequestServerData');
  return value || text('storageAvailable');
}

function renderStoragePill(label: string, value: string): string {
  return `<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid var(--border-strong);border-radius:8px;background:var(--bg-subtle);color:var(--text-primary);"><span style="font-weight:600;">${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></span>`;
}

function renderAppStateInspector(options: StorageInspectorOptions): string {
  const { appState, text } = options;
  const currentUserIsRoot = appState.currentUserId === TECHSUPPORT_ROOT_USER_ID;
  const roomCounts = appState.roomVisitCounts
    .filter((counts) => counts.visitCount > 0 || counts.uniqueVisitorCount > 0)
    .sort((left, right) => left.roomId.localeCompare(right.roomId));
  return `
    <div id="storage-inspector-app-state" style="display:grid;gap:8px;padding:10px;border:1px solid var(--accent-border);border-radius:8px;background:var(--accent-soft);">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <div style="font-weight:700;color:var(--accent-text);">${text('storageAppState')}</div>
        ${renderStoragePill(text('storageTechSupportRoot'), currentUserIsRoot ? text('storageCurrentIdentity') : TECHSUPPORT_ROOT_USER_ID)}
        ${renderStoragePill(text('storageSupportChannel'), storageValue(appState.supportActive ? 'active' : 'not run', text))}
        ${renderStoragePill(text('storageIncomingLanguages'), appState.allowedLanguages || text('storageUnknown'))}
        ${renderStoragePill(text('storageDefaultTalkLanguage'), appState.defaultTalkLanguage)}
      </div>
      <div id="storage-inspector-room-visits" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${roomCounts.length === 0
          ? renderStoragePill(text('storageRoomVisits'), text('storageNone'))
          : roomCounts.map((counts) => renderStoragePill(
              `${text('storageRoomVisits')} · ${counts.roomId}`,
              `${counts.visitCount} / ${counts.uniqueVisitorCount}`,
            )).join('')}
      </div>
    </div>
  `;
}

function renderLocalNodeInspector(localNode: any, text: StorageInspectorOptions['text']): string {
  if (!localNode) return '';
  const disclosures = Array.isArray(localNode.permissionDisclosures) ? localNode.permissionDisclosures : [];
  const controls = Array.isArray(localNode.persistenceControls) ? localNode.persistenceControls : [];
  return `
    <div id="storage-inspector-local-node" style="display:grid;gap:8px;padding:10px;border:1px solid var(--accent-soft);border-radius:8px;background:var(--accent-soft);">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <div style="font-weight:700;color:var(--accent-text);">${text('storageLocalNodeSupervisor')}</div>
        ${renderStoragePill(text('storageStatus'), storageValue(localNode.status || 'unknown', text))}
        ${renderStoragePill(text('storagePairing'), localNode.sessionPairing?.trustModel || text('storageUnknown'))}
        ${renderStoragePill(text('storageBridge'), localNode.sessionPairing?.bridgeUrl || text('storageUnconfigured'))}
      </div>
      <div id="storage-inspector-local-node-disclosures" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${disclosures.map((item: any) => renderStoragePill(storageDisclosureLabel(item.label || item.key, text), storageValue(item.required ? 'required' : 'optional', text))).join('')}
      </div>
      <div id="storage-inspector-local-node-controls" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${controls.map((item: any) => renderStoragePill(item.dataClass, storageValue(item.enabled ? 'local' : 'off', text))).join('')}
      </div>
    </div>
  `;
}

function renderSeaIdentityInspector(policy: any, scan: any, text: StorageInspectorOptions['text']): string {
  if (!policy) return '';
  const custodyFormats = Array.isArray(policy.keyCustodyFormats) ? policy.keyCustodyFormats : [];
  const publicKeys = Array.isArray(policy.publicKeys) ? policy.publicKeys : [];
  const forbidden = Array.isArray(policy.forbiddenPrivateKeys) ? policy.forbiddenPrivateKeys : [];
  return `
    <div id="storage-inspector-sea-identity" style="display:grid;gap:8px;padding:10px;border:1px solid var(--success-soft);border-radius:8px;background:var(--success-soft);">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <div style="font-weight:700;color:var(--success-text);">${text('storageSeaCustody')}</div>
        ${renderStoragePill(text('storageRelayScan'), storageValue(scan?.ok ? 'clean' : 'needs review', text))}
        ${renderStoragePill(text('storagePublicKeys'), publicKeys.join(', ') || text('storageUnknown'))}
        ${renderStoragePill(text('storageForbidden'), forbidden.join(', ') || text('storageUnknown'))}
      </div>
      <div id="storage-inspector-sea-custody" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${custodyFormats.map((format: string) => renderStoragePill(format, text('storageSupported'))).join('')}
      </div>
      <div id="storage-inspector-sea-rules" style="color:var(--text-secondary);">${text('storageRelayRule')}</div>
    </div>
  `;
}

function renderConversationTransportInspector(transport: any, text: StorageInspectorOptions['text']): string {
  if (!transport) return '';
  const modes = Array.isArray(transport.availableModes) ? transport.availableModes : [];
  return `
    <div id="storage-inspector-conversation-transport" style="display:grid;gap:8px;padding:10px;border:1px solid var(--warning-border);border-radius:8px;background:var(--warning-soft);">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <div style="font-weight:700;color:var(--warning-text);">${text('storageConversationTransport')}</div>
        ${renderStoragePill(text('storageActive'), transport.activeMode || text('storageUnknown'))}
        ${renderStoragePill(text('storageMessages'), transport.messageBodyStorage || text('storageUnknown'))}
        ${renderStoragePill(text('storageReceipts'), transport.receiptsStorage || text('storageUnknown'))}
        ${transport.fallback ? renderStoragePill(text('storageFallback'), transport.fallback) : ''}
      </div>
      <div id="storage-inspector-conversation-transport-modes" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${modes.map((mode: string) => renderStoragePill(mode, storageValue(mode === transport.activeMode ? 'active' : 'available', text))).join('')}
      </div>
    </div>
  `;
}

function renderP2PNetworkProtocolInspector(protocol: any, text: StorageInspectorOptions['text']): string {
  if (!protocol) return '';
  const platforms = Array.isArray(protocol.platforms) ? protocol.platforms : [];
  const capabilities = Array.isArray(protocol.capabilities) ? protocol.capabilities : [];
  return `
    <div id="storage-inspector-p2p-protocol" style="display:grid;gap:8px;padding:10px;border:1px solid #e9d5ff;border-radius:8px;background:#faf5ff;">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <div style="font-weight:700;color:#581c87;">${text('storageProtocol')}</div>
        ${renderStoragePill(text('storageVersion'), String(protocol.version || text('storageUnknown')))}
        ${renderStoragePill(text('storageSubstrate'), protocol.substrate || text('storageUnknown'))}
        ${renderStoragePill(text('storageDiscoveryTtl'), `${protocol.peerDiscovery?.ttlSeconds ?? text('storageUnknown')}s`)}
        ${renderStoragePill(text('storageSignature'), protocol.identity?.signature || text('storageUnknown'))}
      </div>
      <div id="storage-inspector-p2p-platforms" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${platforms.map((item: any) => renderStoragePill(item.platform || 'platform', item.nodeAvailability || 'unknown')).join('')}
      </div>
      <div id="storage-inspector-p2p-capabilities" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${capabilities.map((capability: string) => renderStoragePill(capability, 'capability')).join('')}
      </div>
    </div>
  `;
}

function renderP2PNeighborMemoryInspector(memory: any, text: StorageInspectorOptions['text']): string {
  if (!memory) return '';
  const neighbors = Array.isArray(memory.neighbors) ? memory.neighbors : [];
  const candidates = Array.isArray(memory.bootstrapCandidates) ? memory.bootstrapCandidates : [];
  const blocked = Array.isArray(memory.blockedPeerIds) ? memory.blockedPeerIds : [];
  return `
    <div id="storage-inspector-p2p-neighbor-memory" style="display:grid;gap:8px;padding:10px;border:1px solid var(--success-border);border-radius:8px;background:var(--success-soft);">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <div style="font-weight:700;color:var(--success-text);">${text('storageNeighborMemory')}</div>
        ${renderStoragePill(text('storageStatus'), storageValue(memory.controls?.enabled ? 'enabled' : 'disabled', text))}
        ${renderStoragePill(text('storageScope'), storageValue(memory.controls?.localOnly ? 'local-only' : 'shared', text))}
        ${renderStoragePill(text('storageGraph'), storageValue(memory.controls?.privateGraphPublishedByDefault === false ? 'private' : 'published', text))}
        ${renderStoragePill(text('storageFallback'), memory.publicStarFallback || text('storageUnknown'))}
      </div>
      <div id="storage-inspector-p2p-neighbor-controls" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${renderStoragePill(text('storageClearNeighbors'), text('storageAvailable'))}
        ${renderStoragePill(text('storageDisableMemory'), storageValue(memory.controls?.enabled ? 'available' : 'active', text))}
        ${renderStoragePill(text('storageExportEncrypted'), memory.controls?.exportFormat || text('storageUnknown'))}
        ${renderStoragePill(text('storageBlockPeer'), blocked.length > 0 ? text('storageBlockedCount').replace('{count}', String(blocked.length)) : text('storageAvailable'))}
      </div>
      <div id="storage-inspector-p2p-neighbor-candidates" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${candidates.length === 0
          ? renderStoragePill(text('storageBootstrap'), text('storageStarFallback'))
          : candidates.map((item: any) => renderStoragePill(item.peerId || 'peer', item.transportType || 'candidate')).join('')}
      </div>
      <div id="storage-inspector-p2p-neighbor-records" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${neighbors.map((item: any) => renderStoragePill(item.peerId || 'peer', item.endpointStatus || 'unknown')).join('')}
      </div>
    </div>
  `;
}

function renderDataOwnershipInspector(dataOwnership: any, ttlPolicy: any, diagnostics: any, text: StorageInspectorOptions['text']): string {
  if (!dataOwnership) return '';
  const policy = dataOwnership.policy || {};
  const clears = Array.isArray(policy.deviceLocalDelete?.clears) ? policy.deviceLocalDelete.clears : [];
  const requests = Array.isArray(dataOwnership.serverHeldRequests) ? dataOwnership.serverHeldRequests : [];
  const migrationItems = Array.isArray(dataOwnership.migrationPlan?.items) ? dataOwnership.migrationPlan.items : [];
  const ttlEntries = ttlPolicy && typeof ttlPolicy === 'object' ? Object.entries(ttlPolicy) : [];
  const events = Array.isArray(diagnostics) ? diagnostics : [];
  return `
    <div id="storage-inspector-data-ownership" style="display:grid;gap:8px;padding:10px;border:1px solid var(--warning-border);border-radius:8px;background:var(--warning-soft);">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <div style="font-weight:700;color:var(--warning-text);">${text('storageDataOwnership')}</div>
        ${renderStoragePill(text('storageDeviceLocalDelete'), storagePolicyLabel(policy.deviceLocalDelete?.label, text))}
        ${renderStoragePill(text('storageServerHeldData'), storagePolicyLabel(policy.serverHeldDataRequest?.label, text))}
        ${renderStoragePill(text('storageMigrationTarget'), policy.migration?.target || text('storageUnknown'))}
      </div>
      <div id="storage-inspector-data-ownership-local" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${clears.map((item: string) => renderStoragePill(item, text('storageClears'))).join('')}
        ${renderStoragePill(text('storageLastLocalDelete'), dataOwnership.localDeletion?.deletedAt || text('storageNotRun'))}
      </div>
      <div id="storage-inspector-data-ownership-server" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${requests.length === 0
          ? renderStoragePill(text('storageServerRequests'), text('storageNone'))
          : requests.map((item: any) => renderStoragePill(item.requestType || 'request', storageValue(item.status || 'queued', text))).join('')}
      </div>
      <div id="storage-inspector-data-ownership-migration" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${renderStoragePill(text('storageMoveEligible'), `${dataOwnership.migrationPlan?.movedCount ?? 0}`)}
        ${migrationItems.slice(0, 4).map((item: any) => renderStoragePill(item.path || 'path', storageValue(item.action || 'review', text))).join('')}
      </div>
      <div id="storage-inspector-relay-ttl-policy" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${ttlEntries.map(([kind, item]: [string, any]) => renderStoragePill(kind, `${item.ttlSeconds ?? 'unknown'}s`)).join('')}
      </div>
      <div id="storage-inspector-transport-diagnostics" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${events.length === 0
          ? renderStoragePill(text('storageTransportDiagnostics'), text('storageTelemetryFree'))
          : events.map((item: any) => renderStoragePill(item.mode || 'mode', storageValue(item.storedTelemetry === false ? 'local-visible' : 'review', text))).join('')}
      </div>
    </div>
  `;
}

export async function refreshStorageInspector(options: StorageInspectorOptions): Promise<void> {
  const { apiBase, appState, text } = options;
  const body = document.getElementById('settings-storage-inspector-body');
  if (!body) return;
  const browserStorage = await getBrowserStorageSnapshot();
  let serverStorage: any = null;
  let serverError = '';
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/api/debug/storage`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      serverStorage = await res.json();
    } catch (error) {
      serverError = (error as Error).message;
    }
  }

  const flags = serverStorage?.flags || {};
  const transport = serverStorage?.conversationTransport || {};
  const serverRows = serverStorage?.pathClassifications || [];
  body.innerHTML = `
    <div style="display:grid;gap:12px;">
      <div id="storage-inspector-flags" style="display:flex;flex-wrap:wrap;gap:8px;">
        ${renderStoragePill(text('storageMode'), serverStorage?.mode || 'star')}
        ${renderStoragePill(text('storagePersistence'), storageValue(flags.starServerPersistence || 'unknown', text))}
        ${renderStoragePill(text('storageLocalNode'), storageValue(flags.p2pNodeEnabled ? 'enabled' : 'disabled', text))}
        ${renderStoragePill(text('storageDirectChat'), storageValue('enabled', text))}
      </div>
      <div id="storage-inspector-runtime-features" style="display:flex;flex-wrap:wrap;gap:8px;">
        ${renderStoragePill(text('storageTransportFallback'), transport.fallback || text('storageNone'))}
        ${renderStoragePill(text('storageSupportBootstrap'), storageValue(appState.supportActive ? 'active' : 'not run', text))}
      </div>
      ${renderAppStateInspector(options)}
      ${renderLocalNodeInspector(serverStorage?.localNode, text)}
      ${renderSeaIdentityInspector(serverStorage?.seaIdentityPolicy, serverStorage?.seaStorageScan, text)}
      ${renderConversationTransportInspector(serverStorage?.conversationTransport, text)}
      ${renderP2PNetworkProtocolInspector(serverStorage?.p2pNetworkProtocol, text)}
      ${renderP2PNeighborMemoryInspector(serverStorage?.neighborMemory, text)}
      ${renderDataOwnershipInspector(serverStorage?.dataOwnership, serverStorage?.relayTtlPolicy, serverStorage?.transportDiagnostics, text)}
      <div>
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px;">${text('storageBrowserLocal')}</div>
        <div id="storage-inspector-local" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${browserStorage.localStorageKeys.length === 0
            ? `<span style="color:var(--text-muted);">${text('storageNoLocalKeys')}</span>`
            : browserStorage.localStorageKeys.map((item) => renderStoragePill(item.key, `${item.bytes} B`)).join('')}
        </div>
        <div id="storage-inspector-indexeddb" style="margin-top:6px;color:var(--text-secondary);">
          ${text('storageIndexedDb')}: ${browserStorage.indexedDBNames.length > 0 ? browserStorage.indexedDBNames.map(escapeHtml).join(', ') : text('storageNone')}
        </div>
      </div>
      <div>
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px;">${text('storageServerPaths')}</div>
        ${serverError
          ? `<div id="storage-inspector-server-error" style="color:var(--warning-text);">${escapeHtml(serverError)}</div>`
          : `<div id="storage-inspector-server" style="display:grid;gap:6px;">
              ${serverRows.map((row: any) => `
                <div style="padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);">
                  <div style="font-weight:600;color:var(--text-primary);">${escapeHtml(row.path)} <span style="font-weight:500;color:var(--text-tertiary);">${escapeHtml(row.category)}</span></div>
                  <div style="color:var(--text-tertiary);">${escapeHtml(storagePathPurpose(row.path, row.purpose, text))}</div>
                </div>
              `).join('')}
            </div>`}
      </div>
    </div>
  `;
}

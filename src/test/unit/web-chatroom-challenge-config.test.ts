/**
 * Unit tests for Challenge Plugin Framework zone-B configuration storage (FR-CPF-04).
 * Tests the round-trip serialize/deserialize of plugin config from Gun zone-B path.
 */

import { WebChatroomService } from '../../web/services/web-chatroom-service';
import { registerChallengePlugin } from '../../shared/challenge-plugins';
import type { WebGunService } from '../../web/services/web-gun-service';

/**
 * Mock WebGunService for testing zone-B read/write without Gun.js
 */
class MockWebGunService implements Partial<WebGunService> {
  private zoneB: Map<string, any> = new Map();

  async putPrivate(key: string, data: any): Promise<void> {
    this.zoneB.set(key, JSON.parse(JSON.stringify(data)));
  }

  async getPrivate(key: string): Promise<any> {
    const data = this.zoneB.get(key);
    if (!data) return null;
    return JSON.parse(JSON.stringify(data));
  }

  getGun(): any {
    return null;
  }

  getStoredPair(): any {
    return { pub: 'test-pub' };
  }
}

describe('WebChatroomService — Challenge Plugin Configuration (FR-CPF-04)', () => {
  let service: WebChatroomService;
  let mockGunService: MockWebGunService;

  beforeEach(() => {
    mockGunService = new MockWebGunService();
    service = new WebChatroomService(mockGunService as any);
  });

  // ─── Zone-B serialize/deserialize round-trip ─────────────────────────────────

  it('stores plugin ids as JSON string in zone-B per Gun.js nested array limitation', async () => {
    const chatroomId = 'room-123';
    const pluginIds = ['require-verified-identity', 'require-trust-score'];

    await service.setChallengeConfig(chatroomId, pluginIds);

    // Verify the stored format: Gun cannot store nested arrays, so pluginIds are serialized
    const rawData = await mockGunService.getPrivate(`chatroom-config/${chatroomId}/challengePlugins`);
    expect(rawData).toBeDefined();
    expect(rawData.pluginIdsJson).toBe(JSON.stringify(pluginIds));
    expect(typeof rawData.pluginIdsJson).toBe('string');
  });

  it('round-trip: write and read back plugin config', async () => {
    const chatroomId = 'room-456';
    const pluginIds = ['require-verified-identity', 'require-invitation'];

    // Write
    await service.setChallengeConfig(chatroomId, pluginIds);

    // Read
    const config = await service.getChallengeConfig(chatroomId);

    // Verify
    expect(config).not.toBeNull();
    expect(config!.plugins).toHaveLength(pluginIds.length);
    expect(config!.plugins[0].id).toBe('require-verified-identity');
    expect(config!.plugins[1].id).toBe('require-invitation');
    expect(config!.semantics).toBe('all'); // Default semantics
  });

  it('returns null when no config exists', async () => {
    const config = await service.getChallengeConfig('nonexistent-room');
    expect(config).toBeNull();
  });

  it('returns null when pluginIdsJson is missing or invalid JSON', async () => {
    const chatroomId = 'room-bad-json';
    // Write invalid JSON manually
    await mockGunService.putPrivate(
      `chatroom-config/${chatroomId}/challengePlugins`,
      { pluginIdsJson: 'not-valid-json' }
    );

    const config = await service.getChallengeConfig(chatroomId);
    expect(config).toBeNull();
  });

  it('ignores unknown plugin ids during deserialization', async () => {
    const chatroomId = 'room-mixed';
    const pluginIds = ['require-verified-identity', 'nonexistent-plugin', 'require-trust-score'];

    await service.setChallengeConfig(chatroomId, pluginIds);
    const config = await service.getChallengeConfig(chatroomId);

    // Should only resolve valid plugins
    expect(config).not.toBeNull();
    expect(config!.plugins).toHaveLength(2); // only 2 valid plugins
    expect(config!.plugins.map((p) => p.id)).toEqual([
      'require-verified-identity',
      'require-trust-score',
    ]);
  });

  it('returns null when no valid plugins can be resolved from the list', async () => {
    const chatroomId = 'room-empty';
    const pluginIds = ['nonexistent-plugin-1', 'nonexistent-plugin-2'];

    await service.setChallengeConfig(chatroomId, pluginIds);
    const config = await service.getChallengeConfig(chatroomId);

    expect(config).toBeNull();
  });

  it('stores updatedAt timestamp when writing config', async () => {
    const chatroomId = 'room-timestamp';
    const beforeWrite = new Date().toISOString();
    await service.setChallengeConfig(chatroomId, ['require-verified-identity']);
    const afterWrite = new Date().toISOString();

    const rawData = await mockGunService.getPrivate(`chatroom-config/${chatroomId}/challengePlugins`);
    expect(rawData.updatedAt).toBeDefined();
    expect(rawData.updatedAt >= beforeWrite).toBe(true);
    expect(rawData.updatedAt <= afterWrite).toBe(true);
  });

  it('handles empty plugin list gracefully', async () => {
    const chatroomId = 'room-empty-list';

    await service.setChallengeConfig(chatroomId, []);
    const config = await service.getChallengeConfig(chatroomId);

    // Empty list should result in null config (no plugins to run)
    expect(config).toBeNull();
  });

  it('resolves all built-in plugins correctly', async () => {
    const chatroomId = 'room-all-builtins';
    const pluginIds = [
      'require-verified-identity',
      'require-trust-score',
      'require-invitation',
      'require-previous-interaction',
    ];

    await service.setChallengeConfig(chatroomId, pluginIds);
    const config = await service.getChallengeConfig(chatroomId);

    expect(config).not.toBeNull();
    expect(config!.plugins).toHaveLength(4);
    expect(config!.plugins.map((p) => p.id)).toEqual(pluginIds);
  });

  it('zone-B path matches spec format: chatroom-config/<chatroomId>/challengePlugins', async () => {
    const chatroomId = 'spec-test-room';
    const pluginIds = ['require-verified-identity'];

    await service.setChallengeConfig(chatroomId, pluginIds);

    // Verify the exact path used
    const rawData = await mockGunService.getPrivate(`chatroom-config/${chatroomId}/challengePlugins`);
    expect(rawData).toBeDefined();
    expect(rawData.pluginIdsJson).toBe(JSON.stringify(pluginIds));
  });

  it('multiple writes to same room overwrite previous config', async () => {
    const chatroomId = 'room-overwrite';

    // First write
    await service.setChallengeConfig(chatroomId, ['require-verified-identity']);
    let config = await service.getChallengeConfig(chatroomId);
    expect(config!.plugins).toHaveLength(1);
    expect(config!.plugins[0].id).toBe('require-verified-identity');

    // Second write with different plugins
    await service.setChallengeConfig(chatroomId, ['require-invitation', 'require-trust-score']);
    config = await service.getChallengeConfig(chatroomId);
    expect(config!.plugins).toHaveLength(2);
    expect(config!.plugins.map((p) => p.id)).toEqual(['require-invitation', 'require-trust-score']);
  });

  it('custom registered plugins are resolved if present in config', async () => {
    // Register a custom plugin
    const customPlugin = {
      id: 'custom-test-gate',
      evaluate: () => ({ allowed: true }),
    };
    registerChallengePlugin(customPlugin);

    const chatroomId = 'room-custom';
    const pluginIds = ['require-verified-identity', 'custom-test-gate'];

    await service.setChallengeConfig(chatroomId, pluginIds);
    const config = await service.getChallengeConfig(chatroomId);

    expect(config).not.toBeNull();
    expect(config!.plugins).toHaveLength(2);
    expect(config!.plugins[1].id).toBe('custom-test-gate');
  });
});

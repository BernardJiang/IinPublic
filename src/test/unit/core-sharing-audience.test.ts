import Gun from 'gun';
import { filterPeerAudience, guardMeshSay, installSharingPolicy } from '../../core/sharing-policy';

const cipher = 'SEA' + JSON.stringify({ ct: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAAAAAA', s: 'AAAAAAAAAAAA' });
const node = (soul: string, value: unknown) => ({ _: { '#': soul, '>': { value: Date.now() } }, value });

describe('pair and room peer audiences', () => {
  it('removes restricted records and signed links from mixed cached messages without changing storage', () => {
    const via = { id: 'source' };
    const meta = Object.assign(() => {}, { raw: 'stale-private-wire', $put: 'stale-private-put', via });
    const publicNode = {
      _: { '#': 'public/card', '>': { name: 1, alias: 2 } }, name: 'Public',
      alias: JSON.stringify({ ':': { '#': 'pair/p/response' }, '~': 'signature' }),
    };
    const msg = { '#': 'mixed', '##': 'cached-hash', _: meta, put: {
      'public/card': publicNode, 'pair/p/response': node('pair/p/response', cipher), 'room/r/message': node('room/r/message', cipher),
    } };
    expect(filterPeerAudience(msg, true)).toBe(msg);
    const filtered = filterPeerAudience(msg, false);
    expect(Object.keys(filtered.put)).toEqual(['public/card']);
    expect(filtered.put['public/card']).toEqual({ _: { '#': 'public/card', '>': { name: 1 } }, name: 'Public' });
    expect(filtered._.raw).toBeUndefined();
    expect(filtered._.via).toBe(via);
    expect(filtered['##']).toBeUndefined();
    expect(msg.put['public/card'].alias).toContain('pair/p/response');
    for (const soul of ['pair', 'pair/p', 'room/r']) expect(filterPeerAudience({ get: { '#': soul } }, false)).toBeNull();
  });

  it('trusts only the configured outbound relay object, including cached reply routing', () => {
    const url = 'https://relay.example/gun';
    const relay = { id: url, url };
    const other = { id: 'incoming', url };
    const said: any[] = [];
    const mesh: any = { say: (msg: any, peer: any) => { said.push({ msg, peer }); return true; } };
    const root = { opt: { sharingRelayPeers: [url], peers: { [url]: relay } }, dup: { s: { ask: { via: other }, relayAsk: { via: relay } } } };
    guardMeshSay(mesh, root);
    const put = { 'pair/p/response': node('pair/p/response', cipher) };
    expect(mesh.say({ put }, other)).toBe(false);
    expect(mesh.say({ '@': 'ask', put })).toBe(false);
    expect(mesh.say({ '@': 'unknown', put })).toBe(false);
    expect(mesh.say({ '@': 'relayAsk', put })).toBe(true);
    expect(said).toHaveLength(1);
    expect(said[0].peer).toBe(relay);
  });

  it('filters each real mesh destination and refuses a LAN peer probing a locally stored pair', async () => {
    installSharingPolicy(Gun);
    const url = 'https://relay.example/gun';
    const gun = (Gun as any)({ peers: [], sharingRelayPeers: [url], localStorage: false, radisk: false, axe: false, multicast: false });
    const relayWire: string[] = [];
    const lanWire: string[] = [];
    const relay = { id: url, url, wire: { send: (raw: string) => relayWire.push(raw) } };
    const lan = { id: 'lan', wire: { send: (raw: string) => lanWire.push(raw) } };
    gun._.opt.peers[url] = relay;
    gun._.opt.peers.lan = lan;
    const mesh = gun._.opt.mesh;
    mesh.say({ '#': 'mixed-broadcast', put: {
      'public/card': node('public/card', 'public-probe'),
      'pair/p/response': node('pair/p/response', cipher),
      'room/r/message': node('room/r/message', cipher),
    } });
    gun.get('pair/p/stored').put({ value: cipher });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(relayWire.join('')).toContain('pair/p/response');
    expect(relayWire.join('')).toContain('room/r/message');
    expect(lanWire.join('')).toContain('public-probe');
    expect(lanWire.join('')).not.toContain('pair/');
    expect(lanWire.join('')).not.toContain('room/');
    expect(gun._.graph['pair/p/stored']?.value).toBe(cipher);
    lanWire.length = 0;
    mesh.hear(JSON.stringify({ '#': 'lan-probe', get: { '#': 'pair/p/stored' } }), lan);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lanWire.join('')).not.toContain('pair/p/stored');
    expect(lanWire.join('')).not.toContain(cipher);
    expect(mesh.sharingPolicy.violations.audience).toBeGreaterThan(0);
    gun.off();
  });
});

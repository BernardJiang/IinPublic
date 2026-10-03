import crypto from 'crypto';
import dgram from 'dgram';

/**
 * Minimal loopback TURN relay (RFC 5766 subset) for the Wi-Fi Direct link upgrade (OPEN-36).
 *
 * Android WebView's WebRTC only gathers candidates on networks ConnectivityManager knows about,
 * so it never sees the Wi-Fi Direct group interface even though the kernel routes it for every
 * app (netd's local network). The embedded node is not restricted that way: WebView talks TURN to
 * this relay on 127.0.0.1, and the relay's own UDP socket — bound to this device's group address —
 * carries the (still DTLS-encrypted) packets to the peer's relay across the group. The group owner
 * therefore forwards ciphertext only, exactly as before.
 *
 * Scope is deliberately tiny: UDP only, one realm, one generated credential per relay instance,
 * Allocate / Refresh / CreatePermission / ChannelBind / Send / Data. Long-term-credential auth keeps
 * other apps on the device from using it as an open relay into the group.
 */

const MAGIC_COOKIE = 0x2112a442;
const FINGERPRINT_XOR = 0x5354554e;

const METHOD = { binding: 0x001, allocate: 0x003, refresh: 0x004, send: 0x006, data: 0x007, createPermission: 0x008, channelBind: 0x009 } as const;
const CLASS = { request: 0x0000, indication: 0x0010, success: 0x0100, error: 0x0110 } as const;
const ATTR = {
  username: 0x0006,
  messageIntegrity: 0x0008,
  errorCode: 0x0009,
  channelNumber: 0x000c,
  lifetime: 0x000d,
  xorPeerAddress: 0x0012,
  data: 0x0013,
  realm: 0x0014,
  nonce: 0x0015,
  xorRelayedAddress: 0x0016,
  requestedTransport: 0x0019,
  xorMappedAddress: 0x0020,
  software: 0x8022,
  fingerprint: 0x8028,
} as const;

const DEFAULT_LIFETIME_S = 600;
const MAX_LIFETIME_S = 3600;

export type StunAttribute = { type: number; value: Buffer };
export type StunMessage = { method: number; cls: number; transactionId: Buffer; attributes: StunAttribute[]; raw: Buffer };

export function parseStunMessage(buf: Buffer): StunMessage | null {
  if (buf.length < 20 || (buf[0]! & 0xc0) !== 0) return null;
  if (buf.readUInt32BE(4) !== MAGIC_COOKIE) return null;
  const length = buf.readUInt16BE(2);
  if (length + 20 > buf.length || length % 4 !== 0) return null;
  const type = buf.readUInt16BE(0);
  const method = (type & 0x000f) | ((type & 0x00e0) >> 1) | ((type & 0x3e00) >> 2);
  const cls = type & 0x0110;
  const attributes: StunAttribute[] = [];
  let offset = 20;
  while (offset + 4 <= 20 + length) {
    const attrType = buf.readUInt16BE(offset);
    const attrLength = buf.readUInt16BE(offset + 2);
    if (offset + 4 + attrLength > 20 + length) return null;
    attributes.push({ type: attrType, value: buf.subarray(offset + 4, offset + 4 + attrLength) });
    offset += 4 + attrLength + ((4 - (attrLength % 4)) % 4);
  }
  return { method, cls, transactionId: buf.subarray(8, 20), attributes, raw: buf.subarray(0, 20 + length) };
}

function messageType(method: number, cls: number): number {
  return (method & 0x000f) | ((method & 0x0070) << 1) | ((method & 0x0f80) << 2) | cls;
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function longTermKey(username: string, realm: string, password: string): Buffer {
  return crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest();
}

/** Builds a STUN message; with `key`, appends MESSAGE-INTEGRITY, then FINGERPRINT. */
export function encodeStunMessage(params: { method: number; cls: number; transactionId: Buffer; attributes: StunAttribute[]; key?: Buffer }): Buffer {
  const parts: Buffer[] = [];
  for (const attr of params.attributes) {
    const header = Buffer.alloc(4);
    header.writeUInt16BE(attr.type, 0);
    header.writeUInt16BE(attr.value.length, 2);
    parts.push(header, attr.value, Buffer.alloc((4 - (attr.value.length % 4)) % 4));
  }
  let body = Buffer.concat(parts);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(messageType(params.method, params.cls), 0);
  header.writeUInt32BE(MAGIC_COOKIE, 4);
  params.transactionId.copy(header, 8);
  if (params.key) {
    header.writeUInt16BE(body.length + 24, 2);
    const hmac = crypto.createHmac('sha1', params.key).update(Buffer.concat([header, body])).digest();
    const mi = Buffer.alloc(4);
    mi.writeUInt16BE(ATTR.messageIntegrity, 0);
    mi.writeUInt16BE(20, 2);
    body = Buffer.concat([body, mi, hmac]);
  }
  header.writeUInt16BE(body.length + 8, 2);
  const crc = (crc32(Buffer.concat([header, body])) ^ FINGERPRINT_XOR) >>> 0;
  const fp = Buffer.alloc(8);
  fp.writeUInt16BE(ATTR.fingerprint, 0);
  fp.writeUInt16BE(4, 2);
  fp.writeUInt32BE(crc, 4);
  return Buffer.concat([header, body, fp]);
}

/** Verifies MESSAGE-INTEGRITY over the bytes preceding it, with the length adjusted per RFC 5389 §15.4. */
export function verifyMessageIntegrity(message: StunMessage, key: Buffer): boolean {
  let offset = 20;
  const raw = message.raw;
  while (offset + 4 <= raw.length) {
    const type = raw.readUInt16BE(offset);
    const length = raw.readUInt16BE(offset + 2);
    if (type === ATTR.messageIntegrity) {
      if (length !== 20) return false;
      const covered = Buffer.from(raw.subarray(0, offset));
      covered.writeUInt16BE(offset - 20 + 24, 2);
      const expected = crypto.createHmac('sha1', key).update(covered).digest();
      return crypto.timingSafeEqual(expected, raw.subarray(offset + 4, offset + 24));
    }
    offset += 4 + length + ((4 - (length % 4)) % 4);
  }
  return false;
}

export function encodeXorAddress(address: string, port: number): Buffer {
  const octets = address.split('.').map(Number);
  const value = Buffer.alloc(8);
  value.writeUInt8(0x01, 1);
  value.writeUInt16BE(port ^ (MAGIC_COOKIE >>> 16), 2);
  const ip = ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
  value.writeUInt32BE((ip ^ MAGIC_COOKIE) >>> 0, 4);
  return value;
}

export function decodeXorAddress(value: Buffer): { address: string; port: number } | null {
  if (value.length < 8 || value[1] !== 0x01) return null;
  const port = value.readUInt16BE(2) ^ (MAGIC_COOKIE >>> 16);
  const ip = (value.readUInt32BE(4) ^ MAGIC_COOKIE) >>> 0;
  return { address: [ip >>> 24, (ip >>> 16) & 0xff, (ip >>> 8) & 0xff, ip & 0xff].join('.'), port };
}

function attr(message: StunMessage, type: number): Buffer | undefined {
  return message.attributes.find((a) => a.type === type)?.value;
}

function errorCodeValue(code: number, reason: string): Buffer {
  const text = Buffer.from(reason, 'utf8');
  const value = Buffer.alloc(4 + text.length);
  value.writeUInt8(Math.floor(code / 100), 2);
  value.writeUInt8(code % 100, 3);
  text.copy(value, 4);
  return value;
}

function u32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0, 0);
  return buf;
}

type Allocation = {
  clientKey: string;
  clientAddress: string;
  clientPort: number;
  socket: dgram.Socket;
  relayPort: number;
  expiresAt: number;
  permissions: Set<string>;
  channelsByNumber: Map<number, { address: string; port: number }>;
  channelsByPeer: Map<string, number>;
};

export type LocalLinkRelayInfo = {
  urls: string[];
  username: string;
  credential: string;
  relayAddress: string;
};

export class LocalLinkTurnRelay {
  private socket: dgram.Socket | null = null;
  private readonly allocations = new Map<string, Allocation>();
  private readonly realm = 'iinpublic-local-link';
  private readonly username: string;
  private readonly password: string;
  private readonly key: Buffer;
  private readonly nonce = crypto.randomBytes(12).toString('hex');
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private listenPort = 0;

  constructor(
    /** This device's Wi-Fi Direct group address; relay sockets bind here. */
    readonly relayAddress: string,
    private readonly listenAddress = '127.0.0.1',
    private readonly now: () => number = Date.now,
  ) {
    this.username = `ll${crypto.randomBytes(6).toString('hex')}`;
    this.password = crypto.randomBytes(16).toString('hex');
    this.key = longTermKey(this.username, this.realm, this.password);
  }

  async start(): Promise<LocalLinkRelayInfo> {
    if (!this.socket) {
      const socket = dgram.createSocket('udp4');
      socket.on('message', (msg, rinfo) => this.onClientPacket(msg, rinfo.address, rinfo.port));
      socket.on('error', () => undefined);
      await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(0, this.listenAddress, () => { socket.off('error', reject); resolve(); });
      });
      this.socket = socket;
      this.listenPort = socket.address().port;
      this.sweepTimer = setInterval(() => this.sweep(), 30_000);
      (this.sweepTimer as { unref?: () => void }).unref?.();
    }
    return this.info();
  }

  info(): LocalLinkRelayInfo {
    return {
      urls: [`turn:${this.listenAddress}:${this.listenPort}?transport=udp`],
      username: this.username,
      credential: this.password,
      relayAddress: this.relayAddress,
    };
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const allocation of this.allocations.values()) this.closeAllocation(allocation);
    this.allocations.clear();
    try { this.socket?.close(); } catch { /* already closed */ }
    this.socket = null;
  }

  private sweep(): void {
    const now = this.now();
    for (const allocation of [...this.allocations.values()]) {
      if (allocation.expiresAt <= now) this.closeAllocation(allocation);
    }
  }

  private closeAllocation(allocation: Allocation): void {
    try { allocation.socket.close(); } catch { /* already closed */ }
    this.allocations.delete(allocation.clientKey);
  }

  private onClientPacket(msg: Buffer, address: string, port: number): void {
    const clientKey = `${address}:${port}`;
    // ChannelData: 0x4000–0x7FFF channel number, then length, then application data.
    if (msg.length >= 4 && (msg[0]! & 0xc0) === 0x40) {
      const allocation = this.allocations.get(clientKey);
      const peer = allocation?.channelsByNumber.get(msg.readUInt16BE(0));
      const length = msg.readUInt16BE(2);
      if (allocation && peer && length + 4 <= msg.length) allocation.socket.send(msg.subarray(4, 4 + length), peer.port, peer.address);
      return;
    }
    const message = parseStunMessage(msg);
    if (!message) return;
    if (message.cls === CLASS.indication && message.method === METHOD.send) return this.onSendIndication(clientKey, message);
    if (message.cls !== CLASS.request) return;
    if (message.method === METHOD.binding) {
      return this.reply(address, port, message, CLASS.success, [{ type: ATTR.xorMappedAddress, value: encodeXorAddress(address, port) }]);
    }
    if (!this.authenticate(address, port, message)) return;
    switch (message.method) {
      case METHOD.allocate: return void this.onAllocate(clientKey, address, port, message);
      case METHOD.refresh: return this.onRefresh(clientKey, address, port, message);
      case METHOD.createPermission: return this.onCreatePermission(clientKey, address, port, message);
      case METHOD.channelBind: return this.onChannelBind(clientKey, address, port, message);
      default: return this.replyError(address, port, message, 400, 'Bad Request', true);
    }
  }

  /** Long-term credentials: challenge with 401 until USERNAME/REALM/NONCE/MESSAGE-INTEGRITY verify. */
  private authenticate(address: string, port: number, message: StunMessage): boolean {
    const username = attr(message, ATTR.username)?.toString('utf8');
    const nonce = attr(message, ATTR.nonce)?.toString('utf8');
    const hasIntegrity = !!attr(message, ATTR.messageIntegrity);
    if (!username || !hasIntegrity || !nonce) {
      this.replyError(address, port, message, 401, 'Unauthorized', false);
      return false;
    }
    if (nonce !== this.nonce) {
      this.replyError(address, port, message, 438, 'Stale Nonce', false);
      return false;
    }
    if (username !== this.username || !verifyMessageIntegrity(message, this.key)) {
      this.replyError(address, port, message, 401, 'Unauthorized', false);
      return false;
    }
    return true;
  }

  private async onAllocate(clientKey: string, address: string, port: number, message: StunMessage): Promise<void> {
    const existing = this.allocations.get(clientKey);
    if (existing) {
      // Retransmitted Allocate for the same 5-tuple: answer with the same allocation.
      return this.replyAllocateSuccess(address, port, message, existing);
    }
    const transport = attr(message, ATTR.requestedTransport);
    if (!transport || transport[0] !== 17) return this.replyError(address, port, message, 442, 'Unsupported Transport Protocol', true);
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(0, this.relayAddress, () => { socket.off('error', reject); resolve(); });
      });
    } catch {
      try { socket.close(); } catch { /* never bound */ }
      return this.replyError(address, port, message, 508, 'Insufficient Capacity', true);
    }
    const allocation: Allocation = {
      clientKey,
      clientAddress: address,
      clientPort: port,
      socket,
      relayPort: socket.address().port,
      expiresAt: this.now() + this.lifetimeSeconds(message) * 1000,
      permissions: new Set(),
      channelsByNumber: new Map(),
      channelsByPeer: new Map(),
    };
    socket.on('message', (data, rinfo) => this.onPeerPacket(allocation, data, rinfo.address, rinfo.port));
    this.allocations.set(clientKey, allocation);
    this.replyAllocateSuccess(address, port, message, allocation);
  }

  private replyAllocateSuccess(address: string, port: number, message: StunMessage, allocation: Allocation): void {
    this.reply(address, port, message, CLASS.success, [
      { type: ATTR.xorRelayedAddress, value: encodeXorAddress(this.relayAddress, allocation.relayPort) },
      { type: ATTR.xorMappedAddress, value: encodeXorAddress(address, port) },
      { type: ATTR.lifetime, value: u32(Math.round((allocation.expiresAt - this.now()) / 1000)) },
    ], true);
  }

  private lifetimeSeconds(message: StunMessage): number {
    const requested = attr(message, ATTR.lifetime);
    const seconds = requested && requested.length === 4 ? requested.readUInt32BE(0) : DEFAULT_LIFETIME_S;
    return Math.min(Math.max(seconds, 0), MAX_LIFETIME_S);
  }

  private onRefresh(clientKey: string, address: string, port: number, message: StunMessage): void {
    const allocation = this.allocations.get(clientKey);
    if (!allocation) return this.replyError(address, port, message, 437, 'Allocation Mismatch', true);
    const lifetime = this.lifetimeSeconds(message);
    if (lifetime === 0) this.closeAllocation(allocation);
    else allocation.expiresAt = this.now() + lifetime * 1000;
    this.reply(address, port, message, CLASS.success, [{ type: ATTR.lifetime, value: u32(lifetime) }], true);
  }

  private onCreatePermission(clientKey: string, address: string, port: number, message: StunMessage): void {
    const allocation = this.allocations.get(clientKey);
    if (!allocation) return this.replyError(address, port, message, 437, 'Allocation Mismatch', true);
    const peers = message.attributes.filter((a) => a.type === ATTR.xorPeerAddress).map((a) => decodeXorAddress(a.value));
    if (peers.length === 0 || peers.some((peer) => !peer)) return this.replyError(address, port, message, 400, 'Bad Request', true);
    for (const peer of peers) allocation.permissions.add(peer!.address);
    this.reply(address, port, message, CLASS.success, [], true);
  }

  private onChannelBind(clientKey: string, address: string, port: number, message: StunMessage): void {
    const allocation = this.allocations.get(clientKey);
    if (!allocation) return this.replyError(address, port, message, 437, 'Allocation Mismatch', true);
    const channelValue = attr(message, ATTR.channelNumber);
    const peerValue = attr(message, ATTR.xorPeerAddress);
    const peer = peerValue ? decodeXorAddress(peerValue) : null;
    const channel = channelValue && channelValue.length >= 2 ? channelValue.readUInt16BE(0) : 0;
    if (!peer || channel < 0x4000 || channel > 0x7fff) return this.replyError(address, port, message, 400, 'Bad Request', true);
    const peerKey = `${peer.address}:${peer.port}`;
    const boundChannel = allocation.channelsByPeer.get(peerKey);
    const boundPeer = allocation.channelsByNumber.get(channel);
    if ((boundChannel !== undefined && boundChannel !== channel) || (boundPeer && `${boundPeer.address}:${boundPeer.port}` !== peerKey)) {
      return this.replyError(address, port, message, 400, 'Bad Request', true);
    }
    allocation.channelsByNumber.set(channel, peer);
    allocation.channelsByPeer.set(peerKey, channel);
    allocation.permissions.add(peer.address);
    this.reply(address, port, message, CLASS.success, [], true);
  }

  private onSendIndication(clientKey: string, message: StunMessage): void {
    const allocation = this.allocations.get(clientKey);
    const peerValue = attr(message, ATTR.xorPeerAddress);
    const data = attr(message, ATTR.data);
    const peer = peerValue ? decodeXorAddress(peerValue) : null;
    if (!allocation || !peer || !data || !allocation.permissions.has(peer.address)) return;
    allocation.socket.send(data, peer.port, peer.address);
  }

  private onPeerPacket(allocation: Allocation, data: Buffer, address: string, port: number): void {
    if (!allocation.permissions.has(address) || !this.socket) return;
    const channel = allocation.channelsByPeer.get(`${address}:${port}`);
    if (channel !== undefined) {
      const header = Buffer.alloc(4);
      header.writeUInt16BE(channel, 0);
      header.writeUInt16BE(data.length, 2);
      this.socket.send(Buffer.concat([header, data]), allocation.clientPort, allocation.clientAddress);
      return;
    }
    const indication = encodeStunMessage({
      method: METHOD.data,
      cls: CLASS.indication,
      transactionId: crypto.randomBytes(12),
      attributes: [
        { type: ATTR.xorPeerAddress, value: encodeXorAddress(address, port) },
        { type: ATTR.data, value: data },
      ],
    });
    this.socket.send(indication, allocation.clientPort, allocation.clientAddress);
  }

  private reply(address: string, port: number, request: StunMessage, cls: number, attributes: StunAttribute[], signed = false): void {
    if (!this.socket) return;
    const message = encodeStunMessage({
      method: request.method,
      cls,
      transactionId: request.transactionId,
      attributes,
      ...(signed ? { key: this.key } : {}),
    });
    this.socket.send(message, port, address);
  }

  private replyError(address: string, port: number, request: StunMessage, code: number, reason: string, signed: boolean): void {
    const attributes: StunAttribute[] = [{ type: ATTR.errorCode, value: errorCodeValue(code, reason) }];
    if (code === 401 || code === 438) {
      attributes.push({ type: ATTR.realm, value: Buffer.from(this.realm) }, { type: ATTR.nonce, value: Buffer.from(this.nonce) });
    }
    this.reply(address, port, request, CLASS.error, attributes, signed);
  }
}

import crypto from 'crypto';
import dgram from 'dgram';
import {
  decodeXorAddress,
  encodeStunMessage,
  encodeXorAddress,
  LocalLinkTurnRelay,
  longTermKey,
  parseStunMessage,
  verifyMessageIntegrity,
  type StunMessage,
} from '../../server/services/local-link-turn-relay';

const ALLOCATE = 0x003;
const CREATE_PERMISSION = 0x008;
const CHANNEL_BIND = 0x009;
const SEND = 0x006;
const DATA = 0x007;
const REQUEST = 0x0000;
const INDICATION = 0x0010;
const SUCCESS = 0x0100;
const ERROR = 0x0110;
const ATTR = { username: 0x0006, errorCode: 0x0009, channel: 0x000c, peer: 0x0012, data: 0x0013, realm: 0x0014, nonce: 0x0015, relayed: 0x0016, transport: 0x0019 };

/** A tiny TURN client over a real UDP socket. */
class Client {
  readonly socket = dgram.createSocket('udp4');
  private readonly inbox: Buffer[] = [];
  private waiters: Array<(msg: Buffer) => void> = [];
  key: Buffer | null = null;
  realm = '';
  nonce = '';

  constructor(private readonly server: { port: number }, private readonly username: string, private readonly password: string) {
    this.socket.on('message', (msg) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg); else this.inbox.push(msg);
    });
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve) => this.socket.bind(0, '127.0.0.1', () => resolve()));
  }

  next(timeoutMs = 2_000): Promise<Buffer> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no packet')), timeoutMs);
      this.waiters.push((msg) => { clearTimeout(timer); resolve(msg); });
    });
  }

  send(buf: Buffer): void {
    this.socket.send(buf, this.server.port, '127.0.0.1');
  }

  async request(method: number, attributes: Array<{ type: number; value: Buffer }>, signed = true): Promise<StunMessage> {
    const auth = signed && this.key
      ? [
          { type: ATTR.username, value: Buffer.from(this.username) },
          { type: ATTR.realm, value: Buffer.from(this.realm) },
          { type: ATTR.nonce, value: Buffer.from(this.nonce) },
        ]
      : [];
    this.send(encodeStunMessage({ method, cls: REQUEST, transactionId: crypto.randomBytes(12), attributes: [...attributes, ...auth], ...(signed && this.key ? { key: this.key } : {}) }));
    return parseStunMessage(await this.next())!;
  }

  async allocate(): Promise<{ address: string; port: number }> {
    const transport = Buffer.from([17, 0, 0, 0]);
    const challenge = await this.request(ALLOCATE, [{ type: ATTR.transport, value: transport }], false);
    expect(challenge.cls).toBe(ERROR);
    this.realm = attr(challenge, ATTR.realm)!.toString();
    this.nonce = attr(challenge, ATTR.nonce)!.toString();
    this.key = longTermKey(this.username, this.realm, this.password);
    const ok = await this.request(ALLOCATE, [{ type: ATTR.transport, value: transport }]);
    expect(ok.cls).toBe(SUCCESS);
    expect(verifyMessageIntegrity(ok, this.key)).toBe(true);
    return decodeXorAddress(attr(ok, ATTR.relayed)!)!;
  }

  close(): void {
    this.socket.close();
  }
}

function attr(message: StunMessage, type: number): Buffer | undefined {
  return message.attributes.find((a) => a.type === type)?.value;
}

function errorCode(message: StunMessage): number {
  const value = attr(message, ATTR.errorCode)!;
  return value[2]! * 100 + value[3]!;
}

describe('LocalLinkTurnRelay', () => {
  const relays: LocalLinkTurnRelay[] = [];
  const clients: Client[] = [];
  afterEach(() => {
    for (const relay of relays.splice(0)) relay.stop();
    for (const client of clients.splice(0)) client.close();
  });

  async function setup(): Promise<[Client, Client]> {
    const pair: Client[] = [];
    for (let i = 0; i < 2; i += 1) {
      const relay = new LocalLinkTurnRelay('127.0.0.1');
      relays.push(relay);
      const info = await relay.start();
      const client = new Client({ port: Number(/:(\d+)\?/.exec(info.urls[0]!)![1]) }, info.username, info.credential);
      clients.push(client);
      await client.open();
      pair.push(client);
    }
    return [pair[0]!, pair[1]!];
  }

  test('rejects wrong credentials and unauthenticated requests', async () => {
    const relay = new LocalLinkTurnRelay('127.0.0.1');
    relays.push(relay);
    const info = await relay.start();
    const intruder = new Client({ port: Number(/:(\d+)\?/.exec(info.urls[0]!)![1]) }, info.username, 'not-the-password');
    clients.push(intruder);
    await intruder.open();
    const challenge = await intruder.request(ALLOCATE, [{ type: ATTR.transport, value: Buffer.from([17, 0, 0, 0]) }], false);
    expect(errorCode(challenge)).toBe(401);
    intruder.realm = attr(challenge, ATTR.realm)!.toString();
    intruder.nonce = attr(challenge, ATTR.nonce)!.toString();
    intruder.key = longTermKey(info.username, intruder.realm, 'not-the-password');
    const denied = await intruder.request(ALLOCATE, [{ type: ATTR.transport, value: Buffer.from([17, 0, 0, 0]) }]);
    expect(errorCode(denied)).toBe(401);
  });

  test('relay↔relay: Send indication arrives as Data indication only after permission', async () => {
    const [a, b] = await setup();
    const relayA = await a.allocate();
    const relayB = await b.allocate();
    expect(relayA.address).toBe('127.0.0.1');

    // B has not permitted A yet → A's packet is dropped.
    a.send(encodeStunMessage({ method: SEND, cls: INDICATION, transactionId: crypto.randomBytes(12), attributes: [
      { type: ATTR.peer, value: encodeXorAddress(relayB.address, relayB.port) },
      { type: ATTR.data, value: Buffer.from('early') },
    ] }));

    expect((await a.request(CREATE_PERMISSION, [{ type: ATTR.peer, value: encodeXorAddress(relayB.address, relayB.port) }])).cls).toBe(SUCCESS);
    expect((await b.request(CREATE_PERMISSION, [{ type: ATTR.peer, value: encodeXorAddress(relayA.address, relayA.port) }])).cls).toBe(SUCCESS);

    a.send(encodeStunMessage({ method: SEND, cls: INDICATION, transactionId: crypto.randomBytes(12), attributes: [
      { type: ATTR.peer, value: encodeXorAddress(relayB.address, relayB.port) },
      { type: ATTR.data, value: Buffer.from('hello') },
    ] }));
    const indication = parseStunMessage(await b.next())!;
    expect(indication.method).toBe(DATA);
    expect(attr(indication, ATTR.data)!.toString()).toBe('hello');
    expect(decodeXorAddress(attr(indication, ATTR.peer)!)).toEqual(relayA);
  });

  test('ChannelBind switches both directions to ChannelData framing', async () => {
    const [a, b] = await setup();
    const relayA = await a.allocate();
    const relayB = await b.allocate();
    const channel = Buffer.from([0x40, 0x01, 0, 0]);
    expect((await a.request(CHANNEL_BIND, [{ type: ATTR.channel, value: channel }, { type: ATTR.peer, value: encodeXorAddress(relayB.address, relayB.port) }])).cls).toBe(SUCCESS);
    expect((await b.request(CHANNEL_BIND, [{ type: ATTR.channel, value: channel }, { type: ATTR.peer, value: encodeXorAddress(relayA.address, relayA.port) }])).cls).toBe(SUCCESS);

    const payload = Buffer.from('dtls-record');
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt16BE(0x4001, 0);
    frame.writeUInt16BE(payload.length, 2);
    payload.copy(frame, 4);
    a.send(frame);
    const received = await b.next();
    expect(received.readUInt16BE(0)).toBe(0x4001);
    expect(received.subarray(4, 4 + received.readUInt16BE(2)).toString()).toBe('dtls-record');
  });
});

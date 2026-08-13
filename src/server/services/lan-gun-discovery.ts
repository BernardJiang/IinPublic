import crypto from 'crypto';
import { Bonjour, type Browser, type Service } from 'bonjour-service';
import { logger } from '../logger';

const SERVICE_TYPE = 'iinpublic';
const PROTOCOL_VERSION = '1';

export function isUsableLanAddress(address: string): boolean {
  if (!address || address.includes(':')) return false;
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254);
}

/**
 * Desktop LAN rendezvous for the authoritative on-device Gun node.
 *
 * The advertisement contains only a random process id, protocol version and port—never a SEA id,
 * username, room, or profile. A discovered endpoint is an untrusted transport hint; Gun/SEA still
 * owns data validation and identity authentication above the connection.
 */
export class LanGunDiscovery {
  private readonly instanceId = crypto.randomBytes(12).toString('hex');
  private bonjour: Bonjour | undefined;
  private browser: Browser | undefined;
  private advertisement: Service | undefined;
  private readonly connectedUrls = new Set<string>();

  constructor(
    private readonly gun: any,
    private readonly port: number,
  ) {}

  start(): void {
    if (this.bonjour) return;
    try {
      this.bonjour = new Bonjour();
      this.advertisement = this.bonjour.publish({
        name: `IinPublic-${this.instanceId}`,
        type: SERVICE_TYPE,
        protocol: 'tcp',
        port: this.port,
        txt: { protocol: PROTOCOL_VERSION, instance: this.instanceId, path: '/gun' },
      });
      this.browser = this.bonjour.find({ type: SERVICE_TYPE, protocol: 'tcp' }, (service) => {
        this.connect(service);
      });
      logger.info({ port: this.port, serviceType: `_${SERVICE_TYPE}._tcp` }, 'LAN Gun discovery started');
    } catch (error) {
      logger.warn({ error }, 'LAN Gun discovery unavailable; other discovery providers remain active');
      this.stop();
    }
  }

  stop(): void {
    try { this.browser?.stop(); } catch { /* best effort */ }
    try { this.advertisement?.stop(); } catch { /* best effort */ }
    try { this.bonjour?.destroy(); } catch { /* best effort */ }
    this.browser = undefined;
    this.advertisement = undefined;
    this.bonjour = undefined;
  }

  private connect(service: Service): void {
    const txt = (service.txt || {}) as Record<string, unknown>;
    if (String(txt.protocol || '') !== PROTOCOL_VERSION) return;
    if (String(txt.instance || '') === this.instanceId) return;
    const address = (service.addresses || []).find(isUsableLanAddress);
    const port = Number(service.port);
    if (!address || !Number.isInteger(port) || port < 1 || port > 65535) return;
    const path = String(txt.path || '/gun') === '/gun' ? '/gun' : '/gun';
    const url = `http://${address}:${port}${path}`;
    if (this.connectedUrls.has(url)) return;
    this.connectedUrls.add(url);
    this.gun.opt({ peers: [url] });
    logger.info({ peer: url, service: service.name }, 'LAN Gun peer discovered and added');
  }
}

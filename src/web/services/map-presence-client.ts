import {
  createMapPresence,
  type MapBounds,
  type MapDensityCell,
  type MapPresenceDot,
} from '../../shared/map-presence';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { PublicLocation } from '../../shared/public-location';

export type MapPresenceView = { dots: MapPresenceDot[]; density: MapDensityCell[] };

/** Publishes this device's public map point and reads the people visible in a map view. */
export class MapPresenceClient {
  constructor(private readonly apiBase: string, private readonly fetchFn: typeof fetch = fetch.bind(globalThis)) {}

  async publish(input: { userId: string; pair: SeaSigningPair; location: PublicLocation | null }): Promise<void> {
    const presence = await createMapPresence(input);
    const response = await this.fetchFn(`${this.apiBase}/api/map-presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presence }),
    });
    if (!response.ok) throw new Error(`map presence publish failed: ${response.status}`);
  }

  async load(bounds: MapBounds): Promise<MapPresenceView> {
    const query = new URLSearchParams(Object.entries(bounds).map(([key, value]) => [key, String(value)]));
    const response = await this.fetchFn(`${this.apiBase}/api/map-presence?${query}`);
    if (!response.ok) throw new Error(`map presence read failed: ${response.status}`);
    const body = await response.json() as Partial<MapPresenceView>;
    return {
      dots: Array.isArray(body.dots) ? body.dots : [],
      density: Array.isArray(body.density) ? body.density : [],
    };
  }
}

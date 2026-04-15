import Gun from 'gun';
import 'gun/sea';
import type { GunPair } from './services/gun-bridge';

/**
 * Gun SEA singleton after `gun/sea` side-effect load (browser bundle).
 */
export function getSEA(): any {
  const g = Gun as any;
  return g.SEA;
}

export type { GunPair };

export async function seaPair(): Promise<GunPair> {
  const SEA = getSEA();
  if (!SEA?.pair) {
    throw new Error('Gun SEA not available');
  }
  return SEA.pair();
}

/**
 * Build the payload for Socket.IO `authenticate` once the client connects with socket.io-client.
 * Server verifies via `SEA.verify(signature, pub) === userId`.
 */
import { getSEA } from './sea-gun';
import type { GunPair } from './services/gun-bridge';

export async function createSocketAuthPayload(
  userId: string,
  pair: GunPair,
): Promise<{ userId: string; pub: string; signature: string }> {
  const SEA = getSEA();
  const signature = await SEA.sign(userId, pair);
  return { userId, pub: pair.pub, signature };
}

import { gunSafeTalkDataRecord } from '../../shared/peer-talk-delivery';
import type { P2PRuntimeFlags } from '../../shared/p2p-runtime';
import type { WebGunService } from './web-gun-service';

/**
 * P2P-L: mirror authoritative server incoming-talk snapshots into local Gun
 * so the device-owned graph can sync over the peer mesh.
 */
/** Mirror a talk definition node for P2P mesh subscribers (P2P-L). */
export function mirrorTalkDefinitionToLocalGun(
  gunService: WebGunService,
  talkId: string,
  talkData: unknown,
  flags: P2PRuntimeFlags,
): void {
  if (!flags.p2pClientTalkMirror || !talkId) return;
  const wire =
    talkData && typeof talkData === 'object'
      ? gunSafeTalkDataRecord(talkData as Record<string, unknown>)
      : talkData;
  gunService.getGun().get('talks').get(talkId).put(wire);
}

export function mirrorIncomingTalkClustersToLocalGun(
  gunService: WebGunService,
  userId: string,
  clusters: unknown[],
  flags: P2PRuntimeFlags,
): void {
  if (!flags.p2pClientTalkMirror || !userId || !Array.isArray(clusters)) return;
  const gun = gunService.getGun();
  for (const raw of clusters) {
    const cluster = raw as { identityKey?: string };
    if (!cluster?.identityKey) continue;
    gun.get('incomingTalksByUser').get(userId).get(cluster.identityKey).put(raw);
  }
}

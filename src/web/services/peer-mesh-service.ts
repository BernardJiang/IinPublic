/**
 * The peer mesh with this GUI's WebRTC adapter (OPEN-91 P4): the mesh protocol — neighbours,
 * frames, floods, acks, Talk bodies and responses — lives in the device core
 * (`src/core/peer-mesh-service.ts`). Browsers have no WebRTC in workers, so the GUI hosts the
 * transport (docs/design/device-core-architecture.md, "WebRTC"): a WebRTC session signalled over
 * the page's hub-connected Gun, unless the caller passes its own factory (libp2p, tests).
 */
import { PeerMeshService as CorePeerMeshService, type PeerMeshServiceOptions } from '../../core/peer-mesh-service';
import { getOrCreateP2PSession } from './p2p-webrtc-session';
import type { WebGunService } from './web-gun-service';

export * from '../../core/peer-mesh-service';

export class PeerMeshService extends CorePeerMeshService {
  constructor(gunService: WebGunService, opts: PeerMeshServiceOptions) {
    super(gunService, {
      ...opts,
      createSession: opts.createSession ?? ((params) => getOrCreateP2PSession({
        apiBase: opts.apiBase,
        conversationId: params.conversationId,
        localUserId: params.localUserId,
        localPub: params.localPub,
        localPair: params.localPair,
        otherUserId: params.otherUserId,
        otherPub: params.otherPub,
        isInitiator: params.isInitiator,
        // S2: Gun pub/sub signalling (peer↔peer `.on()` push), as fast as HTTP.
        gun: gunService.getGun(),
        onRemoteMeshFrame: params.onRemoteMeshFrame,
      })),
    });
  }
}

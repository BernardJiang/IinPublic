import { canonicalSerialize, computeCIDv1 } from './cid';
import type { ChatroomMapLocation } from './chatroom-map-locations';
import {
  createSignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
} from './p2p-runtime';

export type PlaceDescriptorContent = {
  version: 1;
  kind: 'iinpublic-place';
  name: string;
  placeType: 'business' | 'custom';
  description: string;
  location: ChatroomMapLocation;
  locationPrecision: 'public-cell' | 'confirmed-address';
  creatorPub: string;
  createdAt: string;
};

export type SignedPlaceDescriptor = PlaceDescriptorContent & {
  id: string;
  proof: SignedP2PEnvelopeProof;
};

export function placeDescriptorSigningPayload(
  descriptor: Omit<SignedPlaceDescriptor, 'proof'>,
): unknown {
  return {
    type: 'iinpublic-place-descriptor-v1',
    id: descriptor.id,
    content: {
      version: descriptor.version,
      kind: descriptor.kind,
      name: descriptor.name,
      placeType: descriptor.placeType,
      description: descriptor.description,
      location: descriptor.location,
      locationPrecision: descriptor.locationPrecision,
      creatorPub: descriptor.creatorPub,
      createdAt: descriptor.createdAt,
    },
  };
}

function contentOf(value: PlaceDescriptorContent): PlaceDescriptorContent {
  return {
    version: 1,
    kind: 'iinpublic-place',
    name: String(value.name || '').trim(),
    placeType: value.placeType,
    description: String(value.description || '').trim(),
    location: { latitude: value.location.latitude, longitude: value.location.longitude },
    locationPrecision: value.locationPrecision,
    creatorPub: String(value.creatorPub || '').trim(),
    createdAt: value.createdAt,
  };
}

export async function createSignedPlaceDescriptor(input: {
  name: string;
  placeType: 'business' | 'custom';
  description?: string;
  location: ChatroomMapLocation;
  locationPrecision?: 'public-cell' | 'confirmed-address';
  pair: SeaSigningPair;
  createdAt?: string;
}): Promise<SignedPlaceDescriptor> {
  const content = contentOf({
    version: 1,
    kind: 'iinpublic-place',
    name: input.name,
    placeType: input.placeType,
    description: input.description ?? '',
    location: input.location,
    locationPrecision: input.locationPrecision ?? 'public-cell',
    creatorPub: input.pair.pub,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  if (!content.name || content.name.length > 120) throw new Error('place name is invalid');
  if (!content.creatorPub || !input.pair.priv) throw new Error('place signing identity is unavailable');
  if (!Number.isFinite(content.location.latitude) || content.location.latitude < -90 || content.location.latitude > 90
    || !Number.isFinite(content.location.longitude) || content.location.longitude < -180 || content.location.longitude > 180) {
    throw new Error('place map point is invalid');
  }
  const cid = await computeCIDv1(content);
  const unsigned = { ...content, id: `place_${cid}` };
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: placeDescriptorSigningPayload(unsigned),
    timestamp: content.createdAt,
  });
  return { ...unsigned, proof };
}

export async function verifySignedPlaceDescriptor(
  value: unknown,
): Promise<{ ok: true; descriptor: SignedPlaceDescriptor } | { ok: false; reason: string }> {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'malformed place descriptor' };
  const raw = value as Partial<SignedPlaceDescriptor>;
  if (raw.version !== 1 || raw.kind !== 'iinpublic-place'
    || (raw.placeType !== 'business' && raw.placeType !== 'custom')
    || (raw.locationPrecision !== 'public-cell' && raw.locationPrecision !== 'confirmed-address')
    || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 120
    || typeof raw.description !== 'string' || raw.description.length > 2_000
    || typeof raw.creatorPub !== 'string' || !raw.creatorPub
    || typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))
    || typeof raw.id !== 'string' || !raw.id.startsWith('place_b')
    || !raw.location || !Number.isFinite(raw.location.latitude) || !Number.isFinite(raw.location.longitude)
    || !raw.proof || raw.proof.pub !== raw.creatorPub) {
    return { ok: false, reason: 'malformed place descriptor' };
  }
  const descriptor = raw as SignedPlaceDescriptor;
  const content = contentOf(descriptor);
  const expectedId = `place_${await computeCIDv1(content)}`;
  if (descriptor.id !== expectedId) return { ok: false, reason: 'place content address mismatch' };
  const proof = await verifySignedP2PEnvelopeProof({
    proof: descriptor.proof,
    payload: placeDescriptorSigningPayload({ ...content, id: descriptor.id }),
    now: new Date(descriptor.createdAt),
    maxSkewMs: 1_000,
  });
  if (!proof.ok) return { ok: false, reason: `invalid place signature: ${proof.reason}` };
  // Canonicalization also rejects non-data surprises that would not be included in the CID.
  canonicalSerialize(content);
  return { ok: true, descriptor: { ...content, id: descriptor.id, proof: descriptor.proof } };
}

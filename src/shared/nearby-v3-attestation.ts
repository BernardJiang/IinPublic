import { portableEcdsaSign, portableEcdsaVerify } from './portable-ecdsa';
import { portableSha256Hex } from './portable-sha256';

/**
 * The hub's two signed statements for Nearby v3 ranking (§3.7 "Ranking"):
 *
 * - the **daily beacon**: a value nobody can predict before its UTC day starts, mixed into every
 *   viewer's hash order, so a key ground to rank first for one victim stops working the next day;
 * - an **age proof**: the UTC day the hub first saw a key's card. In dense ties only keys seen
 *   before today's beacon rank first, so a key made after the beacon was revealed (and ground
 *   against it) ranks behind everyone who already existed.
 *
 * Both are signed by the hub's attestor key. A phone learns the key from the hub (and keeps it); a
 * signed manifest may pin the accepted keys (`extensions['nearby-v3'].attestorKeys`). Without a
 * beacon for today the order falls back to the UTC date, and without a verifiable age proof a card
 * counts as new: both only weaken the defence, never break a list.
 */
export type NearbyAttestorKey = { keyId: string; publicKey: string };

export type NearbyBeacon = {
  version: 1;
  kind: 'nearby-beacon';
  /** UTC day, YYYY-MM-DD. */
  day: string;
  /** 64 hex chars. */
  value: string;
  keyId: string;
  signature: string;
};

export type NearbyAgeProof = {
  version: 1;
  kind: 'nearby-age';
  pub: string;
  /** UTC day the hub first saw this key, YYYY-MM-DD. */
  since: string;
  keyId: string;
  signature: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function nearbyUtcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function nearbyAttestorKeyId(publicKey: string): string {
  return portableSha256Hex(`iinpublic:nearby-attestor:v1:${publicKey}`).slice(0, 32);
}

export function isNearbyAttestorKey(value: unknown): value is NearbyAttestorKey {
  const key = value as Partial<NearbyAttestorKey> | null;
  return !!key && typeof key === 'object'
    && typeof key.publicKey === 'string' && key.publicKey.length > 0 && key.publicKey.length <= 256
    && key.keyId === nearbyAttestorKeyId(key.publicKey);
}

function beaconMessage(day: string, value: string, keyId: string): string {
  return `iinpublic:nearby-beacon:v1:${keyId}:${day}:${value}`;
}

function ageMessage(pub: string, since: string, keyId: string): string {
  return `iinpublic:nearby-age:v1:${keyId}:${since}:${pub}`;
}

export async function signNearbyBeacon(input: { day: string; value: string; key: NearbyAttestorKey; priv: string }): Promise<NearbyBeacon> {
  return {
    version: 1,
    kind: 'nearby-beacon',
    day: input.day,
    value: input.value,
    keyId: input.key.keyId,
    signature: await portableEcdsaSign(beaconMessage(input.day, input.value, input.key.keyId), input.priv),
  };
}

export async function signNearbyAgeProof(input: { pub: string; since: string; key: NearbyAttestorKey; priv: string }): Promise<NearbyAgeProof> {
  return {
    version: 1,
    kind: 'nearby-age',
    pub: input.pub,
    since: input.since,
    keyId: input.key.keyId,
    signature: await portableEcdsaSign(ageMessage(input.pub, input.since, input.key.keyId), input.priv),
  };
}

export function parseNearbyBeacon(value: unknown): NearbyBeacon | null {
  const beacon = value as Partial<NearbyBeacon> | null;
  if (!beacon || typeof beacon !== 'object' || beacon.version !== 1 || beacon.kind !== 'nearby-beacon'
    || typeof beacon.day !== 'string' || !DAY.test(beacon.day)
    || typeof beacon.value !== 'string' || !/^[0-9a-f]{64}$/.test(beacon.value)
    || typeof beacon.keyId !== 'string' || beacon.keyId.length > 64
    || typeof beacon.signature !== 'string' || beacon.signature.length > 256) return null;
  return beacon as NearbyBeacon;
}

export function parseNearbyAgeProof(value: unknown): NearbyAgeProof | null {
  const proof = value as Partial<NearbyAgeProof> | null;
  if (!proof || typeof proof !== 'object' || proof.version !== 1 || proof.kind !== 'nearby-age'
    || typeof proof.pub !== 'string' || proof.pub.length < 1 || proof.pub.length > 2_048
    || typeof proof.since !== 'string' || !DAY.test(proof.since)
    || typeof proof.keyId !== 'string' || proof.keyId.length > 64
    || typeof proof.signature !== 'string' || proof.signature.length > 256) return null;
  return proof as NearbyAgeProof;
}

export async function verifyNearbyBeacon(value: unknown, keys: readonly NearbyAttestorKey[]): Promise<NearbyBeacon | null> {
  const beacon = parseNearbyBeacon(value);
  const key = beacon && keys.find((candidate) => candidate.keyId === beacon.keyId);
  if (!beacon || !key) return null;
  return await portableEcdsaVerify(beacon.signature, beaconMessage(beacon.day, beacon.value, beacon.keyId), key.publicKey)
    ? beacon
    : null;
}

/** The proof's `since` when it verifies for `pub`; null otherwise. */
export async function verifyNearbyAgeProof(
  value: unknown,
  pub: string,
  keys: readonly NearbyAttestorKey[],
): Promise<string | null> {
  const proof = parseNearbyAgeProof(value);
  const key = proof && keys.find((candidate) => candidate.keyId === proof.keyId);
  if (!proof || !key || proof.pub !== pub) return null;
  return await portableEcdsaVerify(proof.signature, ageMessage(proof.pub, proof.since, proof.keyId), key.publicKey)
    ? proof.since
    : null;
}

/** The string every viewer mixes into their order today: the hub's beacon, or the UTC date. */
export function nearbyBeaconString(beacon: NearbyBeacon | null | undefined, nowMs: number): string {
  const day = nearbyUtcDay(nowMs);
  return beacon && beacon.day === day ? `beacon:${day}:${beacon.value}` : `utc-day:${day}`;
}

/** A key seen before the beacon's day was revealed counts first in dense ties. */
export function isEstablishedBefore(since: string | null | undefined, beaconDay: string): boolean {
  return typeof since === 'string' && since < beaconDay;
}

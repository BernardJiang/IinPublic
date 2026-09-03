import crypto from 'crypto';

export type TurnCredentials = {
  username: string;
  credential: string;
  ttl: number;
  urls: string[];
};

/**
 * Short-lived TURN credentials using coturn's `use-auth-secret` convention (the de facto
 * "TURN REST API" mechanism most TURN deployments use — not a formal IETF RFC, but the
 * standard nearly every coturn setup follows): username is `"<expiryUnixSeconds>:<label>"`,
 * credential is `base64(HMAC-SHA1(secret, username))`. coturn independently derives the same
 * credential from the same shared secret and the username's embedded expiry, so nothing except
 * that one secret ever needs to be kept in sync between this server and the TURN server — see
 * docs/IinPublic_VPS_Installation_Guide.md's TURN section for the coturn-side config.
 *
 * Deliberately short-lived (default 1h): a leaked credential stops being usable once it expires,
 * unlike a permanent static username/password baked into every client, which anyone who
 * extracts it from the app bundle could use indefinitely as an open relay.
 */
export function generateTurnCredentials(params: {
  secret: string;
  urls: string[];
  ttlSeconds?: number;
  label?: string;
}): TurnCredentials {
  const ttl = params.ttlSeconds ?? 3600;
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${params.label || 'iinpublic'}`;
  const credential = crypto.createHmac('sha1', params.secret).update(username).digest('base64');
  return { username, credential, ttl, urls: params.urls };
}

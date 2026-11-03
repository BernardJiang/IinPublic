/**
 * Names of the device graph's shared souls (spec §31.9, REQ-GRAPH-30..35). Everything shared lives
 * under the `g/` root and is written only by its sender, in the sender's own part:
 *
 *   g/<sender>/t/<talkTag>              { head: E_K(the version's fields and structure key) }
 *   g/<sender>/t/<talkTag>/<i>          { ref: E_K(step i without text), text: E_K(step i's text) }
 *   g/<sender>/p/<pairTag>/head         { head: E_pair({ n, hash }) }
 *   g/<sender>/p/<pairTag>/log/<block>  { <n>: E_pair(signed entry n) }       256 entries a block
 *
 * `<sender>` is a hash of the sender's user ID, `<talkTag>` is random per Talk version, and
 * `<pairTag>` is a hash of the pair secret, so only the two people can name their log. No name
 * carries an identity, a Talk's text or a guessable content hash (REQ-GRAPH-33). Every value is
 * SEA ciphertext. These souls never go to a relay (the hub), only over the pair's direct link
 * (`sharing-policy.ts`, graph peers).
 */
import { portableSha256Hex } from '../../../shared/portable-sha256';

export const GRAPH_ROOT = 'g';
export const LOG_BLOCK = 256;

export const userTag = (userId: string) => portableSha256Hex(`iinpublic-graph-user-v1:${userId}`).slice(0, 32);
export const pairTagOf = (pairSecret: string) => portableSha256Hex(`iinpublic-graph-pair-v1:${pairSecret}`).slice(0, 32);

export function graphWireSouls(senderUserId: string) {
  const root = `${GRAPH_ROOT}/${userTag(senderUserId)}`;
  return {
    root,
    talk: (talkTag: string) => `${root}/t/${talkTag}`,
    talkStep: (talkTag: string, index: number) => `${root}/t/${talkTag}/${index}`,
    head: (pairTag: string) => `${root}/p/${pairTag}/head`,
    logBlock: (pairTag: string, block: number) => `${root}/p/${pairTag}/log/${block}`,
  };
}

/** `{ sender, kind, tag }` of a graph soul, or undefined for any other soul. */
export function parseGraphSoul(soul: string): { sender: string; kind: 't' | 'p'; tag: string } | undefined {
  const match = /^g\/([0-9a-f]{32})\/(t|p)\/([0-9a-f]{32})(?:\/|$)/.exec(soul);
  return match ? { sender: match[1]!, kind: match[2] as 't' | 'p', tag: match[3]! } : undefined;
}

export const isGraphSoul = (soul: unknown): boolean => typeof soul === 'string' && (soul === GRAPH_ROOT || soul.startsWith(`${GRAPH_ROOT}/`));

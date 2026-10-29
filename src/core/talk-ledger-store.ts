/** Host-owned Talk ledger operations. Read/decide/write happens on the storage owner, serialized
 * across every GUI session; a stale tab cannot spend the same quota or overwrite a newer outcome. */
import { CollectionStore } from './collections';
import { applyEdgeGate, applyEvent, emptyTalkLedgerDoc, exchangedKey, retractedKey, type ExchangedEntry, type LedgerEvent, type TalkLedgerDoc } from '../shared/talk-ledger';
import { buildTalkIdentityKey, canonicalSerialize, computeResponseId } from '../shared/cid';
import { checkIfMatch } from '../shared/talk-engine';
import type { P2PMeshTalkResponsePayload } from '../shared/p2p-mesh-protocol';
import { isResponseComplete, isIgnoreAnswerSet, nextResponseVersion } from './response-rules';
import { selectedTalkIdentityKeys } from './talk-rules';
import { isSeaCiphertext } from './sharing-policy';
import { DeliveryStore } from './delivery';
import type { GraphStore } from './graph-store';

export const TALK_LEDGER_SECTIONS = ['outcomes', 'exchanged', 'edges', 'retracted', 'sent'] as const;
export type ResponderEntryInput = {
  authorId: string; identityKey: string; talkId?: string; authorName?: string; authorEpub?: string | undefined;
  outcome: ExchangedEntry['outcome']; version: number; responseId: string; respondedAt: string;
};
export type AuthorEntriesInput = {
  responderId: string; identityKeys: string[]; outcome: ExchangedEntry['outcome']; version: number; respondedAt: string;
};
export type ResponseCommitInput = {
  talkId: string; talkData: any; answers: any[]; authorId: string; authorName: string; authorEpub?: string | undefined;
  responderId: string; responderEpub?: string | undefined; payloadCiphertext: string; submittedAt: string; selfTag?: string | undefined;
};
export type CommittedResponse = {
  payload: P2PMeshTalkResponsePayload; isMatch: boolean; isIgnore: boolean; isContentChange: boolean;
};
export type LedgerCommand =
  | { name: 'response.commit'; input: ResponseCommitInput }
  | { name: 'ledger.apply'; event: LedgerEvent }
  | { name: 'ledger.gate'; peerId: string; nowMs: number; talkId?: string; unlimitedForTesting?: boolean }
  | { name: 'ledger.responder'; input: ResponderEntryInput }
  | { name: 'ledger.author'; input: AuthorEntriesInput }
  | { name: 'ledger.authorAnswer'; event: LedgerEvent; input: AuthorEntriesInput };
export type LedgerCommandResult = { entries: Record<string, unknown>; gate?: { ok: boolean; rejectedBy: string[] }; response?: CommittedResponse };

export function ledgerFromEntries(entries: Record<string, unknown>): TalkLedgerDoc {
  const doc = emptyTalkLedgerDoc();
  for (const [entryKey, value] of Object.entries(entries)) {
    const split = entryKey.indexOf('::');
    const section = entryKey.slice(0, split) as typeof TALK_LEDGER_SECTIONS[number];
    if (split < 0 || !TALK_LEDGER_SECTIONS.includes(section)) continue;
    (doc[section] as Record<string, unknown>)[entryKey.slice(split + 2)] = JSON.parse(JSON.stringify(value));
  }
  return doc;
}
export function ledgerEntries(doc: TalkLedgerDoc): Record<string, unknown> {
  return Object.fromEntries(TALK_LEDGER_SECTIONS.flatMap((section) => Object.entries(doc[section]).map(([key, value]) => [`${section}::${key}`, value])));
}

export class CoreTalkLedger {
  private readonly collections: CollectionStore;
  constructor(private readonly store: GraphStore, private readonly allowTestOverrides = false) { this.collections = new CollectionStore(store); }

  /** The caller serializes this with collection imports/writes too, not just other commands. */
  async execute(command: LedgerCommand): Promise<LedgerCommandResult> {
    const before = await this.collections.all('talkLedger');
    const doc = ledgerFromEntries(before);
    let gate: LedgerCommandResult['gate'];
    let response: CommittedResponse | undefined;
    switch (command.name) {
      case 'response.commit': {
        const input = command.input;
        if (!input.authorId || !input.responderId || input.authorId === input.responderId || !input.talkId) throw new Error('Invalid response participants');
        if (!Array.isArray(input.answers) || !isResponseComplete(input.talkData, input.answers)) throw new Error('Incomplete response');
        if (!isSeaCiphertext(input.payloadCiphertext)) throw new Error('Response must be encrypted');
        if (doc.retracted[retractedKey(input.talkId, input.authorId)]) throw new Error('Talk has been retracted');
        const identityKey = buildTalkIdentityKey(input.talkData);
        const previous = doc.exchanged[exchangedKey(input.authorId, identityKey)] as (ExchangedEntry & { responseId?: string }) | undefined;
        const prior = previous?.role === 'responder' ? previous : undefined;
        const responseId = await computeResponseId({ talkId: input.talkId, responderId: input.responderId, responseContentJson: canonicalSerialize(input.answers) });
        const version = nextResponseVersion(prior?.responseId || null, prior?.version ?? 0, responseId);
        const isMatch = checkIfMatch(input.talkData, input.answers, input.selfTag);
        const payload: P2PMeshTalkResponsePayload = {
          responseId, talkId: input.talkId, authorId: input.authorId, responderId: input.responderId,
          submittedAt: input.submittedAt, respondedAt: input.submittedAt, version,
          encryption: 'sea-ecdh-v1', payloadCiphertext: input.payloadCiphertext, transportMode: 'mesh-p2p',
          ...(input.responderEpub ? { responderEpub: input.responderEpub } : {}),
        };
        // Nothing can be handed to a transport until all three durable effects succeed.
        const delivery = new DeliveryStore(this.store);
        await delivery.putSentResponse(payload);
        await delivery.record({ objectId: responseId, recipientId: input.authorId, objectKind: 'talk-response', state: 'committed' });
        for (const alias of new Set([identityKey, ...selectedTalkIdentityKeys(input.talkData, input.answers)])) {
          doc.exchanged[exchangedKey(input.authorId, alias)] = {
            peerId: input.authorId, identityKey: alias, talkId: input.talkId,
            peerName: input.authorName, ...(input.authorEpub ? { peerEpub: input.authorEpub } : {}),
            outcome: isMatch ? 'matched' : 'ignored', version, role: 'responder', lastExchangedAt: input.submittedAt,
            ...{ responseId },
          };
        }
        response = { payload, isMatch, isIgnore: isIgnoreAnswerSet(input.answers), isContentChange: !!prior?.responseId && prior.responseId !== responseId };
        break;
      }
      case 'ledger.apply': applyEvent(doc, command.event); break;
      case 'ledger.gate': gate = applyEdgeGate(doc, command.peerId, command.nowMs, command.talkId, this.allowTestOverrides && command.unlimitedForTesting === true); break;
      case 'ledger.responder': {
        const input = command.input;
        const key = exchangedKey(input.authorId, input.identityKey);
        const existing = doc.exchanged[key];
        if (existing && existing.role === 'responder' && existing.version > input.version) break;
        doc.exchanged[key] = {
          peerId: input.authorId, identityKey: input.identityKey,
          ...(input.talkId || existing?.talkId ? { talkId: input.talkId || existing?.talkId } : {}),
          ...(input.authorName || existing?.peerName ? { peerName: input.authorName || existing?.peerName } : {}),
          ...(input.authorEpub || existing?.peerEpub ? { peerEpub: input.authorEpub || existing?.peerEpub } : {}),
          outcome: input.outcome, version: input.version, role: 'responder', lastExchangedAt: input.respondedAt,
          ...(input.responseId ? { responseId: input.responseId } : {}),
        };
        break;
      }
      case 'ledger.authorAnswer':
        if (command.event.kind !== 'TALK_ANSWERED' || command.event.responderId !== command.input.responderId
          || command.event.version !== command.input.version || command.event.outcome !== command.input.outcome) {
          throw new Error('Author answer event and aliases disagree');
        }
        applyEvent(doc, command.event);
      // The received answer and its author-side identity aliases must be planned against the
      // same host snapshot. A stale GUI is not allowed to overwrite a newer answer version.
      // falls through
      case 'ledger.author': {
        const input = command.input;
        for (const identityKey of new Set(input.identityKeys.filter(Boolean))) {
          const key = exchangedKey(input.responderId, identityKey);
          if (doc.exchanged[key]?.version > input.version) continue;
          doc.exchanged[key] = { peerId: input.responderId, identityKey, outcome: input.outcome, version: input.version, role: 'author', lastExchangedAt: input.respondedAt };
        }
        break;
      }
    }
    const entries = ledgerEntries(doc);
    const changed = Object.fromEntries(Object.entries(entries).filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value)));
    const removed = Object.keys(before).filter((key) => !(key in entries));
    if (Object.keys(changed).length) await this.collections.upsert('talkLedger', changed);
    if (removed.length) await this.collections.remove('talkLedger', removed);
    return { entries, ...(gate ? { gate } : {}), ...(response ? { response } : {}) };
  }
}

/** OPEN-91 P4: attachment shares and what an exchange records. */
import { attachmentShareKeyPayload, attachmentShareMessageId, attachmentSharePayload, parseAttachmentShareMessageText } from '../../core/attachment-share';
import { authorLedgerWritesFor, exchangeRecordFor, type ExchangeInput } from '../../core/exchange-recording';

const attachment = { cid: 'bafy1', name: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 10, enc: 'sea-pair' } as any;
const NOW = '2026-10-26T10:00:00.000Z';

describe('attachment shares', () => {
  it('builds the share with an encrypted key envelope, keeps its id stable, and reads it back from text', async () => {
    expect(attachmentShareKeyPayload('t1', 'ann', attachment)).toMatchObject({ kind: 'ipfs-share-key-v1', cid: 'bafy1', talkRef: 't1::ann' });
    const share = attachmentSharePayload({ conversationId: 'c1', talkId: 't1', authorId: 'ann', attachment }, 'CIPHER', NOW);
    expect(share).toMatchObject({ kind: 'ipfs-auto-share-v1', link: 'ipfs://bafy1', keyCiphertext: 'CIPHER', sharedAt: NOW });
    expect(await attachmentShareMessageId('c1', 't1', 'ann', 'bafy1')).toBe(await attachmentShareMessageId('c1', 't1', 'ann', 'bafy1'));
    expect(parseAttachmentShareMessageText(`IPFS_SHARE:${JSON.stringify(share)}`)).toEqual(share);
    expect(parseAttachmentShareMessageText('hello')).toBeNull();
    expect(parseAttachmentShareMessageText(`IPFS_SHARE:${JSON.stringify({ ...share, keyCiphertext: '' })}`)).toBeNull();
  });
});

describe('exchange recording', () => {
  const talk = { title: 'Tennis', type: 'tag', questions: [{ id: 'q1', text: 'Likes', answers: [{ id: 'a', text: 'Tennis' }] }] };
  const input = (overrides: Partial<ExchangeInput> = {}): ExchangeInput => ({
    peerId: 'bob', peerName: 'Bob', talkId: 't1', talkData: talk, outcome: 'match', nowIso: NOW,
    room: { roomId: 'nearby-v3', roomName: 'Nearby' }, ...overrides,
  });

  it('records one exchange per direction, with its place and response fields', () => {
    expect(exchangeRecordFor(input({ meta: { responseId: 'r1', version: 2, direction: 'received' } }))).toMatchObject({
      peerId: 'bob', talkId: 't1', direction: 'received', roomId: 'nearby-v3', responseId: 'r1', version: 2, date: NOW, outcome: 'match',
    });
  });

  it('writes the ledger only for an answer to a Talk of mine', () => {
    expect(authorLedgerWritesFor(input({ meta: { direction: 'received' } }), 'me')).toBeNull();
    const writes = authorLedgerWritesFor(input({ meta: { answers: [{ answerId: 'a' }] } }), 'me')!;
    expect(writes.event).toMatchObject({ kind: 'TALK_ANSWERED', responderId: 'bob', authorId: 'me', outcome: 'matched', version: 1, responseId: 'resp_t1_bob' });
    expect(authorLedgerWritesFor(input({ outcome: 'mismatch' }), 'me')!.exchanged.identityKeys).toHaveLength(1);
  });
});

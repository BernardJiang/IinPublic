/** @jest-environment node */

// OPEN-106 step 3: who I already exchanged what with, from the device graph (REQ-LEDGER-16). It
// replaced the sender's talk ledger: suppression, the send limit, and how each answer was decided.

import { memoryNodeStore } from '../../core/device-graph/node-store';
import { createDeviceGraph } from '../../core/device-graph/device-graph';
import { answeredAtoms, exchangeAtoms, planOffer, weekDaysUpTo, TALK_SEND_DAILY } from '../../core/device-graph/exchanged';
import { buildTagIdentityKeys } from '../../shared/tag-identity';
import { commitResponse } from '../../core/response-commit';
import { DeliveryStore } from '../../core/delivery';
import { memoryGraphStore } from '../../core/graph-store';
import { coExchangedPeers, resetExchangeStateForTests, talkOwedToPeer } from '../../web/services/exchange-state';

/* eslint-disable @typescript-eslint/no-explicit-any */

const flow = (text: string) => ({
  type: 'flow', language: 'en', title: 'T',
  questions: [{ id: 'q_0', text, answers: [{ id: 'a', text: 'Yes', isMatch: true, isTerminal: true }, { id: 'b', text: 'No', isIgnore: true, isTerminal: true }] }],
});
const tags = (...words: string[]) => ({
  type: 'tag', language: 'en', title: 'Interests',
  questions: [{ id: 'q_0', text: 'Interests', answers: words.map((w, i) => ({ id: `a${i}`, text: w, isMatch: true })) }],
});
const keyword = (word: string) => ({
  type: 'tag', language: 'en', title: word,
  questions: [{ id: 'q_0', text: word, answers: [{ id: 'a', text: 'Like', isMatch: true }, { id: 'b', text: 'Pass', isIgnore: true }] }],
});

function setup() {
  let clock = Date.UTC(2026, 10, 4, 10); // a Wednesday
  const store = memoryNodeStore();
  const graph = createDeviceGraph(store, { randomBytes: (n) => new Uint8Array(n).fill(3), now: () => clock });
  return { store, graph, exchange: graph.exchange, tick: (ms: number) => { clock += ms; }, now: () => clock };
}

describe('exchange atoms', () => {
  it('a flow is its situations; the same content in another Talk is the same atoms', () => {
    const a = exchangeAtoms(flow('Tennis?'));
    expect(a).toHaveLength(1);
    expect(exchangeAtoms({ ...flow('Tennis?'), title: 'Other title' })).toEqual(a);
    expect(exchangeAtoms(flow('Chess?'))).not.toEqual(a);
  });

  it('a tag Talk is its tags, each with the key an offer leaves it out by', () => {
    const atoms = exchangeAtoms(tags('Tennis', 'Chess'));
    expect(atoms.map((a) => a.omitKey)).toEqual(buildTagIdentityKeys(tags('Tennis', 'Chess'), ''));
    // The same tag word in anyone's Talk is the same atom, a one-keyword tag too, whatever the case.
    expect(exchangeAtoms(tags('Chess', 'Golf'))[0]!.atom).toBe(atoms[1]!.atom);
    expect(exchangeAtoms(keyword('tennis'))).toEqual([{ atom: atoms[0]!.atom }]);
  });

  it('an answer passes the tags chosen in a tag Talk, any other Talk whole', () => {
    const atoms = exchangeAtoms(tags('Tennis', 'Chess'));
    expect(answeredAtoms(tags('Tennis', 'Chess'), ['a0'])).toEqual([atoms[0]]);
    expect(answeredAtoms(flow('Tennis?'), ['b'])).toEqual(exchangeAtoms(flow('Tennis?')));
  });
});

describe('the offer rule', () => {
  const atoms = exchangeAtoms(tags('Tennis', 'Chess'));
  it('a version they have is not sent again; an older one is replaced whole', () => {
    expect(planOffer({ versionId: 'v1', sentVersion: 'v1', atoms, has: () => false })).toEqual({ send: false, reason: 'sent' });
    expect(planOffer({ versionId: 'v2', sentVersion: 'v1', atoms, has: () => true })).toEqual({ send: true, revision: true });
  });

  it('a Talk all of whose parts they have is not sent; a tag Talk leaves out the tags they have', () => {
    expect(planOffer({ versionId: 'v1', atoms, has: () => true })).toEqual({ send: false, reason: 'exchanged' });
    expect(planOffer({ versionId: 'v1', atoms, has: (a) => a === atoms[1]!.atom })).toEqual({ send: true, omit: [atoms[1]!.omitKey] });
    expect(planOffer({ versionId: 'v1', atoms, has: () => false })).toEqual({ send: true });
  });
});

describe('the exchange index', () => {
  it('records offers, arrivals and answers per person; answers alone count as exchanged answers', async () => {
    const { exchange } = setup();
    const tennis = exchangeAtoms(tags('Tennis', 'Chess'));
    await exchange.recordOffer('jerry', 't1', 'v1', tennis, [tennis[1]!.omitKey!]);
    expect(Object.keys(await exchange.exchanged('jerry'))).toEqual([tennis[0]!.atom]);
    await exchange.recordArrival('bob', 'v9', exchangeAtoms(flow('Golf?')));
    // A tag Talk's tags do not pass by arriving: only once answered.
    await exchange.recordArrival('cy', 'v8', exchangeAtoms(tags('Tennis', 'Chess')));
    await exchange.recordAnswer('bob', 'ans1', exchangeAtoms(flow('Golf?')));
    const state = await exchange.state();
    expect(state.jerry).toEqual({ exchanged: [tennis[0]!.atom], answered: [] });
    expect(state.bob!.answered).toEqual(exchangeAtoms(flow('Golf?')).map((a) => a.atom));
    expect(state.cy).toBeUndefined();
  });

  it('a deleted Talk’s parts leave the index, so it can be exchanged again', async () => {
    const { graph, exchange } = setup();
    const talk = flow('Tennis?');
    const talkId = await graph.talks.create(talk);
    const version = (await graph.talks.read(talkId))!.versionId;
    await exchange.recordOffer('jerry', talkId, version, exchangeAtoms(talk));
    await exchange.recordOffer('jerry', 'other', 'v-other', exchangeAtoms(flow('Chess?')));
    await exchange.forgetTalk(talkId, ['jerry']);
    expect(Object.keys(await exchange.exchanged('jerry'))).toEqual(exchangeAtoms(flow('Chess?')).map((a) => a.atom));
  });

  it('the send limit counts distinct Talks per person per UTC day and week; a Talk counted today is free', async () => {
    const { exchange, tick } = setup();
    for (let i = 0; i < TALK_SEND_DAILY; i++) await exchange.recordOffer('jerry', `t${i}`, `v${i}`, []);
    expect(await exchange.withinLimit('jerry', 'new')).toEqual({ send: false, reason: 'daily_talk_send_rate_limit' });
    expect(await exchange.withinLimit('jerry', 't3')).toEqual({ send: true });
    expect(await exchange.withinLimit('jerry', 'new', true)).toEqual({ send: true });
    expect(await exchange.withinLimit('bob', 'new')).toEqual({ send: true });
    tick(86_400_000);
    expect(await exchange.withinLimit('jerry', 'new')).toEqual({ send: true });
    expect(weekDaysUpTo(Date.UTC(2026, 10, 4))).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
  });

  it('keeps how I decided each answer to my Talk, and my own answer to theirs', async () => {
    const { exchange } = setup();
    await exchange.setOutcome('t1', 'jerry', { outcome: 'ignored', version: 1, responseId: 'r1', respondedAt: 'x' });
    await exchange.setOutcome('t1', 'bob', { outcome: 'matched', version: 2, responseId: 'r2', respondedAt: 'y' });
    expect(await exchange.outcomes('t1')).toEqual({ jerry: 'ignored', bob: 'matched' });
    expect(await exchange.outcome('t1', 'bob')).toEqual({ outcome: 'matched', version: 2, responseId: 'r2', respondedAt: 'y' });
    expect(await exchange.responded('t1', 'tom')).toBeUndefined();
  });
});

describe('committing my answer', () => {
  const talk = flow('Tennis?');
  const input = (answerId: string) => ({
    talkId: 't1', talkData: talk, answers: [{ questionId: 'q_0', answerId }], authorId: 'tom', authorName: 'Tom',
    responderId: 'me', payloadCiphertext: `SEA${JSON.stringify({ ct: 'Y'.repeat(32), iv: 'Y'.repeat(16), s: 'Y'.repeat(12) })}`, submittedAt: '2026-11-04T10:00:00.000Z',
  });

  it('the same answer keeps its version; a different one is the next, a change of mind', async () => {
    const { exchange } = setup();
    const deps = { delivery: new DeliveryStore(memoryGraphStore()), exchange, retracted: async () => false };
    const first = await commitResponse(input('a'), deps);
    expect(first).toMatchObject({ isMatch: true, isContentChange: false, payload: { version: 1 } });
    expect((await commitResponse(input('a'), deps)).payload.version).toBe(1);
    const changed = await commitResponse(input('b'), deps);
    expect(changed).toMatchObject({ isMatch: false, isContentChange: true, payload: { version: 2 } });
    expect(await exchange.responded('t1', 'tom')).toMatchObject({ outcome: 'ignored', version: 2 });
  });

  it('a Talk its author deleted is not answered', async () => {
    const { exchange } = setup();
    await expect(commitResponse(input('a'), { delivery: new DeliveryStore(memoryGraphStore()), exchange, retracted: async () => true }))
      .rejects.toThrow('retracted');
  });
});

describe('the screens’ view', () => {
  afterEach(() => resetExchangeStateForTests());

  it('owes a Talk until this version or all its parts passed; co-exchangers are those an answer passed with', () => {
    const talk = tags('Tennis', 'Chess');
    const [tennis, chess] = exchangeAtoms(talk).map((a) => a.atom);
    resetExchangeStateForTests({
      peers: { jerry: { exchanged: [tennis!], answered: [chess!] }, bob: { exchanged: [tennis!, chess!], answered: [] } },
      talks: { t1: { versionId: 'v2', sent: { ann: 'v2', cy: 'v1' } } },
    });
    expect(talkOwedToPeer('jerry', 't1', talk)).toBe(true); // Chess never passed
    expect(talkOwedToPeer('bob', 't1', talk)).toBe(false);
    expect(talkOwedToPeer('ann', 't1', talk)).toBe(false); // has this version
    expect(talkOwedToPeer('cy', 't1', talk)).toBe(true); // an older version: the edit is owed
    expect(coExchangedPeers(talk)).toEqual(['jerry']);
  });
});

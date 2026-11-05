/** @jest-environment node */

// OPEN-106 step 2e (iv): the incoming list is built from graph arrivals the app accepted. The same
// Talk content from several senders is one row with every sender; an arrival the app refused is
// not listed; a Talk its author deleted leaves the list; tags left out stay left out.

import { memoryNodeStore } from '../../core/device-graph/node-store';
import { createDeviceGraph } from '../../core/device-graph/device-graph';
import { formatEventId } from '../../core/device-graph/event-id';
import { createIncomingList } from '../../core/device-graph/sync/incoming-list';
import { buildTagIdentityKeys } from '../../shared/tag-identity';

/* eslint-disable @typescript-eslint/no-explicit-any */

const tennis = (title = 'Tennis partner') => ({
  title, type: 'flow', language: 'en', isAdult: false,
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: [{ id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' }, { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true }] },
    { id: 'q_1', text: 'How often do you play?', answers: [{ id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true }, { id: 'a_1_1', text: 'Daily', isIgnore: true, isTerminal: true }] },
  ],
});

let counter = 1;
function setup() {
  let clock = Date.parse('2026-11-04T10:00:00.000Z');
  const store = memoryNodeStore();
  const graph = createDeviceGraph(store, { randomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 13 + 5) % 256), now: () => (clock += 1000) });
  const list = createIncomingList({ store, graph });
  async function receive(author: string, talk: any = tennis(), talkId?: string) {
    const when = Date.parse('2026-11-04T09:00:00.000Z');
    const device = (author.charCodeAt(0) % 16).toString(16).repeat(32);
    const id = talkId ?? formatEventId({ when, deviceId: device, counter: counter++ });
    await graph.arrivals.receive({ talkId: id, versionId: id, authorId: author, when, device, talk }, { userId: author });
    return id;
  }
  return { graph, list, receive };
}

describe('the incoming list from graph arrivals', () => {
  it('lists accepted arrivals only, one row per content with every sender', async () => {
    const d = setup();
    const fromAdam = await d.receive('adam');
    const fromBea = await d.receive('bea');
    const refused = await d.receive('carl', tennis('Chess'));
    await d.list.accept(fromAdam, 'adam', 'Adam');
    await d.list.accept(fromBea, 'bea', 'Bea');
    void refused; // the app's filters refused it: never accepted

    const rows = await d.list.rows();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(Object.keys(row!.senders).sort()).toEqual(['adam', 'bea']);
    expect(row!.senders.adam).toMatchObject({ senderName: 'Adam', lastTalkId: fromAdam });
    expect(Object.keys(row!.talkIds).sort()).toEqual([fromAdam, fromBea].sort());
    expect(row!.title).toBe('Tennis partner');
    expect(JSON.parse(row!.questionsJson!)).toHaveLength(2);
  });

  it('a Talk its author deleted leaves the list', async () => {
    const d = setup();
    const talkId = await d.receive('adam');
    await d.list.accept(talkId, 'adam', 'Adam');
    expect(await d.list.rows()).toHaveLength(1);
    await d.graph.arrivals.receiveDeletion({ talkId, eventId: formatEventId({ when: Date.now(), deviceId: '1'.repeat(32), counter: 99 }), authorId: 'adam', when: Date.now(), device: '1'.repeat(32) });
    expect(await d.list.rows()).toHaveLength(0);
  });

  it('a row keeps the tags left out of what I was asked', async () => {
    const d = setup();
    // A tag Talk: one question, each answer a tag (`filterTalkForRecipient`).
    const tags = {
      title: 'Hobbies', type: 'tag', language: 'en', isAdult: false,
      questions: [{ id: 'q_0', text: 'Hobbies', answers: [{ id: 'a0', text: 'Tennis', isMatch: true }, { id: 'a1', text: 'Chess', isMatch: true }] }],
    };
    const [tennisKey] = buildTagIdentityKeys({ type: 'tag', questions: [{ answers: [{ text: 'tennis' }] }] }, 'whole');
    const talkId = await d.receive('adam', tags);
    await d.list.accept(talkId, 'adam', 'Adam', [tennisKey!]);
    const [row] = await d.list.rows();
    expect(JSON.parse(row!.questionsJson!)[0].answers.map((a: any) => a.text)).toEqual(['Chess']);
  });
});

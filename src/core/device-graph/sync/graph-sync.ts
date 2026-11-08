/**
 * Talk exchange by Gun sync (spec §31.9, REQ-GRAPH-30..35; design: docs/design/device-graph.md,
 * "Talk exchange by Gun sync"). The direct link between two people (WebRTC, LAN, Wi-Fi Direct) is
 * a Gun peer of the device core's Gun, so Gun itself carries the graph; the hub never does (D1, D3).
 *
 * What travels, all encrypted (owner decision 2026-11-03):
 * - A Talk version is written once, as nodes, under a random tag and a random key `K`
 *   (`wire-names.ts`). Each step is two values: `ref` (ids, choice keys, routing; no text) and
 *   `text`. A receiver that already holds a question and its choices skips the text (D4, D5).
 * - Everything I send one person goes into that pair's log, encrypted with the pair secret (ECDH of
 *   our keys): an offer (the version's tag and `K`), my answer to their Talk (keys only), my deletion
 *   of a Talk or an answer. Entries are numbered from 0, each carries the hash of the one before
 *   and my signature, so the receiver can prove order and completeness (REQ-GRAPH-34).
 *
 * Nothing is sent while two people are apart (D2): on connect each side subscribes to the other's
 * log head and reads the entries it has not applied (REQ-GRAPH-31); Gun answers only what is asked.
 * The outgoing audience filter (`sharing-policy.ts`, `audience.ts`) keeps every soul on its pair's
 * link (REQ-GRAPH-32).
 */
import { getKeyedMany, putKeyed, readKeyed } from '../keyed-buckets';
import { portableSha256Hex } from '../../../shared/portable-sha256';
import { talkGrammarErrors } from '../../../shared/grammar-filter';
import type { AnswerSetEntry } from '../keys';
import { canonicalJson, answerKey, questionKey } from '../keys';
import type { createAnswerGraph } from '../answers';
import type { createArrivalGraph } from '../arrivals';
import type { createTalkGraph, EventIds } from '../talk-events';
import type { EventChainSigner } from '../chain';
import { putEvent } from '../events';
import { addToIndex } from '../index-buckets';
import { gunNodeStore, link, linkSoul, type GraphNode, type NodeStore } from '../node-store';
import { GRAPH_SCHEMA_VERSION, graphSouls, talkStructureKey, talkStructureOf, type StructureQuestion, type TalkStructure } from '../talk-structure';
import { personIdOf, personSoul, personWrites } from '../people-graph';
import { parseEventId } from '../event-id';
import { createGraphAudience } from './audience';
import { LOG_BLOCK, graphWireSouls, pairTagOf } from './wire-names';

/** A chat message body is small and well-formed: bounded text, a sane conv id, a real event id. */
export const MESSAGE_TEXT_MAX = 4000;
export const MESSAGE_CONV_MAX = 200;
const validMessage = (message: { conv?: unknown; text?: unknown; eventId?: unknown }): message is { conv: string; text: string; eventId: string; re?: string } =>
  typeof message.conv === 'string' && message.conv.length > 0 && message.conv.length <= MESSAGE_CONV_MAX && !message.conv.includes('/')
  && typeof message.text === 'string' && message.text.length <= MESSAGE_TEXT_MAX
  && (message.eventId === undefined || (typeof message.eventId === 'string' && parseEventId(message.eventId) != null));

/** Conversation state-node soul; conv ids are URL-encoded everywhere (state, indexes, markers). */
const convSoulOf = (souls: ReturnType<typeof graphSouls>, conv: string): string => souls.mine(`conv/${encodeURIComponent(conv)}`);

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SeaPair = { pub: string; priv: string; epub: string; epriv: string };

/** Crypto the host provides (SEA on every host; signatures with `portable-ecdsa`). */
export type GraphCrypto = {
  secret(peerEpub: string, myPair: SeaPair): Promise<string | undefined>;
  /** SEA ciphertext (`SEA{"ct":…,"iv":…,"s":…}`) of `data` under `key`. */
  encrypt(data: string, key: string): Promise<string>;
  decrypt(data: string, key: string): Promise<unknown>;
  sign(message: string, priv: string): Promise<string>;
  verify(signature: string, message: string, pub: string): Promise<boolean>;
  randomHex(bytes: number): string;
};

export type PeerKeys = { pub: string; epub: string };

/** What a log entry carries. No `kind`: what it is follows from the field present (REQ-GRAPH-20). */
export type LogBody =
  | { offer: { talkId: string; versionId: string; talkTag: string; key: string; context?: Record<string, unknown> } }
  | { answer: { talkId: string; versionId?: string; eventId: string; when: number; device: string; mode: string; set: Record<string, AnswerSetEntry>; replaces?: string; context?: Record<string, unknown>;
    /** The offer log entry this answer replies to (`n` and hash), linking the exchange's sides (REQ-GRAPH-44). */
    reEntry?: { n: number; hash: string } } }
  | { deleted: { talkId: string; eventId: string; when: number; device: string; versionId?: string } }
  | { deletedAnswer: { talkId: string; eventId: string; answerEventId: string; when: number; device: string } }
  /** My intake refused their Talk (its age gate, language, the receiving limit): it is not mine. */
  | { declined: { talkId: string; versionId?: string; when: number } }
  /** A chat message (OPEN-110, REQ-GRAPH-49): `conv` is the conversation id, `eventId` the sender's
   * own message event, `re` the sender's last seen message event (REQ-GRAPH-24 ordering hint). */
  | { message: { conv: string; text: string; eventId: string; re?: string } };

type LogEntry = { n: number; prev: string; when: number; by: string; body: LogBody; sig: string };

export type GraphSyncEvents = {
  /** A Talk (or a new version of one) arrived from this person and is stored. */
  onTalk?: (talkId: string, fromUserId: string, context?: Record<string, unknown>) => void;
  onTalkDeleted?: (talkId: string, fromUserId: string) => void;
  /** Someone answered (or changed their answer to) my Talk. */
  onAnswer?: (talkId: string, fromUserId: string, eventId: string, context?: Record<string, unknown>) => void;
  onAnswerDeleted?: (talkId: string, fromUserId: string) => void;
  /** They refused my Talk at intake: it did not pass to them, and may be offered again later. */
  onDeclined?: (talkId: string, fromUserId: string) => void;
  /** The people my log has entries for that they have not read changed (`owed()`). */
  onOwedChange?: (owed: string[]) => void;
};

export type GraphLinkStatus = {
  peerUserId: string; open: boolean; sentUpTo: number; appliedUpTo: number; broken?: string; lastError?: string;
  /** Diagnostics: the last entry their head names, as this device holds it, and the entries of
   * their first log block it holds. */
  theirHead?: number; theirBlock?: string[];
  /** How far into my log they say they have applied (their head's `read`). */
  theirRead?: number;
  /** The last signed acknowledgement of theirs I verified (REQ-GRAPH-45): their clock's `when`
   * against my entry's (`skewMs` = ack.when − entry.when). */
  lastAck?: { n: number; when: number; skewMs: number };
};

const entryHash = (entry: LogEntry) => portableSha256Hex(canonicalJson(entry));
const signedPart = (entry: Omit<LogEntry, 'sig'>) => canonicalJson({ n: entry.n, prev: entry.prev, when: entry.when, by: entry.by, body: entry.body });

export function createGraphSync(options: {
  gun: any;
  /** The device graph, by exact soul, on the same Gun. */
  store: NodeStore;
  me: { userId: string; pair: SeaPair };
  crypto: GraphCrypto;
  /** A person's public keys, from their public user record. */
  peerKeys: (userId: string) => Promise<PeerKeys | undefined>;
  graph: { talks: ReturnType<typeof createTalkGraph>; arrivals: ReturnType<typeof createArrivalGraph>; answers: ReturnType<typeof createAnswerGraph> };
  /** The device's event id source and chain signer (chat message events, OPEN-110); without them
   * `sendMessage` throws and an incoming message is logged and skipped. */
  ids?: EventIds;
  chain?: EventChainSigner;
  events?: GraphSyncEvents;
  prefix?: string;
  now?: () => number;
  log?: (message: string) => void;
  /** How long a read of the other person's souls waits for their link to answer. */
  remoteReadMs?: number;
}) {
  const { gun, store, me, crypto, graph } = options;
  const prefix = options.prefix ?? 'local/';
  const souls = graphSouls(prefix);
  const now = options.now ?? Date.now;
  const root = gun._;
  const audience = createGraphAudience(store, { me: me.userId, prefix });
  root.opt.graphAudience = audience;
  /**
   * Delivery receipts: the last entry I wrote to each person's log until they say (their head's
   * `read`) they applied it. The page keeps a link wanted while someone is owed (as the Talk
   * outbox did for frames).
   */
  const owedSoul = `${prefix}sync/owed`;
  const owed = new Map<string, number>();
  // Reads of the other person's souls go over the link, so they wait longer than local reads.
  // On a phone a read crosses page → frame → the other page → its core and back, often over 1.5 s.
  const remote = gunNodeStore(gun, { readWaitMs: options.remoteReadMs ?? 400, missWaitMs: options.remoteReadMs ?? 4000, getTimeoutMs: 12_000 });
  const mine = graphWireSouls(me.userId);

  type Link = {
    peer: any; keys: PeerKeys; secret: string; pairTag: string; off?: () => void;
    processing?: Promise<void> | undefined; again?: boolean;
    /** A stalled log (an entry or its Talk not readable yet) is read again after this many ms. */
    retryMs?: number | undefined; retryTimer?: ReturnType<typeof setTimeout> | undefined;
    lastError?: string | undefined;
    /** The `read` value last written to my head for this pair. */
    readMarked?: number;
    /** Log blocks with a live subscription: a once-read lease expires, and later writes to the
     * same block would then be refused as unasked-for and never fetched again from the cache. */
    watched?: Map<string, any>;
  };
  const links = new Map<string, Link>();
  const secrets = new Map<string, { keys: PeerKeys; secret: string; pairTag: string }>();
  /** The last signed acknowledgement each person sent that verified (REQ-GRAPH-43/45). */
  const lastAcks = new Map<string, { n: number; when: number; skewMs: number }>();
  const outbox: Array<{ to: string; raw: string }> = [];
  let wake: (() => void) | undefined;
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
    queues.set(key, run.catch(() => undefined));
    return run;
  };

  async function pairWith(peerUserId: string): Promise<{ keys: PeerKeys; secret: string; pairTag: string }> {
    const known = secrets.get(peerUserId);
    if (known) return known;
    const keys = await options.peerKeys(peerUserId);
    if (!keys?.pub || !keys.epub) throw new Error(`no public keys for ${peerUserId}`);
    const secret = await crypto.secret(keys.epub, me.pair);
    if (!secret) throw new Error(`no pair secret with ${peerUserId}`);
    const pair = { keys, secret, pairTag: pairTagOf(secret) };
    secrets.set(peerUserId, pair);
    audience.setPair(peerUserId, pair.pairTag);
    return pair;
  }

  const encryptJson = (value: unknown, key: string) => crypto.encrypt(JSON.stringify(value), key);
  async function decryptJson<T>(value: unknown, key: string): Promise<T | undefined> {
    if (typeof value !== 'string') return undefined;
    const plain = await crypto.decrypt(value, key);
    if (plain === undefined || plain === null) return undefined;
    if (typeof plain === 'string') { try { return JSON.parse(plain) as T; } catch { return undefined; } }
    return plain as T;
  }

  // ---- sending -------------------------------------------------------------------------------

  /** Append one entry to my log for this person. Serialized per person; returns its number. */
  function append(peerUserId: string, body: LogBody): Promise<number> {
    return serial(`out:${peerUserId}`, async () => {
      const { secret, pairTag } = await pairWith(peerUserId);
      const stateSoul = `${prefix}sync/out/${encodeURIComponent(peerUserId)}`;
      const state = await store.get(stateSoul);
      const n = typeof state?.n === 'number' ? state.n + 1 : 0;
      const unsigned = { n, prev: typeof state?.hash === 'string' ? state.hash : '', when: now(), by: me.userId, body };
      const entry: LogEntry = { ...unsigned, sig: await crypto.sign(signedPart(unsigned), me.pair.priv) };
      const hash = entryHash(entry);
      const [cipher, head] = await Promise.all([encryptJson(entry, secret), encryptJson({ n, hash }, secret)]);
      await Promise.all([
        store.put(mine.logBlock(pairTag, Math.floor(n / LOG_BLOCK)), { [String(n)]: cipher }),
        store.put(mine.head(pairTag), { head }),
        store.put(stateSoul, { n, hash }),
        store.put(owedSoul, { [peerUserId]: n }),
      ]);
      owed.set(peerUserId, n);
      options.events?.onOwedChange?.([...owed.keys()]);
      return n;
    });
  }

  /** The wire nodes of one version of my Talk, written once; returns its tag and key. */
  async function publishVersion(talkId: string, versionId: string): Promise<{ talkTag: string; key: string }> {
    return serial(`version:${versionId}`, async () => {
      const recordSoul = `${prefix}sync/version/${versionId}`;
      const known = await store.get(recordSoul);
      if (typeof known?.tag === 'string' && typeof known.key === 'string') return { talkTag: known.tag, key: known.key };
      const talk = await graph.talks.readVersion(talkId, versionId);
      const event = await store.get(souls.event(versionId));
      if (!talk || !event) throw new Error(`no version ${versionId} of Talk ${talkId}`);
      const talkTag = crypto.randomHex(16);
      const key = crypto.randomHex(32);
      const structure = talkStructureOf(talk);
      const head: Record<string, unknown> = {
        talkId, versionId, when: Number(event.when), device: String(event.device ?? ''),
        revKey: talkStructureKey(structure), n: structure.questions.length,
        type: structure.type, language: structure.language, grammar: structure.grammar,
        title: talk.title, isAdult: talk.isAdult,
      };
      const previous = linkSoul(event.re);
      if (previous) head.previousVersionId = previous.slice(souls.event('').length);
      if (structure.matchThreshold !== undefined) head.matchThreshold = structure.matchThreshold;
      if (structure.collectionImportance) head.collectionImportance = structure.collectionImportance;
      if (talk.expiresAt !== undefined) head.expiresAt = talk.expiresAt;
      if (talk.locationRadiusMiles !== undefined) head.locationRadiusMiles = talk.locationRadiusMiles;
      if (talk.meta) head.meta = talk.meta;
      const steps = await Promise.all(structure.questions.map(async (question, i): Promise<[string, GraphNode]> => {
        const { text, answers, ...rest } = question;
        const ref = {
          ...rest,
          qKey: questionKey({ text, language: structure.language, selection: question.answerSelectionMode || 'single' }),
          answers: answers.map(({ text: answerText, ...a }) => ({ ...a, aKey: answerKey(answerText) })),
        };
        const texts = { q: text, a: Object.fromEntries(answers.map((a) => [a.id, a.text])) };
        return [mine.talkStep(talkTag, i), { ref: await encryptJson(ref, key), text: await encryptJson(texts, key) }];
      }));
      await Promise.all([
        ...steps.map(([soul, node]) => store.put(soul, node)),
        (async () => store.put(mine.talk(talkTag), { head: await encryptJson(head, key) }))(),
      ]);
      await store.put(recordSoul, { tag: talkTag, key, talk: talkId });
      return { talkTag, key };
    });
  }

  // ---- receiving -----------------------------------------------------------------------------

  /** Read one version of their Talk from its wire nodes (asking their link for what is missing). */
  async function fetchVersion(fromUserId: string, offer: { talkId: string; versionId: string; talkTag: string; key: string }) {
    const theirs = graphWireSouls(fromUserId);
    const headNode = await remote.get(theirs.talk(offer.talkTag));
    const head = await decryptJson<any>(headNode?.head, offer.key);
    if (!head || head.talkId !== offer.talkId || head.versionId !== offer.versionId) return undefined;
    const questions: StructureQuestion[] = [];
    for (let i = 0; i < Number(head.n); i += 1) {
      const node = await remote.get(theirs.talkStep(offer.talkTag, i));
      const ref = await decryptJson<any>(node?.ref, offer.key);
      if (!ref) return undefined;
      // Text is decrypted only for a question or choice this device has not stored (D5).
      let texts: { q: string; a: Record<string, string> } | undefined;
      const known = await store.get(souls.question(ref.qKey));
      const answerTexts: Record<string, string> = {};
      for (const answer of ref.answers as Array<{ id: string; aKey: string }>) {
        const stored = await store.get(souls.answer(answer.aKey));
        if (typeof stored?.text === 'string') answerTexts[answer.id] = stored.text;
      }
      if (typeof known?.text !== 'string' || Object.keys(answerTexts).length !== ref.answers.length) {
        texts = await decryptJson(node?.text, offer.key);
        if (!texts) return undefined;
      }
      const { qKey: _qKey, answers, ...rest } = ref;
      questions.push({
        ...rest,
        text: texts ? texts.q : String(known!.text),
        answers: (answers as any[]).map(({ aKey: _aKey, ...a }) => ({ ...a, text: texts ? texts.a[a.id] : answerTexts[a.id] })),
      });
    }
    const structure: TalkStructure = { type: head.type, language: head.language, grammar: head.grammar, questions };
    if (head.matchThreshold !== undefined) structure.matchThreshold = head.matchThreshold;
    if (head.collectionImportance) structure.collectionImportance = head.collectionImportance;
    const talk: any = { ...structure, title: head.title, isAdult: head.isAdult };
    if (head.expiresAt !== undefined) talk.expiresAt = head.expiresAt;
    if (head.locationRadiusMiles !== undefined) talk.locationRadiusMiles = head.locationRadiusMiles;
    if (head.meta && typeof head.meta === 'object') talk.meta = head.meta;
    // The structure must hash to what the signed head says (its integrity rides on the log).
    if (talkStructureKey(talkStructureOf(talk)) !== head.revKey) throw new Error(`Talk ${offer.talkId} does not match its structure key`);
    return { head, talk };
  }

  async function apply(fromUserId: string, keys: PeerKeys, entry: LogEntry, link: string): Promise<void> {
    const body = entry.body;
    if ('offer' in body) {
      const fetched = await fetchVersion(fromUserId, body.offer);
      if (!fetched) throw new Error(`Talk ${body.offer.talkId} has not arrived yet`);
      const { head, talk } = fetched;
      const result = await graph.arrivals.receive({
        talkId: body.offer.talkId, versionId: body.offer.versionId,
        ...(head.previousVersionId ? { previousVersionId: head.previousVersionId } : {}),
        authorId: fromUserId, authorPub: keys.pub, when: Number(head.when), device: String(head.device), talk,
      }, {
        userId: fromUserId, pub: keys.pub, link,
        // The log entry that carried the offer, so the answer can name it back (REQ-GRAPH-44).
        entry: { n: entry.n, hash: entryHash(entry), when: Number(entry.when) },
      });
      if (!result.ignored) options.events?.onTalk?.(body.offer.talkId, fromUserId, body.offer.context);
      else if (result.ignored === 'grammar') options.log?.(`[graph-sync] ignored Talk ${body.offer.talkId}: ${talkGrammarErrors(talk).length} grammar errors`);
    } else if ('answer' in body) {
      const answer = body.answer;
      const talk = answer.versionId ? await graph.talks.readVersion(answer.talkId, answer.versionId) : await graph.talks.read(answer.talkId);
      if (!talk) { options.log?.(`[graph-sync] answer to unknown Talk ${answer.talkId}`); return; }
      const ok = await graph.answers.receiveAnswer({
        talkId: answer.talkId, structure: talk, eventId: answer.eventId, byUser: fromUserId, when: answer.when, device: answer.device,
        mode: answer.mode, set: answer.set, ...(answer.replaces ? { replaces: answer.replaces } : {}),
        ...(answer.reEntry ? { reEntry: answer.reEntry } : {}),
      });
      if (ok) options.events?.onAnswer?.(answer.talkId, fromUserId, answer.eventId, answer.context);
      else options.log?.(`[graph-sync] answer ${answer.eventId} does not fit Talk ${answer.talkId}`);
    } else if ('deleted' in body) {
      const d = body.deleted;
      if (await graph.arrivals.receiveDeletion({ talkId: d.talkId, eventId: d.eventId, authorId: fromUserId, when: d.when, device: d.device, ...(d.versionId ? { versionId: d.versionId } : {}) })) {
        options.events?.onTalkDeleted?.(d.talkId, fromUserId);
      }
    } else if ('declined' in body) {
      options.events?.onDeclined?.(body.declined.talkId, fromUserId);
    } else if ('deletedAnswer' in body) {
      const d = body.deletedAnswer;
      if (await graph.answers.receiveAnswerDeletion({ talkId: d.talkId, eventId: d.eventId, byUser: fromUserId, when: d.when, device: d.device, answerEventId: d.answerEventId })) {
        options.events?.onAnswerDeleted?.(d.talkId, fromUserId);
      }
    } else if ('message' in body) {
      await receiveMessage(fromUserId, keys, body.message);
    }
  }

  /**
   * A chat message arrived (OPEN-110, REQ-GRAPH-49): like an arrival, the receiver writes its OWN
   * private event with its own clock — never shared — linked to the conversation's state node and,
   * through `re`, to the sender's message event (which this device never holds). The same sender
   * event arriving twice writes one event (REQ-GRAPH-22), deduped by the marker the first write
   * left under `ix/conv-seen/<convId>`.
   */
  async function receiveMessage(fromUserId: string, keys: PeerKeys, message: { conv: string; text: string; eventId: string; re?: string }): Promise<void> {
    if (!options.ids) { options.log?.(`[graph-sync] message from ${fromUserId} without an event id source installed`); return; }
    if (!validMessage(message)) { options.log?.(`[graph-sync] invalid message from ${fromUserId} dropped`); return; }
    const ids = options.ids;
    const convSoul = convSoulOf(souls, message.conv);
    const seenSoul = souls.index(`conv-seen/${encodeURIComponent(message.conv)}`);
    const seen = message.eventId ? linkSoul((await store.get(seenSoul))?.[message.eventId]) : undefined;
    if (seen) return; // applied already
    const conv = await store.get(convSoul);
    // A conv id is sender-chosen: one colliding with a conversation I have with someone ELSE is
    // an injection attempt (or an accident) — never merge a stranger's messages into it.
    if (conv && personIdOf(prefix, linkSoul(conv.with)) !== fromUserId) {
      options.log?.(`[graph-sync] message from ${fromUserId} names a conversation that is not theirs — dropped`);
      return;
    }
    const when = now();
    const eventId = await ids.next(when);
    const event: GraphNode = {
      v: GRAPH_SCHEMA_VERSION, when, device: await ids.deviceId(),
      with: link(personSoul(prefix, fromUserId)), conv: link(convSoul), text: message.text,
    };
    if (message.eventId) event.re = link(souls.event(message.eventId));
    const people = await personWrites(store, prefix, [{ userId: fromUserId, pub: keys.pub }], when);
    await Promise.all([
      ...people.map(([soul, node]) => store.put(soul, node)),
      putEvent(store, souls, eventId, event, options.chain),
      ...(conv ? [] : [store.put(convSoul, { with: link(personSoul(prefix, fromUserId)), startedAt: when })]),
      addToIndex(store, souls.index(`conv/${encodeURIComponent(message.conv)}`), { key: eventId, target: souls.event(eventId), when }, 'day'),
      store.put(souls.index('convs'), { [message.conv]: when }),
      ...(message.eventId ? [store.put(seenSoul, { [message.eventId]: link(souls.event(eventId)) })] : []),
    ]);
  }

  /**
   * Ask their link for one of their souls now. Gun answers a read from its cache once it holds the
   * soul, and a push sent while our link was down (reconnecting, or not yet open) is never sent
   * again: without a fresh ask, an entry their head names stayed unread for good (e2e mass/02).
   */
  function askFresh(link: Link, soul: string): void {
    try { root.opt.mesh.say({ '#': crypto.randomHex(9), get: { '#': soul } }, link.peer); } catch { /* the link is going away */ }
  }

  /** Apply every entry of their log I have not applied, in order, proving the chain. */
  function catchUp(peerUserId: string): Promise<void> {
    const link = links.get(peerUserId);
    if (!link) return Promise.resolve();
    if (link.processing) { link.again = true; return link.processing; }
    link.processing = (async () => {
      let stalled = false;
      do {
        link.again = false;
        stalled = await readLog(peerUserId, link).catch((error) => {
          link.lastError = (error as Error).message;
          options.log?.(`[graph-sync] ${peerUserId}: ${link.lastError}`);
          return true;
        });
        // Inside the loop: a receipt that lands while this check runs sets `again` too, and their
        // device writes each receipt once — read after the loop, it was lost (e2e 05-mailbox).
        await checkRead(peerUserId, link).catch(() => undefined);
      } while (link.again && links.get(peerUserId) === link);
      if (link.retryTimer) { clearTimeout(link.retryTimer); link.retryTimer = undefined; }
      if (stalled && links.get(peerUserId) === link) {
        // Not waiting for their next write: try again, backing off up to 30 s while the link is up.
        link.retryMs = Math.min(30_000, (link.retryMs ?? 500) * 2);
        link.retryTimer = setTimeout(() => {
          link.retryTimer = undefined;
          if (links.get(peerUserId) === link) askFresh(link, graphWireSouls(peerUserId).head(link.pairTag));
          void catchUp(peerUserId);
        }, link.retryMs);
        (link.retryTimer as { unref?: () => void }).unref?.();
      } else {
        link.retryMs = undefined;
      }
    })().finally(() => { link.processing = undefined; });
    return link.processing;
  }

  /** Returns true when the log is stalled: there is more to apply that could not be read yet. */
  async function readLog(peerUserId: string, link: Link): Promise<boolean> {
    const theirs = graphWireSouls(peerUserId);
    const stateSoul = `${prefix}sync/in/${encodeURIComponent(peerUserId)}`;
    const headNode = await remote.get(theirs.head(link.pairTag));
    const head = await decryptJson<{ n: number; hash: string }>(headNode?.head, link.secret);
    if (!head) return false;
    let state = await store.get(stateSoul);
    if (typeof state?.broken === 'string') return false;
    let next = typeof state?.next === 'number' ? state.next : 0;
    let prev = typeof state?.hash === 'string' ? state.hash : '';
    // A checkpoint the log owner signed after trimming (REQ-GRAPH-48): when I am behind it I can
    // start from it — nothing below the other person's last acknowledgement is on the wire anymore.
    const cp = await decryptJson<{ n: number; hash: string; when: number; sig: string }>(headNode?.cp, link.secret);
    if (cp && typeof cp.n === 'number' && next <= cp.n) {
      const ok = typeof cp.hash === 'string' && typeof cp.when === 'number' && typeof cp.sig === 'string'
        && await crypto.verify(cp.sig, canonicalJson({ n: cp.n, hash: cp.hash, when: cp.when }), link.keys.pub).catch(() => false);
      if (!ok) {
        const broken = `checkpoint ${cp.n} has a bad signature`;
        await store.put(stateSoul, { broken });
        options.log?.(`[graph-sync] log from ${peerUserId} broken: ${broken}`);
        return false;
      }
      next = cp.n + 1;
      prev = cp.hash;
      await store.put(stateSoul, { next, hash: prev });
      state = { next, hash: prev };
    }
    try {
      return await readEntries();
    } finally {
      // My head says how far I applied their log: their device stops wanting a link for it.
      await markRead(link, next - 1, prev).catch(() => undefined);
    }
    async function readEntries(): Promise<boolean> {
    while (next <= head!.n) {
      const blockSoul = theirs.logBlock(link.pairTag, Math.floor(next / LOG_BLOCK));
      link.watched ||= new Map();
      if (!link.watched.has(blockSoul)) {
        const chain = gun.get(blockSoul);
        chain.on(() => { void catchUp(peerUserId); });
        link.watched.set(blockSoul, chain);
      }
      const block = await remote.get(blockSoul);
      const entry = await decryptJson<LogEntry>(block?.[String(next)], link.secret);
      if (!entry) { askFresh(link, blockSoul); return true; } // not arrived yet: asked again, tried again shortly
      const broken = entry.n !== next ? `entry ${next} is numbered ${entry.n}`
        : entry.prev !== prev ? `entry ${next} does not follow entry ${next - 1}`
          : entry.by !== peerUserId ? `entry ${next} names another author`
            : !(await crypto.verify(entry.sig, signedPart(entry), link.keys.pub)) ? `entry ${next} has a bad signature` : '';
      if (broken) {
        // The timeline cannot be proven past this point: stop, keep what was applied, report.
        await store.put(stateSoul, { broken });
        options.log?.(`[graph-sync] log from ${peerUserId} broken: ${broken}`);
        return false;
      }
      await apply(peerUserId, link.keys, entry, 'webrtc');
      prev = entryHash(entry);
      next += 1;
      await store.put(stateSoul, { next, hash: prev });
      state = { next, hash: prev };
    }
    return false;
    }
  }

  /**
   * Write how far I applied their log into my head for this pair, once per new value (REQ-GRAPH-43):
   * a signed acknowledgement (`ack`, naming the entry's hash) for modern peers, and the unsigned
   * `read` for peers from before acknowledgements.
   */
  async function markRead(link: Link, n: number, hash: string): Promise<void> {
    if (n < 0 || link.readMarked === n) return;
    link.readMarked = n;
    const ack = { n, hash, when: now() };
    const signed = { ...ack, sig: await crypto.sign(canonicalJson(ack), me.pair.priv) };
    await store.put(mine.head(link.pairTag), {
      read: await encryptJson({ n }, link.secret),
      ack: await encryptJson(signed, link.secret),
    });
  }

  /**
   * Their head says how far they applied my log: clear what they owe me nothing more for. A signed
   * acknowledgement counts only when its signature verifies and its hash is my entry `n`'s hash;
   * the unsigned legacy `read` is still honoured for peers from before acknowledgements.
   */
  async function checkRead(peerUserId: string, link: Link): Promise<void> {
    const want = owed.get(peerUserId);
    if (want === undefined) return;
    const node = gun._.graph?.[graphWireSouls(peerUserId).head(link.pairTag)];
    const ack = await decryptJson<{ n: number; hash: string; when: number; sig: string }>(node?.ack, link.secret).catch(() => undefined);
    if (typeof ack?.n === 'number' && typeof ack.hash === 'string' && typeof ack.when === 'number' && typeof ack.sig === 'string'
      && await crypto.verify(ack.sig, canonicalJson({ n: ack.n, hash: ack.hash, when: ack.when }), link.keys.pub).catch(() => false)) {
      // The hash must commit to my own entry: read it back from my log and re-hash it.
      const block = await store.get(mine.logBlock(link.pairTag, Math.floor(ack.n / LOG_BLOCK))).catch(() => null);
      const entry = await decryptJson<LogEntry>(block?.[String(ack.n)], link.secret).catch(() => undefined);
      if (entry && entryHash(entry) === ack.hash) {
        await store.put(souls.index(`ack/${encodeURIComponent(peerUserId)}`), { [String(ack.n)]: JSON.stringify(ack) });
        lastAcks.set(peerUserId, { n: ack.n, when: ack.when, skewMs: ack.when - Number(entry.when) });
        if (ack.n >= want && owed.get(peerUserId) === want) {
          owed.delete(peerUserId);
          await store.put(owedSoul, { [peerUserId]: null });
          options.events?.onOwedChange?.([...owed.keys()]);
        }
      }
      return; // a modern peer's `ack` speaks; a tampered one clears nothing
    }
    const read = await decryptJson<{ n: number }>(node?.read, link.secret).catch(() => undefined);
    if (typeof read?.n !== 'number' || read.n < want || owed.get(peerUserId) !== want) return;
    owed.delete(peerUserId);
    await store.put(owedSoul, { [peerUserId]: null });
    options.events?.onOwedChange?.([...owed.keys()]);
  }

  // ---- links ---------------------------------------------------------------------------------

  return {
    audience,

    /** Load the grants. Call once before opening links. */
    async start(): Promise<void> {
      await audience.load();
      for (const [peer, n] of Object.entries((await store.get(owedSoul)) || {})) if (peer !== '_' && typeof n === 'number') owed.set(peer, n);
    },

    /** People my log has entries for that they have not read yet. */
    owed: (): string[] => [...owed.keys()],

    /** A direct link to this person is up: make it a Gun peer and catch up on their log. */
    async open(peerUserId: string): Promise<void> {
      if (links.has(peerUserId)) return;
      const pair = await pairWith(peerUserId);
      const peer: any = {
        id: `graph:${peerUserId}`,
        graphUserId: peerUserId,
        wire: { send: (raw: string) => { outbox.push({ to: peerUserId, raw }); wake?.(); } },
      };
      const link: Link = { peer, ...pair };
      links.set(peerUserId, link);
      root.opt.mesh.hi(peer);
      // A live subscription to their head: Gun asks their link, and later writes arrive by themselves.
      const chain = gun.get(graphWireSouls(peerUserId).head(pair.pairTag));
      const listener = () => { void catchUp(peerUserId); };
      chain.on(listener);
      link.off = () => chain.off();
      // A head I hold from an earlier link may be stale: what they wrote while we were apart.
      askFresh(link, graphWireSouls(peerUserId).head(pair.pairTag));
      await catchUp(peerUserId);
    },

    /** The link went down. */
    close(peerUserId: string): void {
      const link = links.get(peerUserId);
      if (!link) return;
      links.delete(peerUserId);
      if (link.retryTimer) clearTimeout(link.retryTimer);
      for (const chain of link.watched?.values() ?? []) chain.off();
      link.off?.();
      root.opt.mesh.bye(link.peer);
      delete root.opt.peers[link.peer.id];
    },

    /** A Gun message from this person's link. */
    hear(peerUserId: string, raw: string): void {
      const link = links.get(peerUserId);
      if (link) root.opt.mesh.hear(raw, link.peer);
    },

    /** Gun messages to send over links; waits up to `waitMs` when there are none. */
    async pull(waitMs = 0): Promise<Array<{ to: string; raw: string }>> {
      if (!outbox.length && waitMs > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { wake = undefined; resolve(); }, waitMs);
          wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
        });
      }
      return outbox.splice(0, outbox.length);
    },

    /** End a waiting `pull` now (the host has events to hand over). */
    wakePull(): void { wake?.(); },

    /**
     * Offer my Talk's latest version to these people. A person already offered this version is
     * skipped; an edit is a new version and is offered again (D14).
     */
    /**
     * Whether I hold this person's public keys, so their pair log can be written. Keys come from a
     * link that opened (`graph.open`); someone met only on a Nearby list has none yet.
     */
    async knows(peerUserId: string): Promise<boolean> {
      if (secrets.has(peerUserId)) return true;
      const keys = await options.peerKeys(peerUserId).catch(() => undefined);
      return !!keys?.pub && !!keys.epub;
    },

    async offerTalk(talkId: string, recipients: string[], context?: Record<string, unknown>): Promise<number> {
      const talk = await graph.talks.read(talkId);
      if (!talk) throw new Error(`no Talk ${talkId}`);
      const { talkTag, key } = await publishVersion(talkId, talk.versionId);
      // The version each person was last sent, in keyed buckets (`keyed-buckets.ts`).
      const sentSoul = `${prefix}sync/sent/${talkId}`;
      const sent = await getKeyedMany(store, sentSoul, recipients);
      const fresh = [...new Set(recipients)].filter((id) => id !== me.userId && sent[id] !== talk.versionId);
      await audience.grant(talkTag, fresh, now());
      for (const peerUserId of fresh) {
        await append(peerUserId, { offer: { talkId, versionId: talk.versionId, talkTag, key, ...(context ? { context } : {}) } });
        await putKeyed(store, sentSoul, { [peerUserId]: talk.versionId });
      }
      return fresh.length;
    },

    /**
     * Trim my pair log with this person below their last signed acknowledgement (REQ-GRAPH-48):
     * entries `n < ackN` go (Gun merge: null deletes), and a signed checkpoint
     * `cp: { n: ackN - 1, hash, when }` on my head lets a reader behind it start from the boundary.
     * Nothing they have not acknowledged is removed; without an ack, or with the boundary entry
     * unreadable, nothing is trimmed. When to trim (e.g. near a storage budget) is a later product
     * decision — this is the mechanism, triggered by the app or ops (`graph.trimLog`).
     */
    async trimLog(peerUserId: string): Promise<{ trimmed: number; checkpointN?: number }> {
      const ackNode = await store.get(souls.index(`ack/${encodeURIComponent(peerUserId)}`));
      const ackN = Math.max(-1, ...Object.keys(ackNode ?? {}).filter((k) => k !== '_' && /^\d+$/.test(k)).map(Number));
      if (ackN < 1) return { trimmed: 0 };
      const { secret, pairTag } = await pairWith(peerUserId);
      // The boundary entry is the last trimmed one: its hash is what the checkpoint commits to.
      const boundaryBlock = await store.get(mine.logBlock(pairTag, Math.floor((ackN - 1) / LOG_BLOCK)));
      const boundary = await decryptJson<LogEntry>(boundaryBlock?.[String(ackN - 1)], secret);
      if (!boundary) return { trimmed: 0 };
      const cp = { n: ackN - 1, hash: entryHash(boundary), when: now() };
      const sig = await crypto.sign(canonicalJson(cp), me.pair.priv);
      // Crash direction: the checkpoint lands BEFORE any entry is nulled. A crash after this put
      // leaves entries retained with a cp present (readers fast-forward and re-read them); the
      // reverse order could leave trimmed entries with no cp — a wiped reader stalls forever.
      await store.put(mine.head(pairTag), { cp: await encryptJson({ ...cp, sig }, secret) });
      const blocks = new Map<number, Record<string, null>>();
      for (let n = 0; n < ackN; n += 1) {
        const block = Math.floor(n / LOG_BLOCK);
        const fields = blocks.get(block) ?? {};
        fields[String(n)] = null;
        blocks.set(block, fields);
      }
      await Promise.all([...blocks].map(([block, fields]) => store.put(mine.logBlock(pairTag, block), fields)));
      // The ack index only needs its newest key: drop the ones the trim made useless. Housekeeping,
      // not correctness — best-effort, never fails the trim.
      store.put(souls.index(`ack/${encodeURIComponent(peerUserId)}`),
        Object.fromEntries(Object.keys(ackNode ?? {}).filter((k) => /^\d+$/.test(k) && Number(k) < ackN).map((k) => [k, null])))
        .catch(() => undefined);
      // Compatibility note: a reader that ignores `cp` (a legacy build) with state at or behind
      // the boundary stalls on the nulled entries — the ack gate means that peer APPLIED the data
      // already, but a wiped/restored legacy device would need it. Deliberate versioning
      // trade-off until capability negotiation exists.
      return { trimmed: ackN, checkpointN: cp.n };
    },

    /**
     * Send a chat message (OPEN-110, REQ-GRAPH-49 message half). My own event is written FIRST,
     * chained (`by` → me, asserted with `ownBy` — the original is written here, never copied):
     * `{ by, with, conv, text, re? }` per §31.5, with `conv` a link to the conversation's state
     * node (`mine/conv/<id>`, created once, never overwritten, per §31.6). Then the pair log
     * carries `{ message: { conv, text, eventId, re? } }`, encrypted and signed like every entry.
     * `re` is my last seen message event id of this conversation (REQ-GRAPH-24 ordering hint).
     */
    async sendMessage(peerUserId: string, conv: string, text: string, re?: string): Promise<{ eventId: string }> {
      if (!options.ids) throw new Error('no event id source installed');
      if (!validMessage({ conv, text })) throw new Error('invalid message (conv id or text out of bounds)');
      const ids = options.ids;
      await pairWith(peerUserId); // the link (keys + pair secret) must exist, as sendAnswer requires
      const when = now();
      const eventId = await ids.next(when);
      const convSoul = convSoulOf(souls, conv);
      const event: GraphNode = {
        v: GRAPH_SCHEMA_VERSION, when, device: await ids.deviceId(),
        by: link(personSoul(prefix, me.userId)), with: link(personSoul(prefix, peerUserId)),
        conv: link(convSoul), text,
      };
      if (re) event.re = link(souls.event(re));
      const [people, known] = await Promise.all([
        personWrites(store, prefix, [{ userId: me.userId }, { userId: peerUserId }], when),
        store.get(convSoul),
      ]);
      await Promise.all([
        ...people.map(([soul, node]) => store.put(soul, node)),
        putEvent(store, souls, eventId, event, options.chain, { ownBy: personSoul(prefix, me.userId) }),
        ...(known ? [] : [store.put(convSoul, { with: link(personSoul(prefix, peerUserId)), startedAt: when })]),
        addToIndex(store, souls.index(`conv/${encodeURIComponent(conv)}`), { key: eventId, target: souls.event(eventId), when }, 'day'),
        store.put(souls.index('convs'), { [conv]: when }),
      ]);
      await append(peerUserId, { message: { conv, text, eventId, ...(re ? { re } : {}) } });
      return { eventId };
    },

    /** Send my answer event to the Talk's author. */
    async sendAnswer(answerEventId: string, context?: Record<string, unknown>): Promise<void> {
      const event = await store.get(souls.event(answerEventId));
      const talkSoul = linkSoul(event?.talk);
      if (!event || !talkSoul) throw new Error(`no answer event ${answerEventId}`);
      const talkId = talkSoul.slice(souls.event('').length);
      const first = await store.get(talkSoul);
      const author = personIdOf(prefix, linkSoul(first?.by));
      if (!author) throw new Error(`Talk ${talkId} has no author on this device`);
      const set = await graph.answers.answerSet(answerEventId);
      if (!set) throw new Error(`answer ${answerEventId} has no answer set`);
      const received = await graph.arrivals.read(talkId);
      // Name the offer's log entry this answer replies to, so the author can link the sides
      // (REQ-GRAPH-44): the arrival of the version answered carries it.
      let reEntry: { n: number; hash: string } | undefined;
      if (received) {
        const arrival = await store.get(souls.event(received.latestArrival));
        if (typeof arrival?.entryN === 'number' && typeof arrival.entryHash === 'string') {
          reEntry = { n: arrival.entryN, hash: arrival.entryHash };
        }
      }
      const body: LogBody = {
        answer: {
          talkId, eventId: answerEventId, when: Number(event.when), device: String(event.device ?? ''), mode: String(event.mode ?? 'manual'), set,
          ...(received ? { versionId: received.versionId } : {}),
          ...(linkSoul(event.replaces) ? { replaces: linkSoul(event.replaces)!.slice(souls.event('').length) } : {}),
          ...(reEntry ? { reEntry } : {}),
          ...(context ? { context } : {}),
        },
      };
      await append(author, body);
    },

    /** Tell everyone I sent my Talk to that I deleted it, and stop serving its versions. */
    async sendTalkDeletion(talkId: string, deletionEventId: string): Promise<number> {
      const event = await store.get(souls.event(deletionEventId));
      if (!event?.deleted) throw new Error(`no deletion event ${deletionEventId}`);
      const sent = await readKeyed(store, `${prefix}sync/sent/${talkId}`);
      const recipients = Object.keys(sent).filter((id) => typeof sent[id] === 'string');
      const versionId = (linkSoul(event.re) || '').slice(souls.event('').length);
      for (const peerUserId of recipients) {
        await append(peerUserId, { deleted: { talkId, eventId: deletionEventId, when: Number(event.when), device: String(event.device ?? ''), ...(versionId ? { versionId } : {}) } });
      }
      return recipients.length;
    },

    /** Tell the author I deleted my answer to their Talk. */
    async sendAnswerDeletion(talkId: string, deletionEventId: string): Promise<void> {
      const event = await store.get(souls.event(deletionEventId));
      const answerEventId = (linkSoul(event?.re) || '').slice(souls.event('').length);
      if (!event?.deleted || !answerEventId) throw new Error(`no answer deletion ${deletionEventId}`);
      const first = await store.get(souls.event(talkId));
      const author = personIdOf(prefix, linkSoul(first?.by));
      if (!author) throw new Error(`Talk ${talkId} has no author on this device`);
      await append(author, { deletedAnswer: { talkId, eventId: deletionEventId, answerEventId, when: Number(event.when), device: String(event.device ?? '') } });
    },

    /**
     * Tell the author my intake refused their Talk, so their record of having passed it to me goes
     * (a refused Talk stays eligible once my filters or my age verification allow it).
     */
    async sendDecline(authorUserId: string, talkId: string, versionId?: string): Promise<void> {
      await append(authorUserId, { declined: { talkId, ...(versionId ? { versionId } : {}), when: now() } });
    },

    /** Read their log again (a test, or after a missed head update). */
    catchUp,

    async status(peerUserId: string): Promise<GraphLinkStatus> {
      const [out, incoming] = await Promise.all([
        store.get(`${prefix}sync/out/${encodeURIComponent(peerUserId)}`),
        store.get(`${prefix}sync/in/${encodeURIComponent(peerUserId)}`),
      ]);
      const status: GraphLinkStatus = {
        peerUserId, open: links.has(peerUserId),
        sentUpTo: typeof out?.n === 'number' ? out.n : -1,
        appliedUpTo: typeof incoming?.next === 'number' ? incoming.next - 1 : -1,
      };
      if (typeof incoming?.broken === 'string') status.broken = incoming.broken;
      const link = links.get(peerUserId);
      if (link?.lastError) status.lastError = link.lastError;
      const lastAck = lastAcks.get(peerUserId);
      if (lastAck) status.lastAck = lastAck;
      if (link) {
        const theirs = graphWireSouls(peerUserId);
        const graphNode = (soul: string) => gun._.graph?.[soul];
        const head = await decryptJson<{ n: number }>(graphNode(theirs.head(link.pairTag))?.head, link.secret).catch(() => undefined);
        if (head) status.theirHead = head.n;
        const read = await decryptJson<{ n: number }>(graphNode(theirs.head(link.pairTag))?.read, link.secret).catch(() => undefined);
        if (read) status.theirRead = read.n;
        status.theirBlock = Object.keys(graphNode(theirs.logBlock(link.pairTag, 0)) || {}).filter((k) => k !== '_');
      }
      return status;
    },

    openLinks: () => [...links.keys()],
  };
}

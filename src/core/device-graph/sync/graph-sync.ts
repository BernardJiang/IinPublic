/**
 * Talk exchange between two people (spec §31.9, REQ-GRAPH-30..35; design: docs/design/device-graph.md,
 * OPEN-114). Gun is each device's store; between devices the pair log travels in our own frames over
 * any direct link that carries strings (WebRTC, LAN, Wi-Fi Direct, later BLE), never via the hub.
 *
 * - Everything I send one person goes into that pair's log, encrypted with the pair secret (ECDH of
 *   our keys): offers (each carrying its Talk version), my answers to their Talks, deletions,
 *   declines, chat messages. Entries are numbered from 0, each carries the hash of the one before and
 *   my signature, so the receiver can prove order and completeness (REQ-GRAPH-34).
 * - What I queue for one person while an entry is being written goes into the next entry together
 *   (`{ batch }`): a first meeting's catch-up is a few entries, not one per Talk (OPEN-114).
 * - Frames: `hi` (where each side stands), `log` (entries, pushed), `ack` (signed, REQ-GRAPH-43),
 *   `cp` (a signed checkpoint after a trim, REQ-GRAPH-48), `want`/`blob` (a Talk version's content,
 *   asked for in `w`, never stored: made again from the Talk's nodes) and `part` (a frame larger than
 *   the link carries, in pieces). What they have not acknowledged is sent again while the link is up.
 *
 * Nothing is sent while two people are apart (D2): the log waits on my device until their link opens.
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
import { link, linkSoul, type GraphNode, type NodeStore } from '../node-store';
import { GRAPH_SCHEMA_VERSION, graphSouls, readTalkStructure, talkStructureKey, talkStructureOf, talkStructureStored, type StructureQuestion, type TalkStructure } from '../talk-structure';
import { personIdOf, personSoul, personWrites } from '../people-graph';
import { parseEventId } from '../event-id';
import { MESSAGE_CONV_MAX, MESSAGE_TEXT_MAX } from '../message-events';
import { createGraphAudience } from './audience';
import { LOG_BLOCK, graphWireSouls, pairTagOf } from './wire-names';

import { BATCH_MAX_CHARS, BATCH_MAX_ITEMS, INLINE_ENTRY_MAX_CHARS } from './batch-limits';

export { BATCH_MAX_CHARS, BATCH_MAX_ITEMS, INLINE_ENTRY_MAX_CHARS };
/** A block field naming a large entry's own node. Encrypted like every graph value (the sharing
 * policy sends nothing else on a `g/` soul); `{ ptr: n }` names entry `n`. */
/** Frames (OPEN-114): our own, carried by any link that carries strings. */
const FRAME_VERSION = 1;
/** The largest frame sent in one piece unless the link says less (the mesh's graph frames carry 256 KB). */
export const FRAME_MAX_CHARS = 60_000;
/** A frame larger than this is refused; parts of one frame at most, and how long a partial one waits. */
const FRAME_RAW_MAX = 256 * 1024;
const FRAME_PARTS_MAX = 4_096;
const FRAME_PARTS_TTL_MS = 120_000;

/** Content asked for and not arrived is asked for again after this long. */
const CONTENT_ASK_AGAIN_MS = 5_000;
/** Content blobs (OPEN-114): how many one `want` names, and how many received blobs a device keeps
 * in memory until applied. A blob is never stored: the sender makes it again from the Talk's own
 * graph nodes when someone asks (the version's key is stored, `sync/version/<id>`). */
const WANT_MAX = 512;
const BLOBS_IN_MEMORY = 4_000;

/** Items of one batch entry applied side by side (each a Talk's arrival or an answer). */
const BATCH_APPLY_PARALLEL = 32;

/** The Talk a log body is about (items about one Talk are applied in order). */
function talkOfBody(body: LogBody): string | undefined {
  if ('offer' in body) return body.offer.talkId;
  if ('answer' in body) return body.answer.talkId;
  if ('deleted' in body) return body.deleted.talkId;
  if ('deletedAnswer' in body) return body.deletedAnswer.talkId;
  if ('declined' in body) return body.declined.talkId;
  if ('message' in body) return `conv:${body.message.conv}`;
  return undefined;
}

const isPointer = (value: unknown, n: number): boolean => !!value && typeof value === 'object' && (value as { ptr?: unknown }).ptr === n;
/** A pointer's ciphertext is short; an entry's never is. */
const POINTER_MAX_CHARS = 200;

/** A chat message body is small and well-formed: bounded text, a sane conv id, a real event id. */
/** While someone owes me an acknowledgement over an open link, my head is sent again: first after
 * this many ms, doubling up to the max. */
export const OWED_RESEND_MS = 3_000;
export const OWED_RESEND_MAX_MS = 30_000;
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
  /** A Talk version offered. `talk` carries the version itself (OPEN-114): the receiver needs no
   * read of mine. An offer without it (older devices) names wire nodes to read (`talkTag`, `key`). */
  | { offer: {
    talkId: string; versionId: string;
    /** The version's head fields (ids, structure key, title, meta) and where its steps are: a
     * content blob made once per version, named by its hash `h`, encrypted with `k` (OPEN-114). The
     * receiver asks for the blob only when it does not hold that structure already. */
    head?: Record<string, unknown>; content?: { h: string; k: string };
    /** Step 1 of OPEN-114 carried the whole version here; still read. */
    talk?: VersionBody;
    talkTag?: string; key?: string; context?: Record<string, unknown>;
  } }
  /** Several bodies in one entry (OPEN-114), applied in order. */
  | { batch: LogBody[] }
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

/** One Talk version as it travels: its head fields and each step's ids (`ref`) and text. */
export type VersionBody = { head: Record<string, unknown>; steps: Array<{ ref: Record<string, unknown>; text: { q: string; a: Record<string, string> } }> };

export type GraphSyncEvents = {
  /** A Talk (or a new version of one) arrived from this person and is stored. */
  onTalk?: (talkId: string, fromUserId: string, context?: Record<string, unknown>, applied?: { versionId: string; talk: any }) => void;
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
  /** Unused since OPEN-114 (nothing is read over a link); kept so callers need not change. */
  remoteReadMs?: number;
  /** The largest frame a link carries in one piece unless `open` says otherwise. */
  frameMaxChars?: number;
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
  const mine = graphWireSouls(me.userId);
  /** A large entry's own node, under the pair's part. */
  const entrySoul = (senderUserId: string, pairTag: string, n: number) => `${graphWireSouls(senderUserId).head(pairTag).slice(0, -'/head'.length)}/e/${n}`;
  const frameMaxDefault = options.frameMaxChars ?? FRAME_MAX_CHARS;

  type Link = {
    keys: PeerKeys; secret: string; pairTag: string;
    /** The largest frame this link carries; a larger one goes in parts (a BLE link sets a small one). */
    frameMax: number;
    processing?: Promise<void> | undefined; again?: boolean;
    /** A stalled log (an entry missing) is asked for again after this many ms. */
    retryMs?: number | undefined; retryTimer?: ReturnType<typeof setTimeout> | undefined;
    lastError?: string | undefined;
    /** Their entries that arrived and are not applied yet, by number (ciphertext). */
    pending: Map<number, string>;
    /** The last entry their frames named (their head), and my own last entry with them. */
    theirHead?: number;
    myHead: number;
    /** The last of my entries their signed acknowledgement covers. */
    theirAck?: number;
    /** The acknowledgement I last sent them, and when I last asked them for an entry. */
    ackSent?: number | undefined; asked?: { next: number; at: number } | undefined;
    /** Their entries decrypted already (a scan for missing content reads them before applying). */
    decoded: Map<number, LogEntry>;
    /** Content I asked them for, and when. */
    wanted: Map<string, number>;
    /** Frames that arrive in parts, by id. */
    parts: Map<string, { count: number; got: Map<number, string>; at: number }>;
    /** While they owe me an acknowledgement: my entries are sent again after this many ms. */
    owedMs?: number | undefined; owedTimer?: ReturnType<typeof setTimeout> | undefined;
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

  /** One entry of my own log with this pair, inline or in its own node. */
  async function readMyEntry(pairTag: string, secret: string, n: number): Promise<LogEntry | undefined> {
    const block = await store.get(mine.logBlock(pairTag, Math.floor(n / LOG_BLOCK))).catch(() => null);
    const entry = await decryptJson<LogEntry>(block?.[String(n)], secret).catch(() => undefined);
    if (!isPointer(entry, n)) return entry;
    return decryptJson<LogEntry>((await store.get(entrySoul(me.userId, pairTag, n)).catch(() => null))?.c, secret).catch(() => undefined);
  }

  // ---- sending -------------------------------------------------------------------------------

  /**
   * Append to my log for this person; resolves with the entry's number. Bodies that arrive while
   * an entry is being written wait and go into the next entry together (OPEN-114, `{ batch }`).
   */
  const pendingOut = new Map<string, Array<{ body: LogBody; size: number; resolve: (n: number) => void; reject: (error: unknown) => void }>>();
  function append(peerUserId: string, body: LogBody): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const queue = pendingOut.get(peerUserId) ?? [];
      queue.push({ body, size: JSON.stringify(body).length, resolve, reject });
      if (queue.length === 1) {
        pendingOut.set(peerUserId, queue);
        void serial(`out:${peerUserId}`, () => flushOut(peerUserId));
      }
    });
  }

  /** How full my entries are (diagnostics): entries written, items in them, the largest batch. */
  const batching = { entries: 0, items: 0, largest: 0 };

  async function flushOut(peerUserId: string): Promise<void> {
    const queue = pendingOut.get(peerUserId) ?? [];
    const take: typeof queue = [];
    let chars = 0;
    while (queue.length && take.length < BATCH_MAX_ITEMS && (take.length === 0 || chars + queue[0]!.size <= BATCH_MAX_CHARS)) {
      const item = queue.shift()!;
      take.push(item);
      chars += item.size;
    }
    if (!queue.length) pendingOut.delete(peerUserId);
    else void serial(`out:${peerUserId}`, () => flushOut(peerUserId));
    if (!take.length) return;
    try {
      const n = await writeEntry(peerUserId, take.length === 1 ? take[0]!.body : { batch: take.map((item) => item.body) });
      batching.entries += 1;
      batching.items += take.length;
      batching.largest = Math.max(batching.largest, take.length);
      for (const item of take) item.resolve(n);
    } catch (error) {
      for (const item of take) item.reject(error);
    }
  }

  /** Write one entry to my log for this person (inside its `out:` queue). */
  async function writeEntry(peerUserId: string, body: LogBody): Promise<number> {
    const { secret, pairTag } = await pairWith(peerUserId);
    const stateSoul = `${prefix}sync/out/${encodeURIComponent(peerUserId)}`;
    const state = await store.get(stateSoul);
    const n = typeof state?.n === 'number' ? state.n + 1 : 0;
    const unsigned = { n, prev: typeof state?.hash === 'string' ? state.hash : '', when: now(), by: me.userId, body };
    const entry: LogEntry = { ...unsigned, sig: await crypto.sign(signedPart(unsigned), me.pair.priv) };
    const hash = entryHash(entry);
    const [cipher, head] = await Promise.all([encryptJson(entry, secret), encryptJson({ n, hash }, secret)]);
    // A large entry is its own node, written before the block names it.
    const large = cipher.length > INLINE_ENTRY_MAX_CHARS;
    if (large) await store.put(entrySoul(me.userId, pairTag, n), { c: cipher });
    await Promise.all([
      store.put(mine.logBlock(pairTag, Math.floor(n / LOG_BLOCK)), { [String(n)]: large ? await encryptJson({ ptr: n }, secret) : cipher }),
      store.put(mine.head(pairTag), { head }),
      store.put(stateSoul, { n, hash }),
      store.put(owedSoul, { [peerUserId]: n }),
    ]);
    owed.set(peerUserId, n);
    options.events?.onOwedChange?.([...owed.keys()]);
    const link = links.get(peerUserId);
    // Pushed at once when we are linked; otherwise it waits in my log until they say hello.
    if (link) {
      link.myHead = n;
      sendFrame(peerUserId, link, { t: 'log', from: n, e: [cipher] });
      link.owedMs = undefined;
      resendWhileOwed(peerUserId, link);
    }
    return n;
  }

  /**
   * A frame can be lost while the link stays up (a connection replaced under it). While they owe me
   * an acknowledgement, send what they have not acknowledged again, backing off.
   */
  function resendWhileOwed(peerUserId: string, link: Link): void {
    if (link.owedTimer || !owed.has(peerUserId)) return;
    link.owedMs = Math.min(OWED_RESEND_MAX_MS, link.owedMs ? link.owedMs * 2 : OWED_RESEND_MS);
    link.owedTimer = setTimeout(() => {
      link.owedTimer = undefined;
      if (links.get(peerUserId) !== link || !owed.has(peerUserId)) { link.owedMs = undefined; return; }
      void sendLog(peerUserId, link, (link.theirAck ?? -1) + 1).catch(() => undefined).finally(() => resendWhileOwed(peerUserId, link));
    }, link.owedMs);
    (link.owedTimer as { unref?: () => void }).unref?.();
  }

  /** One version of my Talk as it travels inside an offer (OPEN-114), built once per version. */
  const versionBodies = new Map<string, Promise<VersionBody>>();
  function versionBody(talkId: string, versionId: string, read?: Awaited<ReturnType<typeof graph.talks.read>>): Promise<VersionBody> {
    const known = versionBodies.get(versionId);
    if (known) return known;
    const built = (async (): Promise<VersionBody> => {
      // The caller's read of this version, when it has one: the structure is not read again.
      const [talk, event] = await Promise.all([
        read && read.versionId === versionId ? read : graph.talks.readVersion(talkId, versionId),
        store.get(souls.event(versionId)),
      ]);
      if (!talk || !event) throw new Error(`no version ${versionId} of Talk ${talkId}`);
      const structure = talkStructureOf(talk);
      const head = versionHead(talkId, versionId, talk, structure, event);
      const steps = structure.questions.map((question) => {
        const { text, answers, ...rest } = question;
        return {
          ref: {
            ...rest,
            qKey: questionKey({ text, language: structure.language, selection: question.answerSelectionMode || 'single' }),
            answers: answers.map(({ text: answerText, ...a }) => ({ ...a, aKey: answerKey(answerText) })),
          } as Record<string, unknown>,
          text: { q: text, a: Object.fromEntries(answers.map((a) => [a.id, a.text])) },
        };
      });
      return { head, steps };
    })();
    versionBodies.set(versionId, built);
    built.catch(() => versionBodies.delete(versionId));
    // Bounded: a device offering thousands of versions keeps the newest.
    if (versionBodies.size > 2_000) versionBodies.delete(versionBodies.keys().next().value!);
    return built;
  }

  /**
   * One version as offers carry it (OPEN-114): its head, and where its steps are: a content blob
   * encrypted with a random key `k` and named `h`, a hash of `k` and the steps (so only someone
   * given `k` can tell what content a name stands for). Every person it is offered to gets the same
   * name; only the small offer differs per pair. Only `{ h, k }` is stored: the blob is made again
   * from the Talk's own nodes when someone asks for it (no second copy of the Talk on disk).
   */
  const versionContents = new Map<string, Promise<{ head: Record<string, unknown>; content: { h: string; k: string } }>>();
  /** Blobs received and not yet applied, by name. */
  const blobs = new Map<string, string>();
  const versionKeySoul = (versionId: string) => `${prefix}sync/version/${versionId}`;
  const contentName = (k: string, plain: string) => portableSha256Hex(`${k}\n${plain}`);
  function rememberBlob(h: string, c: string): void {
    blobs.delete(h);
    blobs.set(h, c);
    if (blobs.size > BLOBS_IN_MEMORY) blobs.delete(blobs.keys().next().value!);
  }
  function versionContent(talkId: string, versionId: string, read?: Awaited<ReturnType<typeof graph.talks.read>>) {
    const known = versionContents.get(versionId);
    if (known) return known;
    const made = (async () => {
      const [record, { head, steps }] = await Promise.all([store.get(versionKeySoul(versionId)), versionBody(talkId, versionId, read)]);
      const plain = JSON.stringify(steps);
      // A name made the old way (a hash of a stored blob, before 2026-11-15) is replaced.
      if (typeof record?.h === 'string' && typeof record.k === 'string' && contentName(record.k, plain) === record.h) return { head, content: { h: record.h, k: record.k } };
      const k = crypto.randomHex(32);
      const h = contentName(k, plain);
      await store.put(versionKeySoul(versionId), { h, k });
      return { head, content: { h, k } };
    })();
    versionContents.set(versionId, made);
    made.catch(() => versionContents.delete(versionId));
    if (versionContents.size > 2_000) versionContents.delete(versionContents.keys().next().value!);
    return made;
  }

  /**
   * Content being fetched, by structure key: the same Talk offered by several people at once (as
   * everyone's starter tags are) is asked for from one of them; the others' offers wait for it.
   */
  const fetching = new Map<string, { from: string; at: number; waiting: Set<string> }>();

  /** The blob of my version someone asked for, made again from its nodes; only under the name I gave it. */
  async function servedContent(want: { h: string; talk: string; v: string }): Promise<string | undefined> {
    // A version offered since start-up has its name and key at hand; else they are read.
    const offered = await versionContents.get(want.v)?.catch(() => undefined);
    const record = offered?.content ?? await store.get(versionKeySoul(want.v)).catch(() => null);
    if (record?.h !== want.h || typeof record.k !== 'string') return undefined;
    const { steps } = await versionBody(want.talk, want.v).catch(() => ({ steps: undefined }));
    if (!steps) return undefined;
    const plain = JSON.stringify(steps);
    if (contentName(record.k, plain) !== want.h) return undefined;
    return crypto.encrypt(plain, record.k);
  }

  function versionHead(talkId: string, versionId: string, talk: any, structure: TalkStructure, event: GraphNode): Record<string, unknown> {
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
    return head;
  }

  // ---- receiving -----------------------------------------------------------------------------

  /** A version carried inside the offer (OPEN-114): no read of theirs. */
  function inlineVersion(offer: { talkId: string; versionId: string; talk: VersionBody }) {
    const { head, steps } = offer.talk;
    if (!head || head.talkId !== offer.talkId || head.versionId !== offer.versionId || !Array.isArray(steps) || steps.length !== Number(head.n)) return undefined;
    const questions: StructureQuestion[] = steps.map(({ ref, text }) => {
      const { qKey: _qKey, answers, ...rest } = ref as any;
      return { ...rest, text: text.q, answers: (answers as any[]).map(({ aKey: _aKey, ...a }) => ({ ...a, text: text.a[a.id] })) };
    });
    return versionFrom(head as any, questions, offer.talkId);
  }

  /**
   * What an offer needs and I have neither as a stored structure nor as a received blob: one read
   * of the structure's root (written last, so it stands for the whole structure).
   */
  async function missingContent(body: LogBody): Promise<{ h: string; rev: string; talk: string; v: string } | undefined> {
    if (!('offer' in body) || !body.offer.content || !body.offer.head) return undefined;
    if (blobs.has(body.offer.content.h)) return undefined;
    const rev = typeof body.offer.head.revKey === 'string' ? body.offer.head.revKey : undefined;
    if (rev && await talkStructureStored(store, rev, prefix).catch(() => false)) return undefined;
    return { h: body.offer.content.h, rev: rev ?? body.offer.content.h, talk: body.offer.talkId, v: body.offer.versionId };
  }

  /**
   * An offer's version: from its blob when I received one (no read), else from the structure I
   * hold (read once, here; `held` tells the arrival not to read it again).
   */
  async function contentVersion(offer: { talkId: string; versionId: string; head: any; content: { h: string; k: string } }) {
    const { head, content } = offer;
    if (!head || head.talkId !== offer.talkId || head.versionId !== offer.versionId) return undefined;
    const c = blobs.get(content.h);
    if (c) {
      const plain = await crypto.decrypt(c, content.k).catch(() => undefined);
      const text = typeof plain === 'string' ? plain : plain === undefined || plain === null ? undefined : JSON.stringify(plain);
      if (text === undefined || contentName(content.k, text) !== content.h) {
        // Not what the name says: dropped, asked for again.
        blobs.delete(content.h);
        throw new Error(`content ${content.h.slice(0, 8)} of Talk ${offer.talkId} did not match its name`);
      }
      let steps: unknown;
      try { steps = JSON.parse(text); } catch { return undefined; }
      if (!Array.isArray(steps)) return undefined;
      const version = inlineVersion({ talkId: offer.talkId, versionId: offer.versionId, talk: { head, steps } });
      return version && { ...version, held: false };
    }
    const structure = typeof head.revKey === 'string' ? await readTalkStructure(store, head.revKey, prefix).catch(() => undefined) : undefined;
    if (!structure || talkStructureKey(structure) !== head.revKey) throw new Error(`content ${content.h.slice(0, 8)} of Talk ${offer.talkId} has not arrived yet`);
    return { ...versionFrom(head, structure.questions, offer.talkId), held: true };
  }

  function versionFrom(head: any, questions: StructureQuestion[], talkId: string) {
    const structure: TalkStructure = { type: head.type, language: head.language, grammar: head.grammar, questions };
    if (head.matchThreshold !== undefined) structure.matchThreshold = head.matchThreshold;
    if (head.collectionImportance) structure.collectionImportance = head.collectionImportance;
    const talk: any = { ...structure, title: head.title, isAdult: head.isAdult };
    if (head.expiresAt !== undefined) talk.expiresAt = head.expiresAt;
    if (head.locationRadiusMiles !== undefined) talk.locationRadiusMiles = head.locationRadiusMiles;
    if (head.meta && typeof head.meta === 'object') talk.meta = head.meta;
    // The structure must hash to what the signed head says (its integrity rides on the log).
    if (talkStructureKey(talkStructureOf(talk)) !== head.revKey) throw new Error(`Talk ${talkId} does not match its structure key`);
    return { head, talk };
  }

  async function applyBody(fromUserId: string, keys: PeerKeys, entry: LogEntry, link: string, body: LogBody): Promise<void> {
    if ('batch' in body) {
      for (const item of Array.isArray(body.batch) ? body.batch : []) await applyBody(fromUserId, keys, entry, link, item);
      return;
    }
    if ('offer' in body) {
      // The version travels inside the offer; an older device's offer (wire nodes to read) is not
      // supported any more (no backward compatibility, OPEN-114).
      const fetched = body.offer.content && body.offer.head
        ? await contentVersion(body.offer as { talkId: string; versionId: string; head: any; content: { h: string; k: string } })
        : body.offer.talk ? inlineVersion(body.offer as { talkId: string; versionId: string; talk: VersionBody }) : undefined;
      if (!fetched && !body.offer.talk && !body.offer.content) { options.log?.(`[graph-sync] offer of ${body.offer.talkId} from an older device skipped`); return; }
      if (!fetched) throw new Error(`Talk ${body.offer.talkId} has not arrived yet`);
      const { head, talk } = fetched;
      const held = 'held' in fetched && fetched.held === true;
      const result = await graph.arrivals.receive({
        talkId: body.offer.talkId, versionId: body.offer.versionId,
        ...(head.previousVersionId ? { previousVersionId: head.previousVersionId } : {}),
        authorId: fromUserId, authorPub: keys.pub, when: Number(head.when), device: String(head.device), talk,
        // Read in full from my store just now: the arrival does not look at it again.
        ...(held ? { structureHeld: true } : {}),
      }, {
        userId: fromUserId, pub: keys.pub, link,
        // The log entry that carried the offer, so the answer can name it back (REQ-GRAPH-44).
        entry: { n: entry.n, hash: entryHash(entry), when: Number(entry.when) },
      });
      // The version just applied goes with the event: the host need not read it back.
      if (!result.ignored) options.events?.onTalk?.(body.offer.talkId, fromUserId, body.offer.context, { versionId: body.offer.versionId, talk });
      // Others' offers of this same content were waiting for it: they can go now.
      const rev = typeof body.offer.head?.revKey === 'string' ? body.offer.head.revKey : undefined;
      const waited = rev ? fetching.get(rev) : undefined;
      if (rev && waited) {
        fetching.delete(rev);
        for (const peer of waited.waiting) if (peer !== fromUserId) void catchUp(peer);
      }
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
      addToIndex(store, souls.index(`person/${encodeURIComponent(fromUserId)}/ev`), { key: eventId, target: souls.event(eventId), when }),
      store.put(souls.index('convs'), { [message.conv]: when }),
      ...(message.eventId ? [store.put(seenSoul, { [message.eventId]: link(souls.event(eventId)) })] : []),
    ]);
  }

  // ---- frames --------------------------------------------------------------------------------
  //
  // OPEN-114: the pair log travels in our own frames, not as Gun messages. Any link that carries a
  // string (WebRTC, LAN, Wi-Fi Direct, later BLE) carries them; a frame over the link's size goes in
  // parts. Entries are already signed and encrypted; a frame adds only the pair tag and numbers.
  //   hi   { next, head }        the entry of yours I need next, and my last entry
  //   log  { from, e: [...] }    my entries from `from` on (ciphertext as stored)
  //   ack  { n, hash, when, sig } I applied your entries up to n (signed, REQ-GRAPH-43)
  //   cp   { n, hash, when, sig } my log starts after n (signed checkpoint after a trim, REQ-GRAPH-48)
  //   part { id, i, count, d }   one part of a larger frame

  function sendFrame(peerUserId: string, link: Link, frame: Record<string, unknown>): void {
    // Every frame says my last entry (`h`): any frame that gets through tells them what they miss.
    const raw = JSON.stringify({ gx: FRAME_VERSION, p: link.pairTag, h: link.myHead, ...frame });
    if (raw.length <= link.frameMax) { outbox.push({ to: peerUserId, raw }); wake?.(); return; }
    const size = Math.max(64, link.frameMax - 160);
    const id = crypto.randomHex(8);
    const count = Math.ceil(raw.length / size);
    for (let i = 0; i < count; i += 1) {
      outbox.push({ to: peerUserId, raw: JSON.stringify({ gx: FRAME_VERSION, t: 'part', id, i, count, d: raw.slice(i * size, (i + 1) * size) }) });
    }
    wake?.();
  }

  async function myOutState(peerUserId: string): Promise<{ n: number; hash: string }> {
    const state = await store.get(`${prefix}sync/out/${encodeURIComponent(peerUserId)}`);
    return { n: typeof state?.n === 'number' ? state.n : -1, hash: typeof state?.hash === 'string' ? state.hash : '' };
  }

  async function myInState(peerUserId: string): Promise<{ next: number; hash: string; sub?: number; broken?: string }> {
    const state = await store.get(`${prefix}sync/in/${encodeURIComponent(peerUserId)}`);
    return {
      next: typeof state?.next === 'number' ? state.next : 0,
      hash: typeof state?.hash === 'string' ? state.hash : '',
      ...(typeof state?.sub === 'number' ? { sub: state.sub } : {}),
      ...(typeof state?.broken === 'string' ? { broken: state.broken } : {}),
    };
  }

  /** The stored ciphertext of my entry n with this pair (the entry itself, not a pointer). */
  async function myEntryCipher(pairTag: string, secret: string, n: number): Promise<string | undefined> {
    const block = await store.get(mine.logBlock(pairTag, Math.floor(n / LOG_BLOCK))).catch(() => null);
    const stored = block?.[String(n)];
    if (typeof stored !== 'string') return undefined;
    if (stored.length <= POINTER_MAX_CHARS && isPointer(await decryptJson(stored, secret).catch(() => undefined), n)) {
      const own = (await store.get(entrySoul(me.userId, pairTag, n)).catch(() => null))?.c;
      return typeof own === 'string' ? own : undefined;
    }
    return stored;
  }

  /** Send them my entries from `from` on, in frames up to the link's size (a checkpoint first when
   * the start was trimmed). */
  async function sendLog(peerUserId: string, link: Link, from: number): Promise<void> {
    const { n: last } = await myOutState(peerUserId);
    if (from > last) return;
    let start = Math.max(0, from);
    if (!(await myEntryCipher(link.pairTag, link.secret, start))) {
      const head = await store.get(mine.head(link.pairTag)).catch(() => null);
      const cp = await decryptJson<{ n: number; hash: string; when: number; sig: string }>(head?.cp, link.secret).catch(() => undefined);
      if (!cp || cp.n < start) return; // not stored and not trimmed: nothing I can send
      sendFrame(peerUserId, link, { t: 'cp', n: cp.n, hash: cp.hash, when: cp.when, sig: cp.sig });
      start = cp.n + 1;
    }
    let batch: string[] = [];
    let batchFrom = start;
    let chars = 0;
    for (let n = start; n <= last; n += 1) {
      const cipher = await myEntryCipher(link.pairTag, link.secret, n);
      if (cipher === undefined) break;
      if (batch.length && chars + cipher.length > link.frameMax - 200) {
        sendFrame(peerUserId, link, { t: 'log', from: batchFrom, e: batch });
        batch = []; chars = 0; batchFrom = n;
      }
      batch.push(cipher);
      chars += cipher.length;
    }
    if (batch.length) sendFrame(peerUserId, link, { t: 'log', from: batchFrom, e: batch });
  }

  async function sendHello(peerUserId: string, link: Link): Promise<void> {
    const [inState, outState] = await Promise.all([myInState(peerUserId), myOutState(peerUserId)]);
    link.asked = { next: inState.next, at: now() };
    sendFrame(peerUserId, link, { t: 'hi', next: inState.next, head: outState.n });
  }

  /** A frame from their link. */
  async function handleFrame(peerUserId: string, link: Link, frame: any): Promise<void> {
    if (frame.t === 'part') {
      const { id, i, count, d } = frame;
      if (typeof id !== 'string' || typeof i !== 'number' || typeof count !== 'number' || typeof d !== 'string' || count < 1 || count > FRAME_PARTS_MAX || i < 0 || i >= count) return;
      const held = link.parts.get(id) ?? { count, got: new Map<number, string>(), at: now() };
      held.got.set(i, d);
      link.parts.set(id, held);
      for (const [other, value] of link.parts) if (now() - value.at > FRAME_PARTS_TTL_MS) link.parts.delete(other);
      if (held.got.size < held.count) return;
      link.parts.delete(id);
      let whole: any;
      try { whole = JSON.parse(Array.from({ length: held.count }, (_, k) => held.got.get(k) ?? '').join('')); } catch { return; }
      if (whole?.gx === FRAME_VERSION && whole.t !== 'part') await handleFrame(peerUserId, link, whole);
      return;
    }
    if (frame.p !== link.pairTag) return; // another pair's frame: never mine
    if (typeof frame.h === 'number' && frame.h > (link.theirHead ?? -1)) {
      link.theirHead = frame.h;
      if (frame.t !== 'log' && frame.t !== 'hi') void catchUp(peerUserId);
    }
    if (frame.t === 'hi') {
      if (typeof frame.head === 'number') link.theirHead = Math.max(link.theirHead ?? -1, frame.head);
      // They may have lost my acknowledgement: send it again, then what they still need.
      link.ackSent = undefined;
      await sendLog(peerUserId, link, typeof frame.next === 'number' ? frame.next : 0);
      void catchUp(peerUserId);
      return;
    }
    if (frame.t === 'log') {
      if (typeof frame.from !== 'number' || !Array.isArray(frame.e)) return;
      frame.e.forEach((cipher: unknown, i: number) => { if (typeof cipher === 'string') link.pending.set(frame.from + i, cipher); });
      link.theirHead = Math.max(link.theirHead ?? -1, frame.from + frame.e.length - 1);
      void catchUp(peerUserId);
      return;
    }
    if (frame.t === 'ack') { await checkRead(peerUserId, link, frame); return; }
    if (frame.t === 'want') {
      // Content of my Talks they need, each named with the Talk version it belongs to (`w`; `h` is
      // every frame's head): made again from the graph, sent in as few frames as the link carries.
      const wants = (Array.isArray(frame.w) ? frame.w : [])
        .filter((w: any): w is { h: string; talk: string; v: string } => !!w && typeof w.h === 'string' && typeof w.talk === 'string' && typeof w.v === 'string')
        .slice(0, WANT_MAX);
      let batch: Record<string, string> = {};
      let chars = 0;
      // Made side by side (each a read at most and an encryption), sent in the order asked.
      const made = await Promise.all(wants.map((want: { h: string; talk: string; v: string }) => servedContent(want).catch(() => undefined)));
      for (const [i, want] of wants.entries()) {
        const h = want.h;
        const c = made[i];
        if (!c) continue;
        if (chars && chars + c.length > link.frameMax - 200) { sendFrame(peerUserId, link, { t: 'blob', b: batch }); batch = {}; chars = 0; }
        batch[h] = c;
        chars += c.length;
      }
      if (chars) sendFrame(peerUserId, link, { t: 'blob', b: batch });
      return;
    }
    if (frame.t === 'blob') {
      // Content I asked for (only that): checked against its name when applied, with the offer's key.
      let fresh = false;
      for (const [h, c] of Object.entries(frame.b ?? {})) {
        if (typeof c !== 'string' || !link.wanted.has(h)) continue;
        rememberBlob(h, c);
        link.wanted.delete(h);
        fresh = true;
      }
      if (fresh) { link.asked = undefined; void catchUp(peerUserId); }
      return;
    }
    if (frame.t === 'cp') { await applyCheckpoint(peerUserId, link, frame); void catchUp(peerUserId); }
  }

  /** A checkpoint they signed after trimming (REQ-GRAPH-48): when I am behind it I start from it. */
  async function applyCheckpoint(peerUserId: string, link: Link, cp: any): Promise<void> {
    const stateSoul = `${prefix}sync/in/${encodeURIComponent(peerUserId)}`;
    const state = await myInState(peerUserId);
    if (state.broken || typeof cp.n !== 'number' || state.next > cp.n) return;
    const ok = typeof cp.hash === 'string' && typeof cp.when === 'number' && typeof cp.sig === 'string'
      && await crypto.verify(cp.sig, canonicalJson({ n: cp.n, hash: cp.hash, when: cp.when }), link.keys.pub).catch(() => false);
    if (!ok) {
      const broken = `checkpoint ${cp.n} has a bad signature`;
      await store.put(stateSoul, { broken });
      options.log?.(`[graph-sync] log from ${peerUserId} broken: ${broken}`);
      return;
    }
    await store.put(stateSoul, { next: cp.n + 1, hash: cp.hash, sub: null });
  }

  /** Apply every entry of theirs that arrived, in order, proving the chain. */
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
      } while (link.again && links.get(peerUserId) === link);
      if (link.retryTimer) { clearTimeout(link.retryTimer); link.retryTimer = undefined; }
      if (stalled && links.get(peerUserId) === link) {
        // An entry is missing (a frame lost) or could not be applied: ask again, backing off.
        link.retryMs = Math.min(30_000, (link.retryMs ?? 500) * 2);
        link.retryTimer = setTimeout(() => {
          link.retryTimer = undefined;
          if (links.get(peerUserId) !== link) return;
          link.asked = undefined;
          void catchUp(peerUserId);
        }, link.retryMs);
        (link.retryTimer as { unref?: () => void }).unref?.();
      } else {
        link.retryMs = undefined;
      }
    })().finally(() => { link.processing = undefined; });
    return link.processing;
  }

  /** Returns true when the log is stalled: they have more than I could apply. */
  async function readLog(peerUserId: string, link: Link): Promise<boolean> {
    const stateSoul = `${prefix}sync/in/${encodeURIComponent(peerUserId)}`;
    let state = await myInState(peerUserId);
    if (state.broken) return false;
    let next = state.next;
    let prev = state.hash;
    for (const n of [...link.pending.keys()]) if (n < next) { link.pending.delete(n); link.decoded.delete(n); }
    const decode = async (n: number): Promise<LogEntry | undefined> => {
      const known = link.decoded.get(n);
      if (known) return known;
      const entry = await decryptJson<LogEntry>(link.pending.get(n), link.secret);
      if (entry) link.decoded.set(n, entry);
      return entry;
    };
    // Content the waiting entries need and I lack: asked for all at once, before applying any.
    const missing = new Map<string, { rev: string; talk: string; v: string }>();
    // Entries below this were checked just now: the loop below does not check them again.
    let scanned = next;
    for (let n = next; link.pending.has(n) && missing.size < WANT_MAX; n += 1, scanned = n) {
      const entry = await decode(n);
      if (!entry) break;
      const items = 'batch' in entry.body && Array.isArray(entry.body.batch) ? entry.body.batch : [entry.body];
      for (const item of items) { const need = await missingContent(item); if (need) missing.set(need.h, need); }
    }
    const ask = [...missing].filter(([h, { rev }]) => {
      // Being fetched from someone else: wait for it rather than ask again.
      const elsewhere = fetching.get(rev);
      if (elsewhere && elsewhere.from !== peerUserId && now() - elsewhere.at < CONTENT_ASK_AGAIN_MS) { elsewhere.waiting.add(peerUserId); return false; }
      if (now() - (link.wanted.get(h) ?? 0) <= CONTENT_ASK_AGAIN_MS) return false;
      fetching.set(rev, { from: peerUserId, at: now(), waiting: elsewhere?.waiting ?? new Set() });
      return true;
    }).map(([h, { talk, v }]) => ({ h, talk, v }));
    if (ask.length) {
      for (const { h } of ask) link.wanted.set(h, now());
      sendFrame(peerUserId, link, { t: 'want', w: ask });
    }
    try {
      while (link.pending.has(next)) {
        const entry = await decode(next);
        if (!entry) { link.pending.delete(next); break; }
        // Its content has not arrived: wait for it (the blob frame starts the next pass).
        const items0 = 'batch' in entry.body && Array.isArray(entry.body.batch) ? entry.body.batch : [entry.body];
        const lacking = next < scanned
          ? items0.some((item) => 'offer' in item && !!item.offer.content && missing.has(item.offer.content.h) && !blobs.has(item.offer.content.h))
          : (await Promise.all(items0.map((item) => missingContent(item)))).some(Boolean);
        if (lacking) return true;
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
        // Items about different Talks are applied side by side, BATCH_APPLY_PARALLEL at a time;
        // items about the same Talk keep their order. When one fails, the ones before it are not
        // applied again on the retry (`sub`: how many of entry `next` are applied).
        const items = 'batch' in entry.body && Array.isArray(entry.body.batch) ? entry.body.batch : [entry.body];
        for (let start = state.sub ?? 0; start < items.length; start += BATCH_APPLY_PARALLEL) {
          const groups = new Map<string, LogBody[]>();
          items.slice(start, start + BATCH_APPLY_PARALLEL).forEach((item, i) => {
            const key = talkOfBody(item) ?? `#${start + i}`;
            groups.set(key, [...(groups.get(key) ?? []), item]);
          });
          const results = await Promise.allSettled([...groups.values()].map(async (group) => {
            for (const item of group) await applyBody(peerUserId, link.keys, entry, 'webrtc', item);
          }));
          const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
          if (failed) {
            if (start > 0) await store.put(stateSoul, { sub: start }).catch(() => undefined);
            throw failed.reason;
          }
        }
        link.pending.delete(next);
        link.decoded.delete(next);
        prev = entryHash(entry);
        next += 1;
        await store.put(stateSoul, { next, hash: prev, sub: null });
        state = { next, hash: prev };
      }
    } finally {
      await sendAck(peerUserId, link, next - 1, prev).catch(() => undefined);
    }
    if ((link.theirHead ?? -1) < next) return false;
    // Something of theirs is missing: ask for it (once per entry, until the retry).
    if (!link.asked || link.asked.next !== next) await sendHello(peerUserId, link);
    return true;
  }

  /** Tell them how far I applied their log, once per new value (REQ-GRAPH-43, signed). */
  async function sendAck(peerUserId: string, link: Link, n: number, hash: string): Promise<void> {
    if (n < 0 || link.ackSent === n) return;
    link.ackSent = n;
    const ack = { n, hash, when: now() };
    sendFrame(peerUserId, link, { t: 'ack', ...ack, sig: await crypto.sign(canonicalJson(ack), me.pair.priv) });
  }

  /**
   * Their acknowledgement of my log: it counts only when its signature verifies and its hash is my
   * entry `n`'s hash. What they acknowledged they owe me nothing more for.
   */
  async function checkRead(peerUserId: string, link: Link, ack: any): Promise<void> {
    if (typeof ack?.n !== 'number' || typeof ack.hash !== 'string' || typeof ack.when !== 'number' || typeof ack.sig !== 'string') return;
    if (!(await crypto.verify(ack.sig, canonicalJson({ n: ack.n, hash: ack.hash, when: ack.when }), link.keys.pub).catch(() => false))) return;
    // The hash must commit to my own entry: read it back from my log and re-hash it.
    const entry = await readMyEntry(link.pairTag, link.secret, ack.n);
    if (!entry || entryHash(entry) !== ack.hash) return;
    await store.put(souls.index(`ack/${encodeURIComponent(peerUserId)}`), { [String(ack.n)]: JSON.stringify({ n: ack.n, hash: ack.hash, when: ack.when, sig: ack.sig }) });
    lastAcks.set(peerUserId, { n: ack.n, when: ack.when, skewMs: ack.when - Number(entry.when) });
    link.theirAck = Math.max(link.theirAck ?? -1, ack.n);
    const want = owed.get(peerUserId);
    if (want !== undefined && ack.n >= want) {
      owed.delete(peerUserId);
      await store.put(owedSoul, { [peerUserId]: null });
      options.events?.onOwedChange?.([...owed.keys()]);
    }
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

    /**
     * A direct link to this person is up (any transport that carries strings). `frameMaxChars`: the
     * largest frame it carries in one piece (a BLE link passes a small one; larger frames go in parts).
     */
    async open(peerUserId: string, linkOptions: { frameMaxChars?: number } = {}): Promise<void> {
      if (links.has(peerUserId)) return;
      const pair = await pairWith(peerUserId);
      const link: Link = { ...pair, frameMax: Math.max(256, linkOptions.frameMaxChars ?? frameMaxDefault), pending: new Map(), decoded: new Map(), wanted: new Map(), parts: new Map(), myHead: (await myOutState(peerUserId)).n };
      links.set(peerUserId, link);
      // Say where we stand: they send what I miss, and I send what they miss when they say theirs.
      await sendHello(peerUserId, link);
      const inState = await myInState(peerUserId);
      await sendAck(peerUserId, link, inState.next - 1, inState.hash).catch(() => undefined);
      resendWhileOwed(peerUserId, link);
    },

    /** The link went down. */
    close(peerUserId: string): void {
      const link = links.get(peerUserId);
      if (!link) return;
      links.delete(peerUserId);
      if (link.retryTimer) clearTimeout(link.retryTimer);
      if (link.owedTimer) clearTimeout(link.owedTimer);
    },

    /** A frame from this person's link (anything else is ignored). */
    hear(peerUserId: string, raw: string): void {
      const link = links.get(peerUserId);
      if (!link || typeof raw !== 'string' || raw.length > FRAME_RAW_MAX) return;
      let frame: any;
      try { frame = JSON.parse(raw); } catch { return; }
      if (!frame || frame.gx !== FRAME_VERSION) return;
      // Acknowledgements are checked in their own queue: a slow check (a busy device's signature
      // check) must not hold up the entries and requests behind it (e2e 05-mailbox).
      void serial(`${frame.t === 'ack' ? 'ack' : 'in'}:${peerUserId}`, () => handleFrame(peerUserId, link, frame)).catch((error) => {
        link.lastError = (error as Error).message;
        options.log?.(`[graph-sync] ${peerUserId}: frame failed: ${link.lastError}`);
      });
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
      // Which version is my latest: one read. The Talk itself is read only for a version whose
      // offer is not made yet (a Talk offered to many people is read once, not once per offer).
      const mine = await store.get(souls.mine(`talk/${talkId}`));
      if (mine?.deleted === true) throw new Error(`no Talk ${talkId}`);
      const latest = linkSoul(mine?.latest);
      const latestId = latest ? latest.slice(souls.event('').length) : talkId;
      const read = versionContents.has(latestId) ? undefined : await graph.talks.read(talkId);
      if (!versionContents.has(latestId) && !read) throw new Error(`no Talk ${talkId}`);
      const talk = { versionId: read?.versionId ?? latestId };
      // The offer names the version's content blob (OPEN-114): made once, whoever it goes to.
      const { head, content } = await versionContent(talkId, talk.versionId, read);
      // The version each person was last sent, in keyed buckets (`keyed-buckets.ts`).
      const sentSoul = `${prefix}sync/sent/${talkId}`;
      const sent = await getKeyedMany(store, sentSoul, recipients);
      const fresh = [...new Set(recipients)].filter((id) => id !== me.userId && sent[id] !== talk.versionId);
      // One entry per person; offers made at the same time share it (`append`).
      await Promise.all(fresh.map((peerUserId) => append(peerUserId, { offer: { talkId, versionId: talk.versionId, head, content, ...(context ? { context } : {}) } })));
      // Only a hint for the next offer (skip who has this version): the offers are in the pair logs
      // already. A write the store never acknowledges (Gun in a busy browser stalls some for over
      // 8 s) must not fail them — at worst the version is offered again and the receiver, holding
      // it, ignores it (stage5 starter-tags sent 28 of 30, 2026-11-15).
      if (fresh.length) {
        await putKeyed(store, sentSoul, Object.fromEntries(fresh.map((peerUserId) => [peerUserId, talk.versionId])))
          .catch((error) => console.warn(`[graph-sync] who was sent ${talkId} was not recorded:`, error));
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
      const boundary = await readMyEntry(pairTag, secret, ackN - 1);
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
      // A large entry's own node goes too (OPEN-114).
      const pointers: number[] = [];
      for (const block of blocks.keys()) {
        const node = await store.get(mine.logBlock(pairTag, block)).catch(() => null);
        for (const [key, value] of Object.entries(node ?? {})) {
          if (!/^\d+$/.test(key) || Number(key) >= ackN || typeof value !== 'string' || value.length > POINTER_MAX_CHARS) continue;
          if (isPointer(await decryptJson(value, secret).catch(() => undefined), Number(key))) pointers.push(Number(key));
        }
      }
      await Promise.all([
        ...[...blocks].map(([block, fields]) => store.put(mine.logBlock(pairTag, block), fields)),
        ...pointers.map((n) => store.put(entrySoul(me.userId, pairTag, n), { c: null })),
      ]);
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
        addToIndex(store, souls.index(`person/${encodeURIComponent(peerUserId)}/ev`), { key: eventId, target: souls.event(eventId), when }),
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
      // Which version I answered and the arrival that brought it: the Talk itself is not read.
      const received = await graph.arrivals.latest(talkId);
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
        if (link.theirHead !== undefined) status.theirHead = link.theirHead;
        if (link.theirAck !== undefined) status.theirRead = link.theirAck;
        status.theirBlock = [...link.pending.keys()].map(String);
      }
      return status;
    },

    openLinks: () => [...links.keys()],
    batching: () => ({ ...batching }),
  };
}

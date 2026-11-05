/**
 * Who I already exchanged what with, from the device graph (REQ-LEDGER-16, spec §31.8). It replaces
 * the sender's talk ledger (OPEN-106 step 3): what a person already has is not sent to them again,
 * the daily and weekly send limits, and how each answer to my Talk was decided.
 *
 * Each map keyed by an atom or a person is in keyed buckets (`keyed-buckets.ts`).
 *
 *   ix/exchanged/<peer>              { <atom>: →ev }  this passed between us: my offer, their Talk
 *                                    I accepted (a tag Talk's tags only once answered), or an answer
 *   ix/exchanged-with                { <peer>: true }
 *   ix/co/<peer>                     { <atom>: →ev }  an answer passed (the Talks list's "also
 *                                    exchanged with")
 *   ix/sent-day/<peer>/<yyyy-mm-dd>  { <talkId>: true }  Talks I sent them that UTC day
 *   ix/outcome/<talkId>              { <responder>: 'matched' | 'ignored' }  each answer to my Talk
 *   ix/outcome/<talkId>/by/<responder>  { outcome, version, responseId, respondedAt }
 *   ix/responded/<talkId>/by/<author>   { outcome, version, responseId, respondedAt }  my answer to it
 *   ix/responded/<talkId>            { <author>: true }
 *
 * The version I last sent each person is `sync/sent/<talkId>` (`graph-sync.ts`, D14: an edit is
 * sent again). An atom is a situation's context hash, or for a tag Talk one tag's word: the same
 * tag in anyone's Talk is the same atom, so a tag Jerry and I already swapped is not sent back to
 * me in Jerry's own Talk. A deleted Talk's atoms leave the indexes, so it can be sent again.
 */
import { portableSha256Hex } from '../../shared/portable-sha256';
import { buildTagIdentityKeys } from '../../shared/tag-identity';
import { allSituations } from './answers';
import { getKeyedMany, putKeyed, readKeyed } from './keyed-buckets';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';
import { graphSouls, talkStructureOf } from './talk-structure';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const TAG_ATOM_DOMAIN = 'iinpublic-exchange-tag-v1';
/** Distinct Talks I may send one person in a UTC day and week (spec REQ-LEDGER-08). */
export const TALK_SEND_DAILY = 10;
export const TALK_SEND_WEEKLY = 50;

export type ExchangeAtom = { atom: string; /** The tag's key in a trimmed offer (`omit`). */ omitKey?: string };
export type Outcome = 'matched' | 'ignored';
export type OutcomeRecord = { outcome: Outcome; version: number; responseId: string; respondedAt: string };

/** One recipient's part of an offer. */
export type OfferPlan =
  | { send: false; reason: 'sent' | 'exchanged' | 'daily_talk_send_rate_limit' | 'weekly_talk_send_rate_limit' }
  | { send: true; omit?: string[]; revision?: boolean };

const word = (text: unknown) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
/** A tag's atom: its word, whoever's Talk it is in. */
export const tagAtom = (text: unknown) => `tag-${portableSha256Hex(`${TAG_ATOM_DOMAIN}\n${word(text)}`)}`;

/** What of a Talk passes between two people: its situations, or a tag Talk's tags. */
export function exchangeAtoms(talk: any): ExchangeAtom[] {
  if (talk?.type === 'tag') {
    const question = talk.questions?.[0];
    const answers: any[] = Array.isArray(question?.answers) ? question.answers : [];
    if (answers.some((a) => a?.isIgnore)) return word(question?.text) ? [{ atom: tagAtom(question.text) }] : [];
    if (answers.length > 1) {
      const keys = buildTagIdentityKeys(talk, '');
      return answers.map((a, i) => ({ atom: tagAtom(a?.text), omitKey: keys[i]! }));
    }
    if (answers.length === 1) return [{ atom: tagAtom(answers[0]?.text) }];
  }
  return [...new Set(allSituations(talkStructureOf(talk), 'author').map((s) => s.contextHash))].map((atom) => ({ atom }));
}

/**
 * What an answer passed: a tag Talk's tags that were chosen (REQ-LEDGER-16: Jerry answering Tennis
 * in my Tennis + Chess Talk has swapped Tennis with me, not Chess), any other Talk whole.
 */
export function answeredAtoms(talk: any, answerIds: string[]): ExchangeAtom[] {
  const atoms = exchangeAtoms(talk);
  if (!atoms.some((a) => a.omitKey)) return atoms;
  const chosen = new Set(answerIds.map(String));
  const answers: any[] = talk?.questions?.[0]?.answers ?? [];
  return atoms.filter((_, i) => chosen.has(String(answers[i]?.id ?? '')));
}

/**
 * The rule for one recipient (pure). `sentVersion`: the version of this Talk I last sent them;
 * `has`: whether they have an atom. A version they have is not sent again; an older one is replaced whole;
 * otherwise a Talk all of whose atoms they have is not sent, and a tag Talk leaves out the tags
 * they have.
 */
export function planOffer(input: { versionId: string; sentVersion?: string | undefined; atoms: ExchangeAtom[]; has: (atom: string) => boolean }): OfferPlan {
  if (input.sentVersion && input.sentVersion === input.versionId) return { send: false, reason: 'sent' };
  if (input.sentVersion) return { send: true, revision: true };
  const had = input.atoms.filter((a) => input.has(a.atom));
  if (input.atoms.length && had.length === input.atoms.length) return { send: false, reason: 'exchanged' };
  const omit = had.map((a) => a.omitKey).filter((key): key is string => !!key).sort();
  return omit.length ? { send: true, omit } : { send: true };
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The UTC days of the week (from Monday) up to and including `ms`'s day. */
export function weekDaysUpTo(ms: number): string[] {
  const day = new Date(ms);
  const weekday = (day.getUTCDay() + 6) % 7;
  return Array.from({ length: weekday + 1 }, (_, i) => utcDay(ms - (weekday - i) * 86_400_000));
}

export function createExchangeIndex(store: NodeStore, options: { prefix?: string; now?: () => number } = {}) {
  const prefix = options.prefix ?? 'local/';
  const souls = graphSouls(prefix);
  const now = options.now ?? Date.now;
  const key = (userId: string) => encodeURIComponent(userId);
  const exchangedSoul = (peer: string) => souls.index(`exchanged/${key(peer)}`);
  const coSoul = (peer: string) => souls.index(`co/${key(peer)}`);
  const sentDaySoul = (peer: string, day: string) => souls.index(`sent-day/${key(peer)}/${day}`);
  // One person's record of a Talk, beside the Talk's keyed map (`outcome/<talkId>/<bucket>`).
  const outcomeSoul = (talkId: string, responder: string) => souls.index(`outcome/${talkId}/by/${key(responder)}`);
  const respondedSoul = (talkId: string, author: string) => souls.index(`responded/${talkId}/by/${key(author)}`);
  const eventIdOf = (soul: string | undefined) => (soul ? soul.slice(souls.event('').length) : '');

  /** The Talk an event belongs to: a Talk version, an arrival of one, or an answer to one. */
  async function talkOfEvent(eventId: string, cache: Map<string, string>): Promise<string> {
    if (cache.has(eventId)) return cache.get(eventId)!;
    const event = await store.get(souls.event(eventId));
    let talkId = eventIdOf(linkSoul(event?.talk));
    if (!talkId && event?.with) {
      const version = await store.get(linkSoul(event.re) || '');
      talkId = eventIdOf(linkSoul(version?.talk)) || eventIdOf(linkSoul(event.re));
    }
    if (!talkId && event?.rev) talkId = eventId;
    cache.set(eventId, talkId);
    return talkId;
  }

  async function mark(peer: string, atoms: ExchangeAtom[], eventId: string, answered: boolean): Promise<void> {
    if (!peer || !atoms.length || !eventId) return;
    const at = link(souls.event(eventId));
    const node: GraphNode = Object.fromEntries(atoms.map((a) => [a.atom, at]));
    await Promise.all([
      putKeyed(store, exchangedSoul(peer), node),
      putKeyed(store, souls.index('exchanged-with'), { [key(peer)]: true }),
      ...(answered ? [putKeyed(store, coSoul(peer), node)] : []),
    ]);
  }

  async function sentToday(peer: string, ms: number): Promise<GraphNode> {
    return (await store.get(sentDaySoul(peer, utcDay(ms)))) ?? {};
  }

  return {
    /** Their atoms (any passing). */
    async exchanged(peer: string): Promise<Record<string, string>> {
      const node = await readKeyed(store, exchangedSoul(peer));
      return Object.fromEntries(Object.entries(node).flatMap(([atom, value]) => {
        const soul = linkSoul(value);
        return soul ? [[atom, eventIdOf(soul)]] : [];
      }));
    },

    /** Which of these atoms passed between me and this person (reads only their buckets). */
    async has(peer: string, atoms: string[]): Promise<Set<string>> {
      const found = await getKeyedMany(store, exchangedSoul(peer), atoms);
      return new Set(Object.keys(found).filter((atom) => !!linkSoul(found[atom])));
    },

    /** Everyone I exchanged with: user ID → atoms passed, and atoms answered. */
    async state(): Promise<Record<string, { exchanged: string[]; answered: string[] }>> {
      const peers = Object.entries(await readKeyed(store, souls.index('exchanged-with'))).filter(([, v]) => v === true).map(([k]) => decodeURIComponent(k));
      const out: Record<string, { exchanged: string[]; answered: string[] }> = {};
      await Promise.all(peers.map(async (peer) => {
        const [passed, co] = await Promise.all([readKeyed(store, exchangedSoul(peer)), readKeyed(store, coSoul(peer))]);
        const live = (node: Record<string, unknown>) => Object.entries(node).filter(([, v]) => !!linkSoul(v)).map(([atom]) => atom);
        out[peer] = { exchanged: live(passed), answered: live(co) };
      }));
      return out;
    },

    /** I sent this version of my Talk to them, leaving out `omit` (the tags they have). */
    async recordOffer(peer: string, talkId: string, versionId: string, atoms: ExchangeAtom[], omit: string[] = []): Promise<void> {
      const skip = new Set(omit);
      await Promise.all([
        mark(peer, atoms.filter((a) => !a.omitKey || !skip.has(a.omitKey)), versionId, false),
        store.put(sentDaySoul(peer, utcDay(now())), { [talkId]: true }),
      ]);
    },

    /**
     * I accepted their Talk (this version): I have it, so it is not sent back to them. A tag
     * Talk's separate tags pass only when I answer them (`recordAnswer`).
     */
    async recordArrival(peer: string, versionId: string, atoms: ExchangeAtom[]): Promise<void> {
      await mark(peer, atoms.filter((a) => !a.omitKey), versionId, false);
    },

    /** An answer passed between us (mine to their Talk, or theirs to mine). */
    async recordAnswer(peer: string, eventId: string, atoms: ExchangeAtom[]): Promise<void> {
      await mark(peer, atoms, eventId, true);
    },

    /**
     * A Talk was deleted (mine, or theirs that I had): its atoms leave the indexes of everyone it
     * passed between, so it can be exchanged again.
     */
    async forgetTalk(talkId: string, peers: string[]): Promise<void> {
      const cache = new Map<string, string>();
      await Promise.all([...new Set(peers)].map(async (peer) => {
        for (const soul of [exchangedSoul(peer), coSoul(peer)]) {
          const node = await readKeyed(store, soul);
          const clear: GraphNode = {};
          for (const [atom, value] of Object.entries(node)) {
            const eventId = eventIdOf(linkSoul(value));
            if (eventId && await talkOfEvent(eventId, cache) === talkId) clear[atom] = null;
          }
          if (Object.keys(clear).length) await putKeyed(store, soul, clear);
        }
      }));
    },

    /**
     * An answer on this Talk between us was deleted (mine, or theirs to my Talk): it no longer
     * counts as answered with them (`ix/co`). What passed by the offer stays.
     */
    async forgetAnswer(peer: string, talkId: string): Promise<void> {
      const cache = new Map<string, string>();
      const node = await readKeyed(store, coSoul(peer));
      const clear: GraphNode = {};
      for (const [atom, value] of Object.entries(node)) {
        const eventId = eventIdOf(linkSoul(value));
        if (eventId && await talkOfEvent(eventId, cache) === talkId) clear[atom] = null;
      }
      if (Object.keys(clear).length) await putKeyed(store, coSoul(peer), clear);
    },

    /** They deleted their answer to my Talk: how I decided it goes too. */
    async clearOutcome(talkId: string, responder: string): Promise<void> {
      await Promise.all([
        store.put(outcomeSoul(talkId, responder), { outcome: null, version: null, responseId: null, respondedAt: null }),
        putKeyed(store, souls.index(`outcome/${talkId}`), { [key(responder)]: null }),
      ]);
    },

    /** The send limit: may this Talk go to them now? A Talk already counted today is free. */
    async withinLimit(peer: string, talkId: string, unlimited = false): Promise<OfferPlan> {
      if (unlimited) return { send: true };
      const ms = now();
      const today = await sentToday(peer, ms);
      if (today[talkId] === true) return { send: true };
      const count = (node: GraphNode | null) => Object.values(node || {}).filter((v) => v === true).length;
      if (count(today) >= TALK_SEND_DAILY) return { send: false, reason: 'daily_talk_send_rate_limit' };
      const week = await Promise.all(weekDaysUpTo(ms).map((day) => store.get(sentDaySoul(peer, day))));
      if (week.reduce((sum, node) => sum + count(node), 0) >= TALK_SEND_WEEKLY) return { send: false, reason: 'weekly_talk_send_rate_limit' };
      return { send: true };
    },

    /** How I decided someone's answer to my Talk. */
    async outcome(talkId: string, responder: string): Promise<OutcomeRecord | undefined> {
      return readRecord(outcomeSoul(talkId, responder));
    },

    async setOutcome(talkId: string, responder: string, record: OutcomeRecord): Promise<void> {
      await Promise.all([
        store.put(outcomeSoul(talkId, responder), { ...record }),
        putKeyed(store, souls.index(`outcome/${talkId}`), { [key(responder)]: record.outcome }),
      ]);
    },

    /** Each answer to my Talk: responder → outcome. */
    async outcomes(talkId: string): Promise<Record<string, Outcome>> {
      const node = await readKeyed(store, souls.index(`outcome/${talkId}`));
      return Object.fromEntries(Object.entries(node).filter(([, v]) => v === 'matched' || v === 'ignored').map(([k, v]) => [decodeURIComponent(k), v as Outcome]));
    },

    /** My latest answer to their Talk. */
    async responded(talkId: string, author: string): Promise<OutcomeRecord | undefined> {
      return readRecord(respondedSoul(talkId, author));
    },

    async setResponded(talkId: string, author: string, record: OutcomeRecord): Promise<void> {
      await Promise.all([
        store.put(respondedSoul(talkId, author), { ...record }),
        putKeyed(store, souls.index(`responded/${talkId}`), { [key(author)]: true }),
      ]);
    },

    /** My latest answer to this Talk from each author who sent it. */
    async respondedTo(talkId: string): Promise<Record<string, OutcomeRecord>> {
      const node = await readKeyed(store, souls.index(`responded/${talkId}`));
      const out: Record<string, OutcomeRecord> = {};
      for (const author of Object.keys(node).filter((k) => node[k] === true)) {
        const record = await readRecord(respondedSoul(talkId, decodeURIComponent(author)));
        if (record) out[decodeURIComponent(author)] = record;
      }
      return out;
    },
  };

  async function readRecord(soul: string): Promise<OutcomeRecord | undefined> {
    const node = await store.get(soul);
    if (!node || (node.outcome !== 'matched' && node.outcome !== 'ignored')) return undefined;
    return { outcome: node.outcome, version: Number(node.version ?? 0), responseId: String(node.responseId ?? ''), respondedAt: String(node.respondedAt ?? '') };
  }
}

export type ExchangeIndex = ReturnType<typeof createExchangeIndex>;

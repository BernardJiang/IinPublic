/**
 * Whether I take an incoming Talk (OPEN-91 P4): the receiving side's rule, in order — never from
 * myself or to TechSupport, not from someone blocked either way, only from people my contact
 * policy allows, only from the room I am in, and only past my intake filters. Moved out of
 * `app.ts` (`shouldAcceptIncomingTalkAsync`) so every host runs the same rule. Lookups that cost a
 * call (block status, age verification, room membership) are made only when the rule gets to them.
 */
import type { GPSCoordinate, KnownPerson } from '../shared/types';
import { talkContactPolicyAllowsPeer } from '../shared/talk-contact-policy';
import { intakeFilterRejectReasons, type IncomingTalkFilterSubject } from '../shared/talk-intake-filters';
import type { TalkIntakeFilters } from '../shared/types';
import { acceptsIncomingTalks } from '../shared/techsupport';

export type IncomingTalkOffer = {
  senderId: string;
  talkData: Record<string, unknown>;
  /** The room the sender broadcast in, when the offer says (mesh broadcasts do). */
  deliveryChatroomId?: string;
  /** Sent to me directly, not through a room. */
  directPeerSend?: boolean;
};

export type IntakeContext = {
  myId: string;
  filters: TalkIntakeFilters;
  knownPeople: readonly Pick<KnownPerson, 'userId'>[] | undefined;
  travelerIds?: ReadonlySet<string>;
  currentChatroomId?: string;
  /** Only a confirmed location: a placeholder must not drive a distance filter. */
  location?: GPSCoordinate;
  now: number;
};

export type IntakeLookups = {
  isBlockedEitherWay(peerId: string): Promise<boolean>;
  ageVerified(): Promise<boolean>;
  isRoomMember(roomId: string, peerId: string): Promise<boolean>;
};

export type IntakeDecision =
  | { accept: true }
  | { accept: false; reason: 'self' | 'no-talks' | 'blocked' | 'contact-policy' | 'other-room' | 'not-in-room' | 'filters'; filterReasons?: string[] };

/** When the Talk stops being deliverable (also read from a dev seed's nested `fullTalk`); NaN if never. */
export function talkExpiresAtMs(talkData: unknown): number {
  const record = talkData && typeof talkData === 'object' ? talkData as Record<string, unknown> : {};
  const nested = record.fullTalk && typeof record.fullTalk === 'object' ? record.fullTalk as Record<string, unknown> : {};
  const value = record.expiresAt ?? nested.expiresAt;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return new Date(value).getTime();
  return Number.NaN;
}

/** The fields the intake filters read, from a Talk as it arrives. */
export function intakeSubject(td: Record<string, unknown>, isAdult: boolean, now: number): IncomingTalkFilterSubject {
  const nowIso = new Date(now).toISOString();
  const location = td.authorLocation as { latitude?: unknown; longitude?: unknown } | undefined;
  const authorLocation = location && typeof location === 'object' && typeof location.latitude === 'number' && typeof location.longitude === 'number'
    ? { latitude: location.latitude, longitude: location.longitude }
    : undefined;
  const iso = (value: unknown): string | undefined =>
    value instanceof Date ? value.toISOString() : typeof value === 'string' && value ? value : undefined;
  const expiresAt = talkExpiresAtMs(td);
  return {
    title: typeof td.title === 'string' ? td.title : String(td.title ?? ''),
    type: typeof td.type === 'string' ? td.type : String(td.type ?? ''),
    language: typeof td.language === 'string' && td.language.trim() ? td.language : 'en',
    createdAt: iso(td.createdAt) ?? nowIso,
    updatedAt: iso(td.updatedAt) ?? (typeof td.createdAt === 'string' && td.createdAt ? td.createdAt : nowIso),
    ...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
    ...(authorLocation ? { authorLocation } : {}),
    questions: Array.isArray(td.questions) ? td.questions : [],
    ...(typeof td.questionsJson === 'string' ? { questionsJson: td.questionsJson } : {}),
    isAdult,
  } as IncomingTalkFilterSubject;
}

export async function decideIncomingTalk(offer: IncomingTalkOffer, context: IntakeContext, lookups: IntakeLookups): Promise<IntakeDecision> {
  if (!context.myId || offer.senderId === context.myId) return { accept: false, reason: 'self' };
  // TechSupport takes no Talks (TODO K5), checked before any filter so no setting can undo it.
  if (!acceptsIncomingTalks(context.myId)) return { accept: false, reason: 'no-talks' };
  if (await lookups.isBlockedEitherWay(offer.senderId)) return { accept: false, reason: 'blocked' };
  if (!talkContactPolicyAllowsPeer(offer.senderId, context.filters, context.knownPeople, context.travelerIds)) {
    return { accept: false, reason: 'contact-policy' };
  }
  const isAdult = !!offer.talkData?.isAdult;
  const ageVerified = isAdult ? await lookups.ageVerified() : true;
  const room = context.currentChatroomId;
  if (!offer.directPeerSend && room) {
    const deliveryRoom = String(offer.deliveryChatroomId || '').trim();
    if (deliveryRoom && deliveryRoom !== room) return { accept: false, reason: 'other-room' };
    // A broadcast names its room; only an offer without one needs the sender's membership checked.
    if (!deliveryRoom && !(await lookups.isRoomMember(room, offer.senderId))) return { accept: false, reason: 'not-in-room' };
  }
  const filterReasons = intakeFilterRejectReasons(intakeSubject(offer.talkData, isAdult, context.now), context.filters, context.location, { ageVerified });
  return filterReasons.length === 0 ? { accept: true } : { accept: false, reason: 'filters', filterReasons };
}

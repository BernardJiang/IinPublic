import {
  TECHSUPPORT_HEADSHOT,
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from './techsupport';

/**
 * Single source of truth for the built-in TechSupport baseline graph (docs/TODO.md K1 item 5).
 * Consumed by `tests/e2e/helpers/clear-database.ts` (TS, direct import) and
 * `scripts/dev-techsupport-bootstrap.js` (plain Node, requires the compiled `dist/shared` output)
 * so the member-row/user-record shape has exactly one definition instead of three drifting copies.
 */
export function techSupportBaselineGraph(now: Date = new Date()): Record<string, unknown> {
  const nowIso = now.toISOString();
  const state = now.getTime();
  const filters = {
    allowedLanguages: ['en'],
    minDistanceMiles: 0,
    maxDistanceMiles: 50,
    requireGoodGrammar: true,
    blockDirtyWords: true,
    allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
  };
  const reputation = {
    questionsAnswered: 0,
    talksSent: 0,
    matchesFound: 0,
    friendsCount: 0,
    mutualFriendsCount: 0,
    likedCount: 0,
    dislikedCount: 0,
    starRating: 3.0,
    reviewCount: 0,
    ageVerified: false,
    ageVerificationVotes: 0,
    blockCount: 0,
    isHidden: false,
  };
  const node = (soul: string, fields: Record<string, unknown>): Record<string, unknown> => ({
    _: {
      '#': soul,
      '>': Object.fromEntries(Object.keys(fields).map((key) => [key, state])),
    },
    ...fields,
  });

  return {
    [TECHSUPPORT_ROOT_USER_ID]: undefined,
    users: node('users', {
      [TECHSUPPORT_ROOT_USER_ID]: { '#': `users/${TECHSUPPORT_ROOT_USER_ID}` },
    }),
    [`users/${TECHSUPPORT_ROOT_USER_ID}`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}`, {
      id: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      headshot: TECHSUPPORT_HEADSHOT,
      profile: { '#': `users/${TECHSUPPORT_ROOT_USER_ID}/profile` },
      reputation: { '#': `users/${TECHSUPPORT_ROOT_USER_ID}/reputation` },
      location: { '#': `users/${TECHSUPPORT_ROOT_USER_ID}/location` },
      languages: { '#': `users/${TECHSUPPORT_ROOT_USER_ID}/languages` },
      interests: { '#': `users/${TECHSUPPORT_ROOT_USER_ID}/interests` },
      knownPeople: { '#': `users/${TECHSUPPORT_ROOT_USER_ID}/knownPeople` },
      networkRole: TECHSUPPORT_NETWORK_ROLE,
      createdAt: nowIso,
      lastActive: nowIso,
    }),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/profile`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}/profile`, {}),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/reputation`]: node(
      `users/${TECHSUPPORT_ROOT_USER_ID}/reputation`,
      reputation,
    ),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/location`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}/location`, {
      region: '',
      chatrooms: { '#': `users/${TECHSUPPORT_ROOT_USER_ID}/location/chatrooms` },
    }),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/location/chatrooms`]: node(
      `users/${TECHSUPPORT_ROOT_USER_ID}/location/chatrooms`,
      {},
    ),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/languages`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}/languages`, {
      '0': 'en',
    }),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/interests`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}/interests`, {}),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/knownPeople`]: node(
      `users/${TECHSUPPORT_ROOT_USER_ID}/knownPeople`,
      {},
    ),
    [`user-public-profile/${TECHSUPPORT_ROOT_USER_ID}`]: node(`user-public-profile/${TECHSUPPORT_ROOT_USER_ID}`, {
      headshot: TECHSUPPORT_HEADSHOT,
      languagesJson: JSON.stringify(['en']),
      profileJson: JSON.stringify([]),
      interestsJson: JSON.stringify([]),
    }),
    [`user-talk-filters/${TECHSUPPORT_ROOT_USER_ID}`]: node(`user-talk-filters/${TECHSUPPORT_ROOT_USER_ID}`, {
      filtersJson: JSON.stringify(filters),
    }),
    'network-root-techsupport': node('network-root-techsupport', {
      userId: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      networkRole: TECHSUPPORT_NETWORK_ROLE,
      createdAt: nowIso,
    }),
    chatrooms: node('chatrooms', {
      global: { '#': 'chatrooms/global' },
    }),
    'chatrooms/global': node('chatrooms/global', {
      users: { '#': 'chatrooms/global/users' },
      locations: { '#': 'chatrooms/global/locations' },
      visits: { '#': 'chatrooms/global/visits' },
      uniqueVisitors: { '#': 'chatrooms/global/uniqueVisitors' },
      visitCount: 1,
      uniqueVisitorCount: 1,
    }),
    'chatrooms/global/users': node('chatrooms/global/users', {
      [TECHSUPPORT_ROOT_USER_ID]: { '#': `chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}` },
    }),
    [`chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}`]: techSupportGlobalMemberRow(nowIso),
    'chatrooms/global/locations': node('chatrooms/global/locations', {}),
    'chatrooms/global/visits': node('chatrooms/global/visits', {
      [TECHSUPPORT_ROOT_USER_ID]: { '#': `chatrooms/global/visits/${TECHSUPPORT_ROOT_USER_ID}` },
    }),
    [`chatrooms/global/visits/${TECHSUPPORT_ROOT_USER_ID}`]: node(
      `chatrooms/global/visits/${TECHSUPPORT_ROOT_USER_ID}`,
      {
        userId: TECHSUPPORT_ROOT_USER_ID,
        stageName: TECHSUPPORT_STAGE_NAME,
        enteredAt: nowIso,
      },
    ),
    'chatrooms/global/uniqueVisitors': node('chatrooms/global/uniqueVisitors', {
      [TECHSUPPORT_ROOT_USER_ID]: true,
    }),
  };
}

/**
 * Just the `chatrooms/global/users/<id>` member-row *fields* (no Gun `_` meta wrapper) — the
 * shape `GunService.putPath()` / `gun.get(...).put()` expects, used by the server boot seed
 * (K1 item 2, `ChatroomManager.seedTechSupportGlobalMembership`) so that write matches the
 * member-row shape the import-snapshot baseline graph uses below, instead of a second
 * hand-rolled row.
 */
export function techSupportGlobalMemberFields(nowIso: string = new Date().toISOString()): {
  userId: string;
  stageName: string;
  joinedAt: string;
  lastSeen: string;
  isActive: true;
} {
  return {
    userId: TECHSUPPORT_ROOT_USER_ID,
    stageName: TECHSUPPORT_STAGE_NAME,
    joinedAt: nowIso,
    lastSeen: nowIso,
    isActive: true,
  };
}

/**
 * Same member row, but as a raw Gun graph node (with `_` meta) — the shape the `import-snapshot`
 * endpoint expects when injecting a whole graph directly, used by `techSupportBaselineGraph`.
 */
export function techSupportGlobalMemberRow(nowIso: string = new Date().toISOString()): Record<string, unknown> {
  const soul = `chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}`;
  const fields = techSupportGlobalMemberFields(nowIso);
  return {
    _: {
      '#': soul,
      '>': Object.fromEntries(Object.keys(fields).map((key) => [key, new Date(nowIso).getTime()])),
    },
    ...fields,
  };
}

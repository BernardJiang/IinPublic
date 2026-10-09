import {
  TECHSUPPORT_HEADSHOT,
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from './techsupport';

/**
 * Single source of truth for the built-in contacts-only TechSupport baseline graph.
 * Consumed by `tests/e2e/helpers/clear-database.ts` (TS, direct import) and
 * `scripts/dev-techsupport-bootstrap.js` (plain Node, requires the compiled `dist/shared` output)
 * It contains identity/contact metadata only and deliberately has no room membership.
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
  };
}

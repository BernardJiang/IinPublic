const http = require('http');

const TECHSUPPORT_STAGE_NAME = 'TechSupport';
const TECHSUPPORT_ROOT_USER_ID = 'iinpublic-root-techsupport';
const TECHSUPPORT_NETWORK_ROLE = 'root-techsupport';
const TECHSUPPORT_HEADSHOT = 'TS';

function node(soul, fields, state = Date.now()) {
  return {
    _: {
      '#': soul,
      '>': Object.fromEntries(Object.keys(fields).map((key) => [key, state])),
    },
    ...fields,
  };
}

function createTechSupportSnapshotGraph() {
  const nowIso = new Date().toISOString();
  const state = Date.now();
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
  const filters = {
    allowedLanguages: ['en'],
    minDistanceMiles: 0,
    maxDistanceMiles: 50,
    requireGoodGrammar: true,
    blockDirtyWords: true,
    allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
  };
  return {
    [TECHSUPPORT_ROOT_USER_ID]: undefined,
    users: node('users', {
      [TECHSUPPORT_ROOT_USER_ID]: { '#': `users/${TECHSUPPORT_ROOT_USER_ID}` },
    }, state),
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
    }, state),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/profile`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}/profile`, {}, state),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/reputation`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}/reputation`, reputation, state),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/location`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}/location`, {
      region: '',
      chatrooms: { '#': `users/${TECHSUPPORT_ROOT_USER_ID}/location/chatrooms` },
    }, state),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/location/chatrooms`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}/location/chatrooms`, {}, state),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/languages`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}/languages`, { 0: 'en' }, state),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/interests`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}/interests`, {}, state),
    [`users/${TECHSUPPORT_ROOT_USER_ID}/knownPeople`]: node(`users/${TECHSUPPORT_ROOT_USER_ID}/knownPeople`, {}, state),
    [`user-public-profile/${TECHSUPPORT_ROOT_USER_ID}`]: node(`user-public-profile/${TECHSUPPORT_ROOT_USER_ID}`, {
      headshot: TECHSUPPORT_HEADSHOT,
      languagesJson: JSON.stringify(['en']),
      profileJson: JSON.stringify([]),
      interestsJson: JSON.stringify([]),
    }, state),
    [`user-talk-filters/${TECHSUPPORT_ROOT_USER_ID}`]: node(`user-talk-filters/${TECHSUPPORT_ROOT_USER_ID}`, {
      filtersJson: JSON.stringify(filters),
    }, state),
    'network-root-techsupport': node('network-root-techsupport', {
      userId: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      networkRole: TECHSUPPORT_NETWORK_ROLE,
      createdAt: nowIso,
    }, state),
    chatrooms: node('chatrooms', {
      global: { '#': 'chatrooms/global' },
    }, state),
    'chatrooms/global': node('chatrooms/global', {
      users: { '#': 'chatrooms/global/users' },
      locations: { '#': 'chatrooms/global/locations' },
      visits: { '#': 'chatrooms/global/visits' },
      uniqueVisitors: { '#': 'chatrooms/global/uniqueVisitors' },
      visitCount: 1,
      uniqueVisitorCount: 1,
    }, state),
    'chatrooms/global/users': node('chatrooms/global/users', {
      [TECHSUPPORT_ROOT_USER_ID]: { '#': `chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}` },
    }, state),
    [`chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}`]: node(`chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}`, {
      userId: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      joinedAt: nowIso,
      lastSeen: nowIso,
      isActive: true,
    }, state),
    'chatrooms/global/locations': node('chatrooms/global/locations', {}, state),
    'chatrooms/global/visits': node('chatrooms/global/visits', {
      [TECHSUPPORT_ROOT_USER_ID]: { '#': `chatrooms/global/visits/${TECHSUPPORT_ROOT_USER_ID}` },
    }, state),
    [`chatrooms/global/visits/${TECHSUPPORT_ROOT_USER_ID}`]: node(`chatrooms/global/visits/${TECHSUPPORT_ROOT_USER_ID}`, {
      userId: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      enteredAt: nowIso,
    }, state),
    'chatrooms/global/uniqueVisitors': node('chatrooms/global/uniqueVisitors', {
      [TECHSUPPORT_ROOT_USER_ID]: true,
    }, state),
  };
}

function waitForHttp(url, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else retry();
        })
        .on('error', retry);
    };
    const retry = () => {
      if (Date.now() >= deadline) reject(new Error(`${url} was not ready after ${timeoutMs}ms`));
      else setTimeout(poll, 500);
    };
    poll();
  });
}

async function postJson(url, body, timeoutMs = 4_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));
  const text = await res.text();
  if (!res.ok && !/already|reserved|exists/i.test(text)) {
    throw new Error(`${url} failed: ${res.status} ${text}`);
  }
}

async function importTechSupportSnapshot(apiBase) {
  await postJson(`${apiBase}/api/test/import-snapshot`, {
    version: 1,
    gunGraph: createTechSupportSnapshotGraph(),
  }, 10_000);
}

async function seedViaPublicApis(apiBase) {
  await postJson(`${apiBase}/api/users`, {
    id: TECHSUPPORT_ROOT_USER_ID,
    stageName: TECHSUPPORT_STAGE_NAME,
    headshot: TECHSUPPORT_HEADSHOT,
    profile: [],
    languages: ['en'],
    interests: [],
    networkRole: TECHSUPPORT_NETWORK_ROLE,
    talkFilters: {
      allowedLanguages: ['en'],
      minDistanceMiles: 0,
      maxDistanceMiles: 50,
      requireGoodGrammar: true,
      blockDirtyWords: true,
      allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
    },
  });
  await postJson(`${apiBase}/api/chatrooms/global/members`, {
    userId: TECHSUPPORT_ROOT_USER_ID,
    stageName: TECHSUPPORT_STAGE_NAME,
  });
}

async function ensureTechSupportBootstrap(apiBase, options = {}) {
  const trimmed = String(apiBase || '').replace(/\/+$/, '');
  if (!trimmed) throw new Error('apiBase is required for TechSupport bootstrap');
  await waitForHttp(`${trimmed}/health`);

  if (options.preferSnapshotImport) {
    await importTechSupportSnapshot(trimmed);
    return;
  }

  try {
    await seedViaPublicApis(trimmed);
  } catch (error) {
    if (!options.allowSnapshotImport) {
      throw error;
    }
    await importTechSupportSnapshot(trimmed);
  }
}

module.exports = {
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
  ensureTechSupportBootstrap,
  waitForHttp,
};

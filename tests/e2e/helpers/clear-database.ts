import type { Page } from '@playwright/test';
import { gunBaseURL } from './ports';
import {
  TECHSUPPORT_HEADSHOT,
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../../src/shared/techsupport';

/** Let in-memory graph swaps and any in-flight relay frames drain (parallel E2E). */
const SETTLE_AFTER_CLEAR_MS = 250;

const CLEAR_POST_MAX_ATTEMPTS = 12;

const CLEAR_POST_INITIAL_BACKOFF_MS = 80;

/** Poll until the Gun/API process for this worker answers /health (Playwright webServer startup). */
const HEALTH_POLL_INTERVAL_MS = 100;

const HEALTH_POLL_MAX_WAIT_MS = 25_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until `GET /health` succeeds on this worker's Gun port.
 * Use before destructive clears so we do not spam POSTs while the server is still binding.
 */
export async function waitForGunApiReady(maxWaitMs = HEALTH_POLL_MAX_WAIT_MS): Promise<void> {
  const healthUrl = `${gunBaseURL()}/health`;
  const deadline = Date.now() + maxWaitMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { method: 'GET' });
      if (res.ok) return;
      lastErr = `${res.status} ${res.statusText}`;
    } catch (e) {
      lastErr = (e as Error).message;
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
  throw new Error(`waitForGunApiReady: ${healthUrl} not reachable after ${maxWaitMs}ms (${lastErr})`);
}

/**
 * Clear all Gun.js databases (client IndexedDB + server in-memory graph).
 *
 * All E2E servers run with E2E_GUN_MEMORY_ONLY=1 (radisk:false, no disk persistence),
 * so no filesystem cleanup is needed. The HTTP endpoint clears the server's in-memory
 * graph, incomingTalksMap, and conversationsMap atomically. Each worker targets only
 * its own server port, so parallel workers never interfere.
 *
 * **Synchronization:** polls `/health` first, retries `POST /api/test/clear-database` with
 * exponential backoff on network or 5xx errors, then waits a short settle window so Gun
 * sync teardown mid-clear is less likely to race the next test (`docs/TODO.md` P2).
 */
/** Clear Gun for an isolated spec; stage-pipeline clears still reseed the TechSupport baseline. */
export async function maybeClearGunDatabases(options: { seedTechSupportRoot?: boolean } = {}): Promise<void> {
  if (process.env.E2E_STAGE_PIPELINE === '1' || process.env.E2E_STAGE_PIPELINE === 'true') {
    await clearGunDatabases({ seedTechSupportRoot: options.seedTechSupportRoot });
    return;
  }
  await clearGunDatabases(options);
}

export async function clearGunDatabases(options: { seedTechSupportRoot?: boolean } = {}): Promise<void> {
  await waitForGunApiReady();

  const clearUrl = `${gunBaseURL()}/api/test/clear-database`;
  let lastErr = '';

  for (let attempt = 0; attempt < CLEAR_POST_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(clearUrl, { method: 'POST' });
      const raw = await response.text();
      let body: { success?: boolean; error?: string } = {};
      try {
        body = raw ? (JSON.parse(raw) as typeof body) : {};
      } catch {
        /* non-JSON body */
      }

      if (response.ok && body.success !== false) {
        await sleep(SETTLE_AFTER_CLEAR_MS);
        if (options.seedTechSupportRoot !== false) {
          await seedTechSupportRootBaseline();
        }
        return;
      }

      lastErr = body.error || `${response.status} ${response.statusText} ${raw.slice(0, 120)}`;
    } catch (error) {
      lastErr = (error as Error).message;
    }

    const backoff = Math.min(2000, CLEAR_POST_INITIAL_BACKOFF_MS * 2 ** attempt);
    await sleep(backoff);
  }

  // Rather than failing hard when the Gun server has already crashed under load
  // (common after long mass-exchange test sequences), log a warning and return.
  // This prevents clear-failure in finally blocks from masking actual test results.
  console.warn(
    `[clearGunDatabases] WARNING: POST ${clearUrl} failed after ${CLEAR_POST_MAX_ATTEMPTS} attempts (${lastErr}). Server may have crashed under load -- skipping cleanup.`,
  );
}

export async function seedTechSupportRootBaseline(): Promise<void> {
  await waitForGunApiReady();

  const now = new Date();
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
  const node = (soul: string, fields: Record<string, unknown>) => ({
    _: {
      '#': soul,
      '>': Object.fromEntries(Object.keys(fields).map((key) => [key, state])),
    },
    ...fields,
  });
  const graph = {
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
    [`chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}`]: node(
      `chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}`,
      {
        userId: TECHSUPPORT_ROOT_USER_ID,
        stageName: TECHSUPPORT_STAGE_NAME,
        joinedAt: nowIso,
        lastSeen: nowIso,
        isActive: true,
      },
    ),
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

  const base = gunBaseURL();
  const res = await fetch(`${base}/api/test/import-snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: 1,
      gunGraph: graph,
      incomingTalks: {},
      conversations: {},
      talkResponses: {},
      statsIdx: { byDay: {}, byRegion: {}, byTalkAnswer: {} },
    }),
  });
  if (!res.ok) {
    throw new Error(`TechSupport snapshot seed failed: ${res.status} ${await res.text()}`);
  }
  await sleep(SETTLE_AFTER_CLEAR_MS);
}

/**
 * Inject an init script into `page` that deletes the Web Worker's IndexedDB
 * (`gun-idb`) before the app scripts run.  Call this **after** `context.newPage()`
 * but **before** `page.goto('/')` so the database is gone before the worker opens it.
 *
 * Use for tests that need a completely fresh Gun graph in the browser (no locally
 * cached data from a previous context/test-run leaking through the Worker's IDB).
 * Do NOT call this for "persistence" sub-tests where you want IDB to survive a
 * page close/reopen within the same BrowserContext.
 */
export async function injectIdbClear(page: Page): Promise<void> {
  await page.addInitScript(async () => {
    try {
      const dbs = await indexedDB.databases?.();
      if (dbs) {
        for (const db of dbs) {
          if (db.name?.startsWith('gun') || db.name === 'gun-idb') {
            indexedDB.deleteDatabase(db.name);
          }
        }
      }
      indexedDB.deleteDatabase('gun-idb');
    } catch {
      // Non-fatal — the worker will create a fresh database regardless.
    }
  });
}

/** Navigate to the web app and wait for Gun auth + main shell (custom BrowserContexts). */
export { gotoAppReady as gotoWebApp } from './timing';

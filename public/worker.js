/**
 * worker.js — Gun.js Web Worker
 *
 * Runs the primary Gun instance in a background thread so the main UI
 * thread is never blocked by network I/O or graph traversal.
 *
 * Loaded via:  new Worker('/worker.js')
 * Protocol:   postMessage({ id, type, payload }) both directions
 */

/* ── 1. Load Gun + SEA ───────────────────────────────────────────── */
// Gun.js only registers itself as window.GUN/window.Gun when the `window`
// global exists (main-thread browser code).  In a Web Worker, `window` is
// undefined, so after importScripts('/node_modules/gun/gun.js') the Gun
// constructor is NOT available on the global scope.  sea.js then falls into
// its `require('./gun')` fallback — which also doesn't exist in a worker —
// and throws "ReferenceError: require is not defined".
//
// Fix: alias `self` (the worker global) to `window` BEFORE loading gun.js.
// Gun.js then sees `typeof window !== "undefined"` as true and executes
//   (window.GUN = window.Gun = Gun).window = window
// where window === self, making self.GUN and self.Gun available.
// sea.js subsequently finds SEA.window.GUN (= self.GUN) and skips its
// require() path entirely.
if (typeof window === 'undefined') {
  // eslint-disable-next-line no-global-assign
  self.window = self;
}

importScripts('/node_modules/gun/gun.js');
importScripts('/node_modules/gun/sea.js');

/* ── 2. IndexedDB persistence adapter ──────────────────────────── */
const IDB_NAME = 'gun-idb';
const IDB_STORE = 'nodes';

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

const idbAdapter = {
  put(key, data, cb) {
    openDB()
      .then((db) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(data, key);
        tx.oncomplete = () => cb(null, data);
        tx.onerror = () => cb(tx.error);
      })
      .catch((err) => cb(err));
  },
  get(key, cb) {
    openDB()
      .then((db) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => cb(null, req.result !== undefined ? req.result : null);
        req.onerror = () => cb(req.error);
      })
      .catch((err) => cb(err));
  },
};

/* ── 3. Gun initialization ──────────────────────────────────────── */
// HUB_URL can be overridden via the 'init' message from the main thread.
let HUB_URL = 'http://localhost:8080/gun';

let gun = null;
let SEA = self.SEA; // loaded by sea.js importScript above

function initGun(hubUrl) {
  if (hubUrl) HUB_URL = hubUrl;

  // Peers list is intentionally empty: the worker handles only SEA crypto and
  // local IndexedDB persistence.  Connecting the worker as a second Gun peer to
  // the same hub that the main-thread Gun already uses causes redundant graph
  // replication which inflates chatroom member-count subscriptions.
  gun = Gun({
    peers: [],
    localStorage: false,
    radisk: false,
    store: idbAdapter,
  });

  self.postMessage({ type: 'ready' });
}

/* ── 4. Session state ───────────────────────────────────────────── */
let currentUser = null; // { alias, pub, priv, epub, epriv }

/* ── 5. Active subscriptions ────────────────────────────────────── */
// subId → Gun off-handle
const subscriptions = new Map();

/* ── 6. Message handler ─────────────────────────────────────────── */
self.onmessage = async function (event) {
  const { id, type, payload } = event.data;

  try {
    switch (type) {
      case 'init':
        initGun(payload && payload.hubUrl);
        reply(id, null, { ok: true });
        break;

      /* ── PUT ── */
      case 'put': {
        const { path, data } = payload;
        await gunPut(path, data);
        reply(id, null, { ok: true });
        break;
      }

      /* ── GET ── */
      case 'get': {
        const { path } = payload;
        const data = await gunGet(path);
        reply(id, null, data);
        break;
      }

      /* ── SUBSCRIBE ── */
      case 'subscribe': {
        const { subId, path } = payload;
        const ref = pathRef(path);
        const handler = ref.on((data, key) => {
          self.postMessage({ type: 'subscription', subId, data, key });
        });
        subscriptions.set(subId, handler);
        reply(id, null, { ok: true });
        break;
      }

      /* ── UNSUBSCRIBE ── */
      case 'unsubscribe': {
        const { subId } = payload;
        const handler = subscriptions.get(subId);
        if (handler && typeof handler.off === 'function') handler.off();
        subscriptions.delete(subId);
        reply(id, null, { ok: true });
        break;
      }

      /* ── CREATE ACCOUNT ── */
      case 'createAccount': {
        const pair = await SEA.pair();
        currentUser = { pair };
        reply(id, null, { pub: pair.pub, epub: pair.epub });
        break;
      }

      /* ── LOGIN (restore from stored keypair) ── */
      case 'login': {
        const { pair } = payload;
        currentUser = { pair };
        reply(id, null, { pub: pair.pub, epub: pair.epub });
        break;
      }

      /* ── LOGOUT ── */
      case 'logout': {
        currentUser = null;
        reply(id, null, { ok: true });
        break;
      }

      /* ── PUT PUBLIC (user's public namespace) ── */
      case 'putPublic': {
        if (!currentUser) { reply(id, 'Not logged in', null); break; }
        const { key, data: pubData } = payload;
        await gunPut(`users/${currentUser.pair.pub}/public/${key}`, pubData);
        reply(id, null, { ok: true });
        break;
      }

      /* ── PUT PRIVATE (AES-encrypted) ── */
      case 'putPrivate': {
        if (!currentUser) { reply(id, 'Not logged in', null); break; }
        const { key, data: privData } = payload;
        const encrypted = await SEA.encrypt(JSON.stringify(privData), currentUser.pair);
        await gunPut(`users/${currentUser.pair.pub}/private/${key}`, encrypted);
        reply(id, null, { ok: true });
        break;
      }

      /* ── GET PRIVATE (AES-decrypted) ── */
      case 'getPrivate': {
        if (!currentUser) { reply(id, 'Not logged in', null); break; }
        const { key: privKey } = payload;
        const raw = await gunGet(`users/${currentUser.pair.pub}/private/${privKey}`);
        if (!raw) { reply(id, null, null); break; }
        const decrypted = await SEA.decrypt(raw, currentUser.pair);
        reply(id, null, JSON.parse(decrypted));
        break;
      }

      /* ── CREATE NODE ── */
      case 'createNode': {
        const { nodeId, nodeData } = payload;
        await gunPut(`nodes/${nodeId}`, { ...nodeData, id: nodeId, createdAt: Date.now() });
        reply(id, null, { ok: true, nodeId });
        break;
      }

      /* ── LINK NODES ── */
      case 'linkNodes': {
        const { fromId, toId, edgeLabel } = payload;
        const label = edgeLabel || 'link';
        await gunPut(`edges/${fromId}/${label}/${toId}`, { from: fromId, to: toId, label, at: Date.now() });
        reply(id, null, { ok: true });
        break;
      }

      default:
        reply(id, `Unknown message type: ${type}`, null);
    }
  } catch (err) {
    reply(id, err && err.message ? err.message : String(err), null);
  }
};

/* ── Helpers ────────────────────────────────────────────────────── */

function reply(id, err, data) {
  self.postMessage({ id, err: err || null, data: data !== undefined ? data : null });
}

/** Resolve a dot-separated path like "users/pub123/public/key" → gun.get('users').get('pub123')… */
function pathRef(path) {
  const parts = path.split('/').filter(Boolean);
  let ref = gun.get(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    ref = ref.get(parts[i]);
  }
  return ref;
}

function gunPut(path, data) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('put timeout')), 8000);
    pathRef(path).put(data, (ack) => {
      clearTimeout(timeout);
      if (ack.err) reject(new Error(ack.err));
      else resolve(ack);
    });
  });
}

function gunGet(path) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) { done = true; resolve(null); }
    }, 6000);
    pathRef(path).once((data) => {
      if (!done) {
        done = true;
        clearTimeout(timeout);
        resolve(data !== undefined ? data : null);
      }
    });
  });
}

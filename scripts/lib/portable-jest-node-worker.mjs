// Runs the portable Jest Node bundle the way a phone's embedded Node does
// (src/server/routes/system-routes.ts runPortableJestBundle): in a worker thread, without what
// host Node has and the phones' Node 18 does not (below). A host run that had them would select
// files that fail on every phone (1.0.162: crypto; 1.0.163: CustomEvent).

import { Worker } from 'node:worker_threads';

// Globals and built-ins host Node has that the phones' Node 18.20 does not. Web globals: crypto
// and CustomEvent (19), File (20), navigator (21), WebSocket (22), URLPattern (24), Web Storage
// (25). Language (newer V8): Object/Map.groupBy, Promise.withResolvers, the Set methods, Iterator
// helpers, Array.fromAsync, well-formed strings, Float16Array, RegExp.escape, Error.isError.
const NODE18_MISSING = [
  'crypto', 'CustomEvent', 'File', 'navigator', 'Navigator', 'WebSocket', 'CloseEvent', 'EventSource',
  'URLPattern', 'localStorage', 'sessionStorage', 'Storage', 'Iterator', 'Float16Array',
];
const NODE18_MISSING_STATICS = [
  ['Object', 'groupBy'], ['Map', 'groupBy'], ['Promise', 'withResolvers'], ['Promise', 'try'],
  ['Array', 'fromAsync'], ['RegExp', 'escape'], ['Error', 'isError'], ['Math', 'sumPrecise'],
];
const NODE18_MISSING_METHODS = [
  ['Set', ['union', 'intersection', 'difference', 'symmetricDifference', 'isSubsetOf', 'isSupersetOf', 'isDisjointFrom']],
  ['String', ['isWellFormed', 'toWellFormed']],
  ['ArrayBuffer', ['transfer', 'transferToFixedLength']],
];

export function runPortableJestNodeBundle(bundlePath) {
  const worker = new Worker(
    `for (const name of ${JSON.stringify(NODE18_MISSING)}) delete globalThis[name];
     for (const [owner, name] of ${JSON.stringify(NODE18_MISSING_STATICS)}) delete globalThis[owner][name];
     for (const [owner, names] of ${JSON.stringify(NODE18_MISSING_METHODS)}) for (const name of names) delete globalThis[owner].prototype[name];
     const { parentPort, workerData } = require('worker_threads');
     const unhandledErrors = [];
     const record = (error) => { if (unhandledErrors.length < 20) unhandledErrors.push(String(error && error.stack || error).slice(0, 400)); };
     process.on('unhandledRejection', record);
     process.on('uncaughtException', record);
     delete require.cache[workerData.bundle];
     require(workerData.bundle).runPortableJest().then(
       (report) => parentPort.postMessage({ report: { ...report, unhandledErrors } }),
       (error) => parentPort.postMessage({ error: String(error && error.stack || error) }),
     );`,
    { eval: true, workerData: { bundle: bundlePath } },
  );
  return new Promise((resolve, reject) => {
    worker.once('message', (message) => {
      void worker.terminate();
      if (message.error) reject(new Error(message.error));
      else resolve(message.report);
    });
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`portable Jest worker exited with code ${code}`)));
  });
}

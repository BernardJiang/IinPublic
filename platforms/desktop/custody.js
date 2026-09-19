// Password-free identity custody for the Electron shell, backed by Electron safeStorage.
// On macOS safeStorage's key lives in the login Keychain. Windows (DPAPI) and Linux
// (libsecret/kwallet) are deliberately NOT enabled until their provider is reviewed, and the
// Linux `basic_text` backend (plaintext-equivalent) is always refused. No plaintext fallback.
const fs = require('fs');
const path = require('path');

const FILE = 'identity-custody-v3.bin';
const FIELDS = ['pub', 'epub', 'priv', 'epriv'];

function isValidPair(pair) {
  return !!pair && typeof pair === 'object' && FIELDS.every((k) => typeof pair[k] === 'string' && pair[k].length > 0);
}

function registerCustody({ ipcMain, safeStorage, userDataDir, platform = process.platform }) {
  const file = path.join(userDataDir, FILE);
  const supported = () => platform === 'darwin' && safeStorage.isEncryptionAvailable();

  const readPair = () => {
    if (!fs.existsSync(file)) return null;
    const pair = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    if (!isValidPair(pair)) throw new Error('corrupt custody record');
    return pair;
  };

  ipcMain.handle('iinpublic:custody:describe', () => ({
    version: 1, provider: 'electron-safe-storage', available: supported(), hardwareBacked: null,
  }));
  ipcMain.handle('iinpublic:custody:read', () => {
    if (!supported()) return { error: 'unavailable' };
    try { return { pair: readPair() }; } catch { return { error: 'read-failed' }; }
  });
  ipcMain.handle('iinpublic:custody:write', (_e, pair) => {
    if (!supported() || !isValidPair(pair)) return { ok: false };
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(pair)), { mode: 0o600 });
      fs.renameSync(tmp, file);
      const back = readPair();
      return { ok: FIELDS.every((k) => back[k] === pair[k]) };
    } catch { return { ok: false }; }
  });
  ipcMain.handle('iinpublic:custody:remove', (_e, expected) => {
    if (!supported()) return { ok: false };
    try {
      const stored = readPair();
      if (!stored) return { ok: true };
      if (stored.pub !== expected?.pub || stored.epub !== expected?.epub) return { ok: false };
      fs.unlinkSync(file);
      return { ok: true };
    } catch { return { ok: false }; }
  });
}

module.exports = { registerCustody, isValidPair };

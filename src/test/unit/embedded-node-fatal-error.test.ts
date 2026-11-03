/** @jest-environment node */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { recordFatalError } from '../../node-app/embedded-node';

describe('recordFatalError', () => {
  it('keeps the error that ends Node, and never throws itself', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-crash-'));
    recordFatalError(dir, new Error('send ENETUNREACH 224.0.0.251:5353'));
    expect(fs.readFileSync(path.join(dir, 'node-last-crash.log'), 'utf8')).toContain('ENETUNREACH');

    fs.rmSync(dir, { recursive: true, force: true });
    expect(() => recordFatalError(path.join(dir, 'missing'), 'boom')).not.toThrow();
  });
});

import { EventEmitter } from 'events';
import { bufferEmitsUntilReleased } from '../../web/services/early-emit-buffer';

/** F1 (docs/testing/gui-responsiveness-audit.md): taps during boot must not be dropped. */
describe('bufferEmitsUntilReleased', () => {
  it('holds an event nobody listens to yet and delivers it on release, in order', () => {
    const emitter = new EventEmitter();
    const release = bufferEmitsUntilReleased(emitter);
    emitter.emit('createTalk', { title: 'first' });
    emitter.emit('sendMessage', 'hi');
    const got: unknown[] = [];
    emitter.on('createTalk', (payload) => got.push(['createTalk', payload]));
    emitter.on('sendMessage', (payload) => got.push(['sendMessage', payload]));
    expect(got).toEqual([]);
    release();
    expect(got).toEqual([['createTalk', { title: 'first' }], ['sendMessage', 'hi']]);
  });

  it('passes events straight through when something already listens', () => {
    const emitter = new EventEmitter();
    const seen: string[] = [];
    emitter.on('nav', (view: string) => seen.push(view));
    bufferEmitsUntilReleased(emitter);
    emitter.emit('nav', 'talks');
    expect(seen).toEqual(['talks']);
  });

  it('behaves like a plain emitter after release, and releases only once', () => {
    const emitter = new EventEmitter();
    const release = bufferEmitsUntilReleased(emitter);
    emitter.emit('late', 1);
    const seen: number[] = [];
    emitter.on('late', (n: number) => seen.push(n));
    release();
    release();
    emitter.emit('late', 2);
    expect(seen).toEqual([1, 2]);
    expect(emitter.emit('nobody')).toBe(false);
  });

  it('keeps at most the limit', () => {
    const emitter = new EventEmitter();
    const release = bufferEmitsUntilReleased(emitter, 2);
    for (let i = 0; i < 5; i += 1) emitter.emit('x', i);
    const seen: number[] = [];
    emitter.on('x', (n: number) => seen.push(n));
    release();
    expect(seen).toEqual([0, 1]);
  });
});

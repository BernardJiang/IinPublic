import { TalkCompletionPipeline } from '../../web/services/talk-completion-pipeline';

/** F7 (docs/testing/gui-responsiveness-audit.md). */
describe('TalkCompletionPipeline', () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('a completion whose key is slow does not hold up a later one for another Talk', async () => {
    const pipeline = new TalkCompletionPipeline();
    const slowKey = deferred();
    const order: string[] = [];
    const a = pipeline.submit('talk-a', slowKey.promise, async () => { order.push('a'); });
    const b = pipeline.submit('talk-b', Promise.resolve(), async () => { order.push('b'); });
    await b;
    expect(order).toEqual(['b']);
    slowKey.resolve();
    await a;
    expect(order).toEqual(['b', 'a']);
  });

  it('never runs two completions at once', async () => {
    const pipeline = new TalkCompletionPipeline();
    let running = 0;
    let maxRunning = 0;
    const work = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await tick();
      running -= 1;
    };
    await Promise.all(['a', 'b', 'c', 'd'].map((key) => pipeline.submit(key, Promise.resolve(), work)));
    expect(maxRunning).toBe(1);
  });

  it('keeps completions of the same Talk in submission order, even if the later key is ready first', async () => {
    const pipeline = new TalkCompletionPipeline();
    const firstKey = deferred();
    const order: string[] = [];
    const first = pipeline.submit('talk-a', firstKey.promise, async () => { order.push('answer'); });
    const second = pipeline.submit('talk-a', Promise.resolve(), async () => { order.push('change-of-mind'); });
    await tick();
    expect(order).toEqual([]);
    firstKey.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['answer', 'change-of-mind']);
  });

  it('runs the completion even when its key lookup fails, and a failure does not block later work', async () => {
    const pipeline = new TalkCompletionPipeline();
    const ran: string[] = [];
    await pipeline.submit('a', Promise.reject(new Error('no key')), async () => { ran.push('a'); });
    await expect(pipeline.submit('b', Promise.resolve(), async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await pipeline.submit('c', Promise.resolve(), async () => { ran.push('c'); });
    expect(ran).toEqual(['a', 'c']);
  });
});

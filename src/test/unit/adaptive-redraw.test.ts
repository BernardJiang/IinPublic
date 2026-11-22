/** @jest-environment jsdom */
import { adaptiveRedraw } from '../../web/ui/adaptive-redraw';

describe('adaptiveRedraw (Talks list redraws, 2026-11-21)', () => {
  afterEach(() => jest.useRealTimers());

  it('draws at once after a quiet spell; a burst shares one trailing redraw', () => {
    jest.useFakeTimers();
    let clock = 1_000;
    const draw = jest.fn();
    const redraw = adaptiveRedraw(draw, 250, () => clock);
    redraw();
    expect(draw).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) { clock += 10; redraw(); }
    expect(draw).toHaveBeenCalledTimes(1);
    clock += 250;
    jest.advanceTimersByTime(250);
    expect(draw).toHaveBeenCalledTimes(2);
    clock += 1_000;
    redraw();
    expect(draw).toHaveBeenCalledTimes(3);
  });

  it('waits three times as long as a slow redraw took', () => {
    jest.useFakeTimers();
    let clock = 0;
    const draw = jest.fn(() => { clock += 200; }); // a 200 ms redraw
    const redraw = adaptiveRedraw(draw, 250, () => clock);
    redraw();
    clock += 300;
    redraw();
    expect(draw).toHaveBeenCalledTimes(1); // 500 ms since it started < 600 ms
    clock += 100;
    jest.advanceTimersByTime(100);
    expect(draw).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

describe('adaptiveRedraw and the user', () => {
  it('draws at once right after a tap, even inside the gap', () => {
    let clock = 0;
    const draw = jest.fn();
    const redraw = adaptiveRedraw(draw, 250, () => clock);
    redraw();
    clock += 10;
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    redraw();
    expect(draw).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

describe('adaptiveRedraw while a decision is not shown yet', () => {
  it('draws at once while `urgent` says the screen is stale', () => {
    jest.useFakeTimers({ now: Date.now() + 60_000 }); // well after any earlier tap
    let clock = 100_000;
    let stale = false;
    const draw = jest.fn();
    const redraw = adaptiveRedraw(draw, 250, () => clock, () => stale);
    redraw();
    clock += 10;
    redraw();
    expect(draw).toHaveBeenCalledTimes(1);
    stale = true;
    clock += 10;
    redraw();
    expect(draw).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

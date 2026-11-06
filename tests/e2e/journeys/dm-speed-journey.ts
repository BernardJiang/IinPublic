/**
 * J-CHAT-04: sending a direct message never makes anyone wait (OPEN-92). Runs inside the shared
 * two-person journey, so on phone-path/02 and on real phones in native-app/37.
 *
 * For each send, on the sender's screen: the composer clears, Send stays free and the message is
 * there straight away. On the other person's screen: it arrives once, within the budget. Budgets
 * come from FRD-L04, the slowest supported phone: own message up to 335 ms, arrival under 0.8 s.
 *
 * Expects both people to have the conversation open and the direct channel connected.
 */
import { expect, type Page } from '@playwright/test';
import type { TestActor } from '../helpers/test-actor';

const OWN_MESSAGE_BUDGET_MS = 500;
const ARRIVAL_BUDGET_MS = 2_000;
/** Longer than either budget, so a send that waits for the local save cannot pass. */
const SLOW_SAVE_MS = 4_000;

const countInThread = (page: Page, text: string): Promise<number> => page.evaluate((wanted) =>
  [...document.querySelectorAll('#conversation-detail-overlay .message-text')]
    .filter((node) => node.textContent?.includes(wanted)).length, text);

const arrivalOf = (page: Page, text: string) => page.waitForFunction((wanted) =>
  [...document.querySelectorAll('#conversation-detail-overlay .message-text')]
    .some((node) => node.textContent?.includes(wanted)), text, { polling: 50, timeout: 20_000 });

/** Taps Send as a person would, and reports what the sender's own screen did. */
const tapSend = (page: Page, text: string) => page.evaluate((message) => new Promise<{
  ownMs: number | null; sendFree: boolean; composerCleared: boolean;
}>((resolve) => {
  const input = document.getElementById('conversation-message-input') as HTMLTextAreaElement;
  const send = document.getElementById('send-conversation-message') as HTMLButtonElement;
  const label = send.textContent;
  const inThread = () => [...document.querySelectorAll('#conversation-detail-overlay .message-text')]
    .some((node) => node.textContent?.includes(message));
  input.value = message;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const startedAt = performance.now();
  send.click();
  const state = { sendFree: !send.disabled && send.textContent === label, composerCleared: input.value === '' };
  const finish = (ownMs: number | null) => {
    observer.disconnect();
    clearTimeout(timer);
    resolve({ ownMs, ...state });
  };
  const observer = new MutationObserver(() => { if (inThread()) finish(Math.round(performance.now() - startedAt)); });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  const timer = setTimeout(() => finish(null), 5_000);
  if (inThread()) finish(Math.round(performance.now() - startedAt));
}), text);

async function sendAndMeasure(sender: TestActor, receiver: TestActor, text: string, label: string): Promise<{ ownMs: number; arrivalMs: number }> {
  const arrived = arrivalOf(receiver.page, text);
  const startedAt = Date.now();
  const own = await tapSend(sender.page, text);
  await arrived;
  const arrivalMs = Date.now() - startedAt;
  expect(own.composerCleared, `${label}: the composer clears at once`).toBe(true);
  expect(own.sendFree, `${label}: Send stays free`).toBe(true);
  expect(own.ownMs, `${label}: own message shows at once`).not.toBeNull();
  expect(own.ownMs!, `${label}: own message within budget`).toBeLessThanOrEqual(OWN_MESSAGE_BUDGET_MS);
  expect(arrivalMs, `${label}: arrival within budget`).toBeLessThanOrEqual(ARRIVAL_BUDGET_MS);
  return { ownMs: own.ownMs!, arrivalMs };
}

/** Holds this person's private saves back, as a slow phone's write queue does. */
const slowLocalSaves = (page: Page, delayMs: number) => page.evaluate((delay) => {
  const gun = (window as any).__iinpublic_app.getApp().gunService;
  const original = gun.putPrivate;
  (window as any).__e2eRestoreSaves = () => { gun.putPrivate = original; };
  gun.putPrivate = async function delayed(...args: unknown[]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return original.apply(this, args);
  };
}, delayMs);

export async function dmSpeedJourney(alice: TestActor, bob: TestActor): Promise<Record<string, number>> {
  const tag = Date.now();
  const results = [
    await sendAndMeasure(alice, bob, `speed a-to-b ${tag}`, `${alice.id} to ${bob.id}`),
    await sendAndMeasure(bob, alice, `speed b-to-a ${tag}`, `${bob.id} to ${alice.id}`),
  ];

  // Delivery must not wait for the sender's save: 7.9 s on FRD-L04 held every message back.
  const slow = `speed slow-save ${tag}`;
  await slowLocalSaves(alice.page, SLOW_SAVE_MS);
  try {
    results.push(await sendAndMeasure(alice, bob, slow, `${alice.id} to ${bob.id} during a slow save`));
  } finally {
    await alice.page.evaluate(() => (window as any).__e2eRestoreSaves?.());
  }

  // Send never locks, so two quick messages both go, in order.
  const first = `speed quick-1 ${tag}`;
  const second = `speed quick-2 ${tag}`;
  const quick = arrivalOf(bob.page, second);
  await tapSend(alice.page, first);
  await tapSend(alice.page, second);
  await quick;
  await arrivalOf(bob.page, first);
  const order = await bob.page.evaluate(([a, b]) => {
    const texts = [...document.querySelectorAll('#conversation-detail-overlay .message-text')].map((n) => n.textContent ?? '');
    return [texts.findIndex((text) => text.includes(a!)), texts.findIndex((text) => text.includes(b!))];
  }, [first, second]);
  expect(order[0], 'quick messages arrive in the order they were sent').toBeLessThan(order[1]!);

  // Anything arriving twice (direct link and mailbox) would show by now.
  await bob.page.waitForTimeout(3_000);
  for (const text of [`speed a-to-b ${tag}`, slow, first, second]) {
    expect(await countInThread(bob.page, text), `${text} shows once for the receiver`).toBe(1);
    expect(await countInThread(alice.page, text), `${text} shows once for the sender`).toBe(1);
  }
  return {
    dmWorstOwnMessageMs: Math.max(...results.map((result) => result.ownMs)),
    dmWorstArrivalMs: Math.max(...results.map((result) => result.arrivalMs)),
  };
}

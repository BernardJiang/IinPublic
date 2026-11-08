/**
 * Manual list pins: Contacts, Talks, and Me questions/answers all expose the same
 * user-facing pin/unpin interaction. A pin must override the list's active sort,
 * survive a full page reload, and unpin back into the underlying sort order.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { gotoWebApp, injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterNav } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { talkToolbarAction } from '../../helpers/talk-row-actions';
import { rowToolbarAction } from '../../helpers/list-row-actions';

test.describe('manual pins across Contacts, Talks, and Me', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 960, height: 1200 } });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  async function seedAllThreeLists(): Promise<void> {
    await page.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const authorId = String(app?.currentUser?.id || 'pin-e2e-user');
      const newest = '2026-09-20T12:00:00.000Z';
      const oldest = '2026-09-19T12:00:00.000Z';

      ((window as any).__iinpublic_collection_edit?.('settings', { remove: ['iinpublic_list_pins_v1'] }), localStorage.removeItem('iinpublic_list_pins_v1'));
      ((window as any).__iinpublic_collection_edit?.('settings', { remove: ['iinpublic_contacts_tab_state'] }), localStorage.removeItem('iinpublic_contacts_tab_state'));
      ((window as any).__iinpublic_collection_edit?.('settings', { remove: ['iinpublic_talks_tab_state'] }), localStorage.removeItem('iinpublic_talks_tab_state'));
      localStorage.setItem('localTalkExchanges', JSON.stringify({
        'pin-contact-new::pin-contact-talk-new': {
          peerId: 'pin-contact-new', peerName: 'Newer Contact', talkId: 'pin-contact-talk-new',
          title: 'Newer contact exchange', direction: 'received', outcome: 'match', type: 'flow',
          language: 'en', date: newest,
        },
        'pin-contact-old::pin-contact-talk-old': {
          peerId: 'pin-contact-old', peerName: 'Older Contact', talkId: 'pin-contact-talk-old',
          title: 'Older contact exchange', direction: 'received', outcome: 'match', type: 'flow',
          language: 'en', date: oldest,
        },
      }));

      const makeTalk = (id: string, title: string, lastInteraction: string) => {
        const fullTalk = {
          id, authorId, title, type: 'flow', language: 'en', isAdult: false,
          createdAt: lastInteraction,
          questions: [{
            id: `${id}-q`, text: 'Pin this talk?',
            answers: [
              { id: `${id}-yes`, text: 'Yes', isMatch: true, isTerminal: true },
              { id: `${id}-no`, text: 'No', isIgnore: true, isTerminal: true },
            ],
          }],
        };
        return {
          id, talkId: id, role: 'created', title, type: 'flow', language: 'en',
          timestamp: lastInteraction, createdAt: lastInteraction, lastInteraction,
          status: 'OUT', stats: { responses: 0, matched: 0 }, disabled: false, fullTalk,
        };
      };
      // The answers' Talks, as answered entries with their bodies: the device graph keeps my
      // answers to them (OPEN-106), so the Me rows survive the reload below.
      const answeredTalk = (talkId: string, questionId: string, prompt: string, choice: string, at: string) => ({
        id: talkId, talkId, role: 'answered', title: `${prompt} source`, type: 'flow', language: 'en',
        timestamp: at, lastInteraction: at, senders: [],
        completedAnswers: [{ questionId, answerId: `${questionId}-answer`, answerText: choice }],
        fullTalk: {
          id: talkId, title: `${prompt} source`, type: 'flow', language: 'en', isAdult: false,
          questions: [{ id: questionId, text: prompt, answers: [{ id: `${questionId}-answer`, text: choice, isMatch: true, isTerminal: true }] }],
        },
      });
      localStorage.setItem('myTalks', JSON.stringify({
        'pin-talk-new': makeTalk('pin-talk-new', 'Newer Talk', newest),
        'pin-talk-old': makeTalk('pin-talk-old', 'Older Talk', oldest),
        'pin-answer-new-talk': answeredTalk('pin-answer-new-talk', 'pin-answer-new', 'Newer question?', 'Newer answer', newest),
        'pin-answer-old-talk': answeredTalk('pin-answer-old-talk', 'pin-answer-old', 'Older question?', 'Older answer', oldest),
      }));

      const makeHistory = (
        id: string,
        talkId: string,
        questionId: string,
        prompt: string,
        choice: string,
        answeredAt: string,
      ) => ({
        id, talkId, title: `${prompt} source`, type: 'flow', language: 'en', outcome: 'match',
        answeredAt, senderIds: [],
        items: [{
          questionId, answerId: `${questionId}-answer`, prompt, choice, kind: 'question',
          contextLabel: '', contextPath: [], contextHash: '',
        }],
      });
      const seed = (records: Record<string, unknown>) => ((w: any) => { if (w.__iinpublic_answer_history_seed) w.__iinpublic_answer_history_seed(records); else w.__iinpublic_pending_answer_history = { ...(w.__iinpublic_pending_answer_history || {}), ...records }; })(window);
      // The older first: the graph dates each answer by when it is written, so the newer one is
      // written only once the older is in the graph — two in the same millisecond tie, and the
      // unpinned order below is then whichever the list had (a full-suite flake).
      seed({ 'pin-answer-old-history': makeHistory(
        'pin-answer-old-history', 'pin-answer-old-talk', 'pin-answer-old',
        'Older question?', 'Older answer', oldest,
      ) });
      return makeHistory(
        'pin-answer-new-history', 'pin-answer-new-talk', 'pin-answer-new',
        'Newer question?', 'Newer answer', newest,
      );
    }).then(async (newer) => {
      const graphHas = (questionId: string) => page.evaluate(async (q) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        const rows = await app?.coreRequest?.({ name: 'graph.answerHistory' });
        return JSON.stringify(rows ?? null).includes(q);
      }, questionId);
      await expect.poll(() => graphHas('pin-answer-old'), { message: 'older answer written to the graph' }).toBe(true);
      await page.waitForTimeout(5);
      await page.evaluate((record) => (window as any).__iinpublic_answer_history_seed({ 'pin-answer-new-history': record }), newer);
      await expect.poll(() => graphHas('pin-answer-new'), { message: 'newer answer written to the graph' }).toBe(true);
    });
  }

  const ordinaryContacts = () => page.locator('#contacts-list .contact-item:not([data-support-contact="true"])');
  const outgoingTalks = () => page.locator('#talks-list .talk-list-item[data-role="created"]');
  const answerRows = () => page.locator('#answers-list .answer-talk-item');

  async function openContacts(): Promise<void> {
    await page.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await page.locator('#contacts-sort-order').selectOption('recent');
    await expect(ordinaryContacts()).toHaveCount(2);
  }

  async function openOutgoingTalks(): Promise<void> {
    await page.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await page.locator('#talks-filter-incoming').uncheck();
    await page.locator('#talks-filter-outgoing').check();
    await page.locator('#talks-out-sort-order').selectOption('recent');
    await expect(outgoingTalks()).toHaveCount(2);
  }

  async function openAnswers(): Promise<void> {
    await page.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await page.locator('#me-answer-sort').selectOption('answered-desc');
    await expect(answerRows()).toHaveCount(2);
  }

  test('pins, persists, and unpins rows in all three tabs', async () => {
    await seedAllThreeLists();

    await openContacts();
    await expect(ordinaryContacts().first()).toHaveAttribute('data-contact-user-id', 'pin-contact-new');
    // Contacts and Me, like Talks: long-press selects the row, the AppBar's 📌 pins it, a badge shows it.
    await rowToolbarAction(page, page.locator('[data-contact-user-id="pin-contact-old"]'), 'contacts-pin-btn');
    await expect(ordinaryContacts().first()).toHaveAttribute('data-contact-user-id', 'pin-contact-old');
    await expect(page.locator('[data-contact-user-id="pin-contact-old"] [data-testid="contact-pin-badge"]')).toBeVisible();

    await openOutgoingTalks();
    await expect(outgoingTalks().first()).toHaveAttribute('data-talk-id', 'pin-talk-new');
    // Talks: long-press selects the row, the AppBar's 📌 pins it, and a badge shows it is pinned.
    await talkToolbarAction(page, page.locator('.talk-list-item[data-talk-id="pin-talk-old"]'), 'pin');
    await expect(outgoingTalks().first()).toHaveAttribute('data-talk-id', 'pin-talk-old');
    await expect(page.locator('[data-talk-id="pin-talk-old"] .talk-pin-badge')).toBeVisible();

    await openAnswers();
    await expect(answerRows().first()).toHaveAttribute('data-question-id', 'pin-answer-new');
    await rowToolbarAction(page, page.locator('.answer-talk-item[data-question-id="pin-answer-old"]'), 'me-pin-btn');
    await expect(answerRows().first()).toHaveAttribute('data-question-id', 'pin-answer-old');
    await expect(page.locator('[data-question-id="pin-answer-old"] [data-testid="answer-pin-badge"]')).toBeVisible();

    // A genuine document reload proves these are persisted preferences, not DOM-only moves.
    await gotoWebApp(page, webBaseURL());
    await afterAction();

    await openContacts();
    await expect(ordinaryContacts().first()).toHaveAttribute('data-contact-user-id', 'pin-contact-old');
    await rowToolbarAction(page, page.locator('[data-contact-user-id="pin-contact-old"]'), 'contacts-pin-btn');
    await expect(ordinaryContacts().first()).toHaveAttribute('data-contact-user-id', 'pin-contact-new');

    await openOutgoingTalks();
    await expect(outgoingTalks().first()).toHaveAttribute('data-talk-id', 'pin-talk-old');
    await talkToolbarAction(page, page.locator('.talk-list-item[data-talk-id="pin-talk-old"]'), 'pin');
    await expect(outgoingTalks().first()).toHaveAttribute('data-talk-id', 'pin-talk-new');

    await openAnswers();
    await expect(answerRows().first()).toHaveAttribute('data-question-id', 'pin-answer-old');
    await rowToolbarAction(page, page.locator('.answer-talk-item[data-question-id="pin-answer-old"]'), 'me-pin-btn');
    await expect(answerRows().first()).toHaveAttribute('data-question-id', 'pin-answer-new');
  });
});
